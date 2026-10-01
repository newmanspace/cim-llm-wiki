#!/usr/bin/env node
// Stage 5 编译：data/work/<bundle>/nodes.json → data/wiki/ 原子化 Markdown 页面
// 用法: node compile.mjs <nodes.json 路径或 bundle_id> [--wiki-root DIR]
// 仅编译已放行节点（review_level != archive）；archive 节点分流到 data/review/archived/<bundle>/
// 状态门禁: 源文档在 manifest 中登记为 draft 时禁止编译（须先 freeze）；frozen 文档编译入库后自动激活为 active
// 页面规范见 references/frontmatter.md
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadManifest, activateIfFrozen } from './docstore.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..', '..')

const TYPE_TO_SUBDIR = {
  business_rule: 'business', business_object: 'business', workflow: 'business',
  api: 'apis', design: 'designs', module: 'modules',
  requirement: 'requirements', project: 'requirements', test_case: 'tests',
  release: 'releases', deployment: 'deployments',
  incident: 'incidents', defect: 'incidents',
  faq: 'knowledge', knowledge_article: 'knowledge'
}
const WIKI_SUBDIRS = [
  'products', 'projects', 'requirements', 'designs', 'modules', 'business',
  'apis', 'tests', 'releases', 'deployments', 'operations', 'incidents',
  'knowledge', 'sources', 'virtual'
]
const LIST_FIELDS = ['related_requirements', 'related_designs', 'related_rules', 'related_apis', 'related_code', 'related_tests']
const SCALAR_FIELDS = [
  'api_type', 'integration_tier', 'integration_system', 'isa95_mapping',
  'endpoint', 'protocol', 'code_repository', 'code_class', 'code_method', 'git_ref'
]

const slugify = id => id.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
const yamlEscape = v => /[:#[\]{}&*!|>%@"']/.test(String(v)) ? `"${v}"` : String(v)

function renderPage(node, now) {
  const fm = ['---', `id: ${node.id}`, `type: ${node.type}`]
  for (const f of SCALAR_FIELDS) if (node[f]) fm.push(`${f}: ${yamlEscape(node[f])}`)
  fm.push(`product: ${node.product || 'Semiconductor-MES'}`)
  fm.push(`version: ${node.version || 'v1.0'}`)
  fm.push(`domain: ${node.domain || ''}`)
  fm.push(`module: ${node.module || ''}`)
  fm.push(`source: ${node.source || ''}`)
  for (const f of LIST_FIELDS) {
    const items = node[f] || []
    if (items.length) {
      fm.push(`${f}:`)
      for (const i of items) fm.push(`  - "${i}"`)
    }
  }
  const qs = node.qscore || {}
  const total = qs.total ?? node.confidence ?? 0
  fm.push(`confidence: ${Number(total).toFixed(4)}`)
  fm.push(`review_level: ${node.review_level || 'L1_expert'}`)
  fm.push(`status: ${node.status || 'published'}`)
  fm.push(`reviewer: ${node.reviewer || 'auto'}`)
  fm.push(`created_at: ${node.created_at || now}`)
  fm.push(`updated_at: ${now}`)
  fm.push('---')

  const body = [
    '', `# ${node.title}`, '', String(node.content).trim(), '',
    '---',
    `> **来源文档**: \`${node.source || ''}\``,
    `> **置信度**: ${(total * 100).toFixed(2)}%`,
    `> **适用版本**: ${node.version || 'v1.0'}`,
    ''
  ]
  return fm.join('\n') + '\n' + body.join('\n')
}

function main() {
  const args = process.argv.slice(2)
  if (!args.length) { console.error('用法: node compile.mjs <nodes.json 路径或 bundle_id> [--wiki-root DIR]'); process.exit(1) }
  const rootIdx = args.indexOf('--wiki-root')
  const wikiRoot = rootIdx >= 0 ? resolve(args[rootIdx + 1]) : join(PROJECT_ROOT, 'data', 'wiki')

  let src = resolve(args[0])
  if (!existsSync(src)) src = join(PROJECT_ROOT, 'data', 'work', args[0], 'nodes.json')
  if (!existsSync(src)) { console.error(`找不到 nodes.json: ${args[0]}`); process.exit(1) }

  const data = JSON.parse(readFileSync(src, 'utf-8'))
  const nodes = data.nodes || (Array.isArray(data) ? data : [])
  const bundleId = data.bundle_id || dirname(src).split('/').pop()
  const now = data.compiled_at || new Date().toISOString().replace(/\.\d+Z$/, 'Z')

  for (const sub of WIKI_SUBDIRS) mkdirSync(join(wikiRoot, sub), { recursive: true })

  // 状态门禁：manifest 中登记为 draft 的源文档禁止编译入库
  const docPaths = [...new Set([data.source_doc, ...(data.nodes || []).map(n => n.source)].filter(s => s && String(s).startsWith('data/')))]
  const manifest = loadManifest(PROJECT_ROOT)
  const drafts = manifest.docs.filter(r => docPaths.includes(r.path) && r.state === 'draft')
  if (drafts.length && !args.includes('--allow-draft')) {
    console.error(`编译被拒绝：以下源文档仍处于 draft 状态（须先修正定稿并 freeze）:\n${drafts.map(d => `  ${d.doc_id}  ${d.path}`).join('\n')}\n命令: node doc-state.mjs freeze <doc_id>\n（例外通道: --allow-draft，仅用于草稿预演，不激活状态）`)
    process.exit(1)
  }

  const written = [], archived = []
  for (const node of nodes) {
    node.source ||= data.source_doc || ''
    node.module ||= data.module || ''
    node.product ||= data.product || 'Semiconductor-MES'
    node.version ||= data.version || 'v1.0'
    if (node.review_level === 'archive') {
      const adir = join(PROJECT_ROOT, 'data', 'review', 'archived', bundleId)
      mkdirSync(adir, { recursive: true })
      writeFileSync(join(adir, `${slugify(node.id)}.json`), JSON.stringify(node, null, 2), 'utf-8')
      archived.push(node.id)
      continue
    }
    const subdir = TYPE_TO_SUBDIR[node.type] || 'knowledge'
    const rel = join(subdir, `${slugify(node.id)}.md`)
    writeFileSync(join(wikiRoot, rel), renderPage(node, now), 'utf-8')
    written.push(rel)
  }

  // frozen 源文档编译入库后自动激活为 active（draft 预演通道不激活）
  let activated = []
  if (!args.includes('--allow-draft')) {
    activated = activateIfFrozen(PROJECT_ROOT, docPaths, `compile.mjs (${bundleId})`, bundleId)
  }

  console.log(`bundle: ${bundleId}`)
  console.log(`published: ${written.length}`)
  for (const w of written) console.log(`  ✓ data/wiki/${w}`)
  if (archived.length) console.log(`archived: ${archived.join(', ')}`)
  for (const a of activated) console.log(`activated: ${a.doc_id} (${a.version ?? '-'}) frozen → active`)
}

main()
