#!/usr/bin/env node
// Stage 1 文档解析：原始文档 → Markdown 存根（data/raw/<module>/<name>.md）
//
// 用法: node parse.mjs <input_file> [--module MODULE] [--outdir DIR] [--engine mineru|docling|markitdown]
//       node parse.mjs <input_file> --system MES --version V2.22.4 --category user-manual [--subcategory wip] [--name 文档名（不含版本号）]
//
// 路径规约（推荐，提供 --system/--version/--category 时启用）:
//   data/raw/<系统>/<版本号>/<文档大类>/<文档子类（如有）>/<文档名>.md
//   文档名不允许包含版本号（版本由路径段承载）；解析完成后在 data/documents/manifest.json 登记为 draft 状态。
// 未提供新参数时回退旧 --module 布局（data/raw/<module>/<name>.md），同样登记 manifest。
//
// 引擎路由（对齐方案文档 §4.2；**本地不做任何文档解析**，所有解析引擎均为独立 Docker HTTP server）:
//   .pdf                        → MinerU     (MINERU_ENDPOINT,     POST /file_parse 或 /tasks)
//   .docx/.pptx/.xlsx/.html/... → Docling    (DOCLING_ENDPOINT,    POST /v1/convert/file)
//   备选服务端引擎              → MarkItDown (MARKITDOWN_ENDPOINT, POST /v1/convert/file)
//     用 --engine markitdown 显式指定（可用范围: pdf + Office + HTML 等）
//   .md/.txt/.json/.yaml        → simple（Node 原生直读纯文本文件；非版面解析，不属于文档解析范畴）
//   扫描件图片                  → 未接入 OCR 时直接报错
// --engine mineru|docling|markitdown 可强制指定引擎（仍为服务端调用）。
// 服务不可用 = 摄取失败，绝不产出低保真结果，绝不本地降级。
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { join, dirname, extname, basename, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { upsertDraft } from './docstore.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..', '..')

const MINERU_ENDPOINT = process.env.MINERU_ENDPOINT || ''
const MINERU_API_KEY = process.env.MINERU_API_KEY || ''
const DOCLING_ENDPOINT = process.env.DOCLING_ENDPOINT || ''
const MARKITDOWN_ENDPOINT = process.env.MARKITDOWN_ENDPOINT || ''

const NATIVE_EXTS = new Set(['.md', '.markdown', '.txt', '.json', '.yaml', '.yml'])
const DOCLING_EXTS = new Set(['.docx', '.doc', '.pptx', '.ppt', '.xlsx', '.xls', '.html', '.htm', '.epub'])
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.tiff', '.tif', '.bmp', '.gif', '.webp'])

