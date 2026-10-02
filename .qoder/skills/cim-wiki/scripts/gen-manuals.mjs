#!/usr/bin/env node
// 文档视图层：把 Stage 1 解析稿（data/raw）按原章节结构渲染为 data/wiki/manuals/ 下的可读用户手册
// 原则：存储原子化（面向 AI）不变，此脚本只生成"面向人"的聚合视图，不新增知识节点
// 用法: node gen-manuals.mjs   （来源 = 已批准 bundle nodes.json 中引用的 source 去重）
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, rmSync, cpSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadManifest } from './docstore.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve_root()
function resolve_root() {
  // scripts 位于 .qoder/skills/cim-wiki/scripts → 上溯 4 级到项目根
  return join(__dirname, '..', '..', '..', '..')
}

const RAW = join(ROOT, 'data', 'raw')
const WORK = join(ROOT, 'data', 'work')

// wiki 按 project 分树：data/wiki/<project>/doc/manuals/...
function resolveProjectDir() {
  if (process.env.ADMIN_PROJECT_ID) return process.env.ADMIN_PROJECT_ID
  const regPath = join(ROOT, 'data', 'documents', 'project-registry.json')
  if (existsSync(regPath)) {
    const ps = JSON.parse(readFileSync(regPath, 'utf-8')).projects || {}
    const ids = Object.keys(ps)
    if (ids.length === 1) return ids[0]
  }
  return 'default'
}
const PROJECT_DIR = resolveProjectDir()
const OUT = join(ROOT, 'data', 'wiki', PROJECT_DIR, 'doc', 'manuals')

// 1. 收集已批准/已发布 bundle 引用的解析稿
const sources = new Map() // rawRelPath -> {bundleIds, moduleNode}
for (const b of existsSync(WORK) ? readdirSync(WORK) : []) {
  const p = join(WORK, b, 'nodes.json')
  if (!existsSync(p)) continue
  const d = JSON.parse(readFileSync(p, 'utf-8'))
  if (!d.compiled_at) continue // 未放行的包不出文档视图
  for (const n of d.nodes || []) {
    const s = n.source || (String(d.source_doc || '').endsWith('.md') ? d.source_doc : '') // 节点缺 source 时回退 bundle 级 md 源
    if (!s) continue
    const e = sources.get(s) || { bundles: new Set(), moduleNode: null }
    e.bundles.add(d.bundle_id)
    if (n.type === 'module') e.moduleNode = n
    sources.set(s, e)
  }
}

// 2. 渲染
function clean(text) {
  let lines = text.split('\n')
  // 去图片占位与目录跳转行
  lines = lines.filter(l => !/^\s*[-*]?\s*<!--\s*image\s*-->\s*$/.test(l))
  lines = lines.filter(l => !/^\s*[-*]\s*<!--\s*image\s*-->\s*$/.test(l))
  lines = lines.filter(l => !/^\s*\[[^\]]*\]\(\.\)\s*$/.test(l))
  lines = lines.filter(l => !/^##\s*目录\s*$/.test(l)) // 跳转链接已去除，空目录节无意义
  // 裸编号标题 → markdown 标题（仅当整行就是编号+短标题）
  lines = lines.map(l => {
    const m = l.match(/^(\d+(?:\.\d+)*)\s+(\S.{0,70})$/)
    if (!m) return l
    const depth = Math.min(1 + m[1].split('.').length, 6)
    return '#'.repeat(depth) + ' ' + m[1] + ' ' + m[2].trim()
  })
  return lines.join('\n').replace(/\n{3,}/g, '\n\n')
}

function humanTitle(body, fallback) {
  const h = body.match(/^#\s+(.+)$/m)
  if (h) return h[1].trim()
  const first = body.split('\n').map(s => s.trim()).find(s => s && !s.startsWith('|'))
  if (!first) return fallback
  return first.replace(/\\_/g, ' ').replace(/_{2,}/g, ' ').trim()
}

rmSync(OUT, { recursive: true, force: true }) // 全量重建，避免陈旧视图残留
mkdirSync(OUT, { recursive: true })
const manifest = loadManifest(ROOT)
const docByPath = Object.fromEntries(manifest.docs.map(r => [r.path, r]))
let count = 0
for (const [rawRel, info] of sources) {
  const abs = join(ROOT, rawRel)
  if (!existsSync(abs)) { console.warn(`跳过（解析稿不存在）: ${rawRel}`); continue }
  const rec = docByPath[rawRel]
  if (rec && rec.state === 'draft') { console.warn(`跳过（文档仍为 draft，未定稿不出人读视图）: ${rec.doc_id}`); continue }
  const raw = readFileSync(abs, 'utf-8')
  const body = clean(raw)
  const docStem = basename(rawRel, '.md')
  // raw 路径中 data/raw 与文件名之间的层级（系统/版本/大类/子类 或旧 module）原样映射到人读视图
  const relDir = rawRel.split('/').slice(2, -1).join('/') || 'misc'
  const title = humanTitle(body, docStem).replace(/\*\*/g, '').replace(/"/g, "'").trim()
  const hasH1 = /^#\s+/m.test(body)
  const dir = join(OUT, relDir)
  mkdirSync(dir, { recursive: true })
  const modLink = info.moduleNode
    ? `> 对应原子知识节点（面向 AI）：模块驾驶舱页 [${info.moduleNode.id}](/${PROJECT_DIR}/doc/modules/${info.moduleNode.id.toLowerCase()})`
    : `> 对应原子知识节点（面向 AI）：见侧边栏「领域知识库 / 流程与宏观规则」分组`
  const page = `---
title: "${title}"
type: manual_view
${rec ? `system: ${rec.system}
version: ${rec.version ?? 'n/a'}
category: ${rec.category}
${rec.subcategory ? `subcategory: ${rec.subcategory}\n` : ''}doc_state: ${rec.state}
` : `module: ${relDir}
`}source: ${rawRel}
bundles: ${[...info.bundles].join(', ')}
generated: true
---

${hasH1 ? '' : `# ${title}\n\n`}
${modLink}

---

${body}
`
  writeFileSync(join(dir, `${docStem}.md`), page, 'utf-8')
  // 图片资源目录随页面一并分发（md 内为相对引用 <stem>_assets/…）
  const assetSrc = join(ROOT, dirname(rawRel), `${docStem}_assets`)
  if (existsSync(assetSrc)) cpSync(assetSrc, join(dir, `${docStem}_assets`), { recursive: true })
  count++
}
console.log(`gen-manuals: ${count} 本人读视图 -> data/wiki/doc/manuals/`)
