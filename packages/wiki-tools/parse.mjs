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
import { writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { join, dirname, extname, basename, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { upsertDraft } from './docstore.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(
  process.env.CIM_WIKI_WORKSPACE || resolve(__dirname, '..', '..'),
)

import { convertInput, embedImages } from '../wiki-service/parsers.mjs'

function slugify(name) {
  return (
    name
      .replace(/[^a-zA-Z0-9\u4e00-\u9fff-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .replace(/-+/g, '-') || 'doc'
  )
}
function fail(message) {
  console.error(message)
  process.exit(1)
}

function outputLayout({
  system,
  version,
  category,
  subcategory,
  docName,
  input,
  outBase,
  module,
}) {
  // 输出路径：结构化规约 or 旧 module 布局
  const VERSION_IN_NAME = /\b[vV]?\d+([._-]\d+)+\b/
  const stripVersion = (s) =>
    s.replace(/[-_ .]*v?\d+([._-]\d+)+/gi, '').replace(/[-_. ]+$/g, '')
  let outDir, stem, docMeta
  if (system && version && category) {
    const segs = [system, version, category, subcategory].filter(Boolean)
    outDir = join(outBase, ...segs)
    stem = slugify(stripVersion(docName || basename(input, extname(input))))
    if (VERSION_IN_NAME.test(stem))
      fail(
        `文档名不允许包含版本号: "${stem}"（版本由路径段 ${system}/${version} 承载；请用 --name 指定不含版本号的名称）`,
      )
    docMeta = { system, version, category, subcategory: subcategory || null }
  } else if (docName || subcategory) {
    fail('--name/--subcategory 需与 --system --version --category 同时使用')
  } else {
    outDir = join(outBase, slugify(module))
    stem = slugify(basename(input, extname(input)))
    docMeta = {
      system: module,
      version: null,
      category: module,
      subcategory: null,
    }
  }
  return { outDir, stem, docMeta }
}

async function main() {
  const args = process.argv.slice(2)
  if (!args.length)
    fail(
      '用法: node parse.mjs <input_file> [--module MODULE] [--outdir DIR] [--engine mineru|docling|markitdown]',
    )
  const input = resolve(args[0])
  const opt = (name) => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : null
  }
  const module = opt('--module') || 'general'
  const system = opt('--system')
  const version = opt('--version')
  const category = opt('--category')
  const subcategory = opt('--subcategory')
  const docName = opt('--name')
  const forcedEngine = opt('--engine')
  if (
    forcedEngine &&
    !['mineru', 'docling', 'markitdown'].includes(forcedEngine)
  ) {
    fail(
      `--engine 仅支持 mineru|docling|markitdown（均为服务端引擎），收到: ${forcedEngine}`,
    )
  }
  const outBase = opt('--outdir')
    ? resolve(opt('--outdir'))
    : join(PROJECT_ROOT, 'data', 'raw')

  if (!existsSync(input)) fail(`输入文件不存在: ${input}`)
  const ext = extname(input).toLowerCase()

  const result = await convertInput(input, forcedEngine)
  const { md: content, images, engine } = result

  if (!content.trim())
    fail('解析结果为空（可能是图片型 PDF，需 OCR），本次摄取终止。')

  const { outDir, stem, docMeta } = outputLayout({
    system,
    version,
    category,
    subcategory,
    docName,
    input,
    outBase,
    module,
  })
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
    source_file: existsSync(rawCopy)
      ? relative(PROJECT_ROOT, rawCopy).split('\\').join('/')
      : null,
  })

  console.log(`engine: ${engine}`)
  console.log(`output: ${outPath}`)
  console.log(`chars: ${embedded.md.length}`)
  if (images.length)
    console.log(
      `images: ${embedded.written}/${images.length} -> ${stem}_assets/`,
    )
  console.log(`manifest: ${record.doc_id} [${record.state}] (${relPath})`)
}

main().catch((e) => fail(e.message))