function slugify(name) {
  const s = name.replace(/[^a-zA-Z0-9\u4e00-\u9fff-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()
  return s.replace(/-+/g, '-') || 'doc'
}

function fail(msg) {
  console.error(msg)
  process.exit(1)
}

// MinerU 3.x 同步端点: POST /file_parse (multipart, files 数组, return_md=true)
async function mineruV3Sync(base, apiKey, src) {
  const form = new FormData()
  form.append('files', new Blob([readFileSync(src)]), basename(src))
  form.append('return_md', 'true')
  form.append('parse_method', 'auto')
  form.append('backend', 'pipeline')
  const headers = {}
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  return fetch(`${base}/file_parse`, { method: 'POST', body: form, headers })
}

// MinerU 3.x 异步端点: POST /tasks → GET /tasks/{id} → GET /tasks/{id}/result
async function mineruV3Async(base, apiKey, src) {
  const form = new FormData()
  form.append('files', new Blob([readFileSync(src)]), basename(src))
  form.append('return_md', 'true')
  form.append('parse_method', 'auto')
  form.append('backend', 'pipeline')
  const headers = {}
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`

  const submitResp = await fetch(`${base}/tasks`, { method: 'POST', body: form, headers })
  if (!submitResp.ok) throw new Error(`MinerU 异步提交失败 HTTP ${submitResp.status}: ${await submitResp.text()}`)
  const task = await submitResp.json()
  const taskId = task.task_id || task.id
  if (!taskId) throw new Error(`MinerU 异步响应缺少 task_id: ${JSON.stringify(task).slice(0, 200)}`)

  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 5000))
    const status = await (await fetch(`${base}/tasks/${taskId}`, { headers })).json()
    if (status.status === 'failed') throw new Error(`MinerU 解析失败: ${JSON.stringify(status).slice(0, 300)}`)
    if (status.status === 'completed') {
      const resultResp = await fetch(`${base}/tasks/${taskId}/result`, { headers })
      if (!resultResp.ok) throw new Error(`获取结果失败 HTTP ${resultResp.status}`)
      const result = await resultResp.json()
      const md = result.md_content || result.markdown || result.content
      if (md) return md
      throw new Error('MinerU 结果中未找到 markdown 内容')
    }
  }
  throw new Error('MinerU 异步解析超时（>10 分钟）')
}

// MinerU V1 同步端点（旧版协议，兼容）: POST /v1/file-urls/batch
async function mineruV1Sync(base, apiKey, src) {
  const form = new FormData()
  form.append('file', new Blob([readFileSync(src)]), basename(src))
  form.append('parse_method', 'auto')
  form.append('return_content_list', 'true')
  const headers = {}
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  return fetch(`${base}/v1/file-urls/batch`, { method: 'POST', body: form, headers })
}

// MinerU ≥4.0 异步 JSON 协议: POST /api/v4/extract/file (base64) → 轮询 → zip
async function mineruV4Async(base, apiKey, src) {
  const headers = { 'Content-Type': 'application/json' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  const resp = await fetch(`${base}/api/v4/extract/file`, {
    method: 'POST', headers,
    body: JSON.stringify({
      files: [{ name: basename(src), data_base64: readFileSync(src).toString('base64') }],
      is_ocr: true, enable_formula: true, enable_table: true, language: 'ch'
    })
  })
  if (!resp.ok) throw new Error(`MinerU async HTTP ${resp.status}: ${await resp.text()}`)
  const submit = await resp.json()
  const batchId = submit.data?.batch_id || submit.batch_id
  if (!batchId) throw new Error(`MinerU 响应缺少 batch_id: ${JSON.stringify(submit).slice(0, 200)}`)

  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 5000))
    const st = await (await fetch(`${base}/api/v4/extract-results/batch/${batchId}`, { headers })).json()
    const results = st.data?.extract_result || st.extract_result || []
    const done = results.filter(x => x.state === 'done')
    const failed = results.find(x => x.state === 'failed')
    if (failed) throw new Error(`MinerU 解析失败: ${JSON.stringify(failed).slice(0, 300)}`)
    if (results.length && done.length === results.length) {
      const zipUrl = done[0].full_zip_url || done[0].zip_url
      if (!zipUrl) throw new Error('MinerU 结果缺少 zip 下载地址')
      const zipResp = await fetch(zipUrl)
      if (!zipResp.ok) throw new Error(`下载结果包失败 HTTP ${zipResp.status}`)
      const { default: AdmZip } = await import('adm-zip')
      const zip = new AdmZip(Buffer.from(await zipResp.arrayBuffer()))
      const entry = zip.getEntries().find(e => e.name === 'document.md' || e.name.endsWith('.md'))
      if (!entry) throw new Error('结果包中未找到 document.md')
      return entry.getData().toString('utf-8')
    }
  }
  throw new Error('MinerU 异步解析超时（>10 分钟）')
}

async function parseMineru(src) {
  const { MINERU_ENDPOINT, MINERU_API_KEY } = process.env
  if (!MINERU_ENDPOINT) {
    fail(`MINERU_ENDPOINT 未配置。PDF 解析仅允许经 MinerU 服务（禁止本地降级）。\n启动: cd deploy && docker compose up -d mineru`)
  }
  const base = MINERU_ENDPOINT.replace(/\/$/, '')

  // 尝试 MinerU 3.x 同步端点（当前版本）
  let resp
  try {
    resp = await mineruV3Sync(base, MINERU_API_KEY, src)
  } catch (e) {
    fail(`MinerU 服务不可达 (${base}): ${e.message}\n启动: cd deploy && docker compose up -d mineru。本次摄取终止，不做本地降级。`)
  }

  if (resp.ok) {
    const result = await resp.json()
    // MinerU 3.x 响应结构: {results: {filename: {md_content: "..."}}}
    const results = result.results || {}
    const firstFile = Object.values(results)[0] || {}
    const md = firstFile.md_content || result.md_content || result.markdown || result.content
    if (md) return md
    fail('MinerU 响应中未找到 markdown 内容')
  }

  // 404/405/415: 尝试其他协议版本
  if (resp.status === 404 || resp.status === 405 || resp.status === 415) {
    console.error('info: MinerU 3.x 同步端点不可用，尝试 V1 协议')
    try {
      resp = await mineruV1Sync(base, MINERU_API_KEY, src)
      if (resp.ok) {
        const result = await resp.json()
        if (result.code !== undefined && result.code !== 0) fail(`MinerU API ${result.code}: ${result.msg}`)
        const data = result.data || result
        const md = data.markdown
          || (Array.isArray(data.content_list) ? data.content_list.map(c => c.content || '').filter(Boolean).join('\n\n') : '')
          || data.document?.md_content
        if (md) return md
      }
    } catch (e) {
      console.error(`info: V1 协议失败: ${e.message}`)
    }

    console.error('info: 切换 MinerU 3.x 异步协议')
    return mineruV3Async(base, MINERU_API_KEY, src)
  }

  fail(`MinerU HTTP ${resp.status}: ${await resp.text()}`)
}

// Docling 与 MarkItDown 服务端共用同一项目契约: POST /v1/convert/file → {document:{md_content, images}}
// images 按文档流顺序排列，与 md 中的 `<!-- image -->` 占位一一对应，由本脚本落盘 assets 并重写引用。
async function convertViaServer(endpoint, engineName, src) {
  if (!endpoint) {
    fail(`${engineName} 服务的 ENDPOINT 未配置。文档解析仅允许经服务端引擎（本地不做任何文档解析，禁止本地降级）。\n启动: cd deploy && docker compose up -d ${engineName.toLowerCase()}`)
  }
  const form = new FormData()
  form.append('file', new Blob([readFileSync(src)]), basename(src))

  let resp
  try {
    resp = await fetch(`${endpoint.replace(/\/$/, '')}/v1/convert/file`, { method: 'POST', body: form })
  } catch (e) {
    fail(`${engineName} 服务不可达 (${endpoint}): ${e.message}\n启动: cd deploy && docker compose up -d ${engineName.toLowerCase()}。本次摄取终止，不本地降级、不自动切换其他引擎。`)
  }
  if (!resp.ok) fail(`${engineName} HTTP ${resp.status}: ${await resp.text()}`)
  const result = await resp.json()
  // 兼容两种响应形态: {document:{md_content}} (项目契约) 与 docling-serve {document:{markdown}}
  const md = result.document?.md_content || result.document?.markdown || result.md_content || result.markdown
  if (!md) fail('服务端响应中未找到 markdown 内容')
  const images = Array.isArray(result.document?.images) ? result.document.images : []
  return { md, images }
}

async function parseDocling(src) {
  return convertViaServer(DOCLING_ENDPOINT, 'Docling', src)
}

async function parseMarkitdown(src) {
  return convertViaServer(MARKITDOWN_ENDPOINT, 'MarkItDown', src)
}

// 图片落盘 + 占位重写：images 按文档流顺序与 standalone `<!-- image -->` 行一一对应
function embedImages(md, images, outDir, stem) {
  if (!images.length) return { md, written: 0 }
  const assetDirName = `${stem}_assets`
  const assetDir = join(outDir, assetDirName)
  mkdirSync(assetDir, { recursive: true })
  let idx = 0
  const lines = md.split('\n')
  for (let i = 0; i < lines.length && idx < images.length; i++) {
    if (/^[ \t]*(?:[-*][ \t]+)?<!--\s*image\s*-->[ \t]*$/.test(lines[i])) {
      const img = images[idx]
      const name = `img-${String(idx + 1).padStart(3, '0')}.${img.ext || 'png'}`
      writeFileSync(join(assetDir, name), Buffer.from(img.data, 'base64'))
      lines[i] = `![图${idx + 1}](${assetDirName}/${name})`
      idx++
    }
  }
  return { md: lines.join('\n'), written: idx }
}

async function main() {
  const args = process.argv.slice(2)
  if (!args.length) fail('用法: node parse.mjs <input_file> [--module MODULE] [--outdir DIR] [--engine mineru|docling|markitdown]')
  const input = resolve(args[0])
  const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
  const module = opt('--module') || 'general'
  const system = opt('--system')
  const version = opt('--version')
  const category = opt('--category')
  const subcategory = opt('--subcategory')
  const docName = opt('--name')
  const forcedEngine = opt('--engine')
  if (forcedEngine && !['mineru', 'docling', 'markitdown'].includes(forcedEngine)) {
    fail(`--engine 仅支持 mineru|docling|markitdown（均为服务端引擎），收到: ${forcedEngine}`)
  }
  const outBase = opt('--outdir') ? resolve(opt('--outdir')) : join(PROJECT_ROOT, 'data', 'raw')

  if (!existsSync(input)) fail(`输入文件不存在: ${input}`)
  const ext = extname(input).toLowerCase()

  let content = ''
  let images = []
  let engine = ''
  if (NATIVE_EXTS.has(ext) && !forcedEngine) {
    content = readFileSync(input, 'utf-8')
    engine = 'simple'
  } else if (forcedEngine) {
    if (forcedEngine === 'mineru') content = await parseMineru(input)
    else {
      const r = forcedEngine === 'docling' ? await parseDocling(input) : await parseMarkitdown(input)
      content = r.md
      images = r.images
    }
    engine = forcedEngine
  } else if (ext === '.pdf') {
    content = await parseMineru(input)
    engine = 'mineru'
  } else if (DOCLING_EXTS.has(ext)) {
    const r = await parseDocling(input)
    content = r.md
    images = r.images
    engine = 'docling'
  } else if (IMAGE_EXTS.has(ext)) {
    fail(`扫描件/图片(${ext})需 OCR 引擎（PaddleOCR 尚未接入），本次摄取终止。`)
  } else {
    fail(`不支持的文件类型 ${ext}。支持: .pdf(MinerU) / Office+HTML(Docling) / 纯文本族(simple 直读)；或 --engine markitdown 走服务端 MarkItDown。`)
  }

  if (!content.trim()) fail('解析结果为空（可能是图片型 PDF，需 OCR），本次摄取终止。')

  // 输出路径：结构化规约 or 旧 module 布局
  const VERSION_IN_NAME = /\b[vV]?\d+([._-]\d+)+\b/
  const stripVersion = s => s.replace(/[-_ .]*v?\d+([._-]\d+)+/gi, '').replace(/[-_. ]+$/g, '')
  let outDir, stem, docMeta
  if (system && version && category) {
    const segs = [system, version, category, subcategory].filter(Boolean)
    outDir = join(outBase, ...segs)
    stem = slugify(stripVersion(docName || basename(input, extname(input))))
    if (VERSION_IN_NAME.test(stem)) fail(`文档名不允许包含版本号: "${stem}"（版本由路径段 ${system}/${version} 承载；请用 --name 指定不含版本号的名称）`)
    docMeta = { system, version, category, subcategory: subcategory || null }
  } else if (docName || subcategory) {
    fail('--name/--subcategory 需与 --system --version --category 同时使用')
  } else {
    outDir = join(outBase, slugify(module))
    stem = slugify(basename(input, extname(input)))
    docMeta = { system: module, version: null, category: module, subcategory: null }
  }
  mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, `${stem}.md`)
  const embedded = embedImages(content, images, outDir, stem)
  writeFileSync(outPath, embedded.md, 'utf-8')
  const rawCopy = join(outDir, `${stem}${ext}`) // 原始文件副本同样使用去版本号命名
  if (resolve(input) !== resolve(rawCopy)) copyFileSync(input, rawCopy)

  const relPath = relative(PROJECT_ROOT, outPath).split('\\').join('/')
  const { record } = upsertDraft(PROJECT_ROOT, {
    ...docMeta,
    path: relPath,
    source_file: existsSync(rawCopy) ? relative(PROJECT_ROOT, rawCopy).split('\\').join('/') : null
  })

  console.log(`engine: ${engine}`)
  console.log(`output: ${outPath}`)
  console.log(`chars: ${embedded.md.length}`)
  if (images.length) console.log(`images: ${embedded.written}/${images.length} -> ${stem}_assets/`)
  console.log(`manifest: ${record.doc_id} [${record.state}] (${relPath})`)
}

main()
