import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, basename, extname } from 'node:path'
const DOCLING_ENDPOINT = process.env.DOCLING_ENDPOINT || ''
const MARKITDOWN_ENDPOINT = process.env.MARKITDOWN_ENDPOINT || ''

const NATIVE_EXTS = new Set(['.md', '.markdown', '.txt', '.json', '.yaml', '.yml'])
const DOCLING_EXTS = new Set(['.docx', '.doc', '.pptx', '.ppt', '.xlsx', '.xls', '.html', '.htm', '.epub'])

// Bound each upstream request; asynchronous MinerU polling has its own task limit.
const parserRequest = (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(120000) })

function fail(message) { throw new Error(message) }

// MinerU 3.x 同步端点: POST /file_parse (multipart, files 数组, return_md=true)
async function mineruV3Sync(base, apiKey, src) {
  const form = new FormData()
  form.append('files', new Blob([readFileSync(src)]), basename(src))
  form.append('return_md', 'true')
  form.append('parse_method', 'auto')
  form.append('backend', 'pipeline')
  const headers = {}
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  return parserRequest(`${base}/file_parse`, { method: 'POST', body: form, headers })
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

  const submitResp = await parserRequest(`${base}/tasks`, { method: 'POST', body: form, headers })
  if (!submitResp.ok) throw new Error(`MinerU 异步提交失败 HTTP ${submitResp.status}: ${await submitResp.text()}`)
  const task = await submitResp.json()
  const taskId = task.task_id || task.id
  if (!taskId) throw new Error(`MinerU 异步响应缺少 task_id: ${JSON.stringify(task).slice(0, 200)}`)

  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 5000))
    const status = await (await parserRequest(`${base}/tasks/${taskId}`, { headers })).json()
    if (status.status === 'failed') throw new Error(`MinerU 解析失败: ${JSON.stringify(status).slice(0, 300)}`)
    if (status.status === 'completed') {
      const resultResp = await parserRequest(`${base}/tasks/${taskId}/result`, { headers })
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
  return parserRequest(`${base}/v1/file-urls/batch`, { method: 'POST', body: form, headers })
}

// MinerU ≥4.0 异步 JSON 协议: POST /api/v4/extract/file (base64) → 轮询 → zip
export async function mineruV4Async(base, apiKey, src) {
  const headers = { 'Content-Type': 'application/json' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  const resp = await parserRequest(`${base}/api/v4/extract/file`, {
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
    const st = await (await parserRequest(`${base}/api/v4/extract-results/batch/${batchId}`, { headers })).json()
    const results = st.data?.extract_result || st.extract_result || []
    const done = results.filter(x => x.state === 'done')
    const failed = results.find(x => x.state === 'failed')
    if (failed) throw new Error(`MinerU 解析失败: ${JSON.stringify(failed).slice(0, 300)}`)
    if (results.length && done.length === results.length) {
      const zipUrl = done[0].full_zip_url || done[0].zip_url
      if (!zipUrl) throw new Error('MinerU 结果缺少 zip 下载地址')
      const zipResp = await parserRequest(zipUrl)
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
    resp = await parserRequest(`${endpoint.replace(/\/$/, '')}/v1/convert/file`, { method: 'POST', body: form })
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
export function embedImages(md, images, outDir, stem, writeAsset) {
  if (!images.length) return { md, written: 0 }
  const assetDirName = `${stem}_assets`
  const assetDir = join(outDir, assetDirName)
  if (!writeAsset) mkdirSync(assetDir, { recursive: true })
  let idx = 0
  const lines = md.split('\n')
  for (let i = 0; i < lines.length && idx < images.length; i++) {
    if (/^[ \t]*(?:[-*][ \t]+)?<!--\s*image\s*-->[ \t]*$/.test(lines[i])) {
      const img = images[idx]
      const name = `img-${String(idx + 1).padStart(3, '0')}.${(/^(png|jpe?g|gif|webp|svg)$/i.test(img.ext || '') ? img.ext : 'png')}`
      const data = Buffer.from(img.data, 'base64')
      if (writeAsset) writeAsset(`${assetDirName}/${name}`, data)
      else writeFileSync(join(assetDir, name), data)
      lines[i] = `![图${idx + 1}](${assetDirName}/${name})`
      idx++
    }
  }
  return { md: lines.join('\n'), written: idx }
}


export async function convertInput(input, forcedEngine) {
  const ext = extname(input).toLowerCase()
  if (forcedEngine && !['mineru', 'docling', 'markitdown'].includes(forcedEngine)) throw new Error('Unknown parser engine')
  if (!forcedEngine && NATIVE_EXTS.has(ext)) return { md: readFileSync(input, 'utf8'), images: [], engine: 'simple' }
  const engine = forcedEngine || (ext === '.pdf' ? 'mineru' : DOCLING_EXTS.has(ext) ? 'docling' : null)
  if (!engine) throw new Error(`Unsupported input type: ${ext}; OCR is not available`)
  if (engine === 'mineru') return { md: await parseMineru(input), images: [], engine }
  return { ...(engine === 'docling' ? await parseDocling(input) : await parseMarkitdown(input)), engine }
}
