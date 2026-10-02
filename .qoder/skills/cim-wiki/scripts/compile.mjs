#!/usr/bin/env node
// Stage 5 编译：data/work/<bundle>/nodes.json → data/wiki/ 原子化 Markdown 页面
// 用法: node compile.mjs <nodes.json 路径或 bundle_id> [--wiki-root DIR]
// 仅编译已放行节点（review_level != archive）；archive 节点分流到 data/review/archived/<bundle>/
// 状态门禁: 源文档在 manifest 中登记为 draft 时禁止编译（须先 freeze）；frozen 文档编译入库后自动激活为 active
// 事务码注册表: api 节点的 transaction_code 全局唯一，登记于 data/documents/api-registry.json，冲突拒绝入库
// 页面规范见 references/frontmatter.md
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadManifest, activateIfFrozen } from './docstore.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..', '..')

const TYPE_TO_SUBDIR = {
  business_rule: 'rules_or_business', business_object: 'domain', workflow: 'business',
  api: 'apis', design: 'designs', module: 'modules', data_dictionary: 'dictionaries',
  data_schema: 'schemas', code_index: 'code-index',
  requirement: 'requirements', project: 'requirements', test_case: 'tests',
  release: 'releases', deployment: 'deployments',
  incident: 'incidents', defect: 'incidents',
  faq: 'knowledge', knowledge_article: 'knowledge', product: 'products'
}
// 双平面物理分库：doc = 领域知识库（人读/导航），code = 代码契约库（工程/自动化）
// business_object（domain card）与微观 business_rule（granularity=micro 或带 applies_to）入 code；scenario 与宏观规则入 doc
const DOC_DIRS = ['manuals', 'business', 'designs', 'modules', 'requirements', 'dictionaries', 'tests', 'releases', 'deployments', 'operations', 'incidents', 'knowledge', 'products', 'projects', 'sources', 'virtual']
const CODE_DIRS = ['domain', 'apis', 'rules', 'schemas', 'code-index']
function nodeLoc(node) {
  const t = node.type
  if (t === 'api') return ['code', 'apis']
  if (t === 'data_schema') return ['code', 'schemas']
  if (t === 'code_index') return ['code', 'code-index']
  if (t === 'business_object') return ['code', 'domain']
  if (t === 'business_rule') {
    const micro = node.granularity === 'micro' || (Array.isArray(node.applies_to) && node.applies_to.length > 0)
    return micro ? ['code', 'rules'] : ['doc', 'business']
  }
  const dir = { design: 'designs', module: 'modules', requirement: 'requirements', project: 'requirements', test_case: 'tests', release: 'releases', deployment: 'deployments', incident: 'incidents', defect: 'incidents', faq: 'knowledge', knowledge_article: 'knowledge', data_dictionary: 'dictionaries', product: 'products', workflow: 'business' }[t] || 'knowledge'
  return ['doc', dir]
}
// 旧格式 wikilink 规范化为平面前缀路径（存量 bundle nodes.json 无需手改）
function normLink(v) {
  return String(v).replace(/\[\[([^\]]+)\]\]/g, (_, raw) => {
    const t = raw.trim().replace(/^\//, '')
    if (/^(doc|code)\//.test(t)) return `[[${t}]]`
    const seg = t.split('/')
    const rest = seg.slice(1).join('/')
    if (seg[0] === 'apis') return `[[code/apis/${rest}]]`
    if (seg[0] === 'schemas') return `[[code/schemas/${rest}]]`
    if (seg[0] === 'code-index') return `[[code/code-index/${rest}]]`
    if (seg[0] === 'business') {
      const name = seg[seg.length - 1]
      const p = name.startsWith('br-') ? 'code/rules' : name.startsWith('bo-') ? 'code/domain' : 'doc/business'
      return `[[${p}/${rest}]]`
    }
    if (/^(products|projects|requirements|designs|modules|tests|releases|deployments|operations|incidents|knowledge|sources|virtual|dictionaries)$/.test(seg[0])) return `[[doc/${t}]]`
    return `[[${t}]]`
  })
}
const LIST_FIELDS = ['related_requirements', 'related_designs', 'related_rules', 'related_apis', 'related_code', 'related_tests', 'rule_tags', 'applies_to', 'domain_objects', 'preconditions', 'scenario_variants']
const SCALAR_FIELDS = [
  'api_type', 'integration_tier', 'integration_system', 'isa95_mapping',
  'endpoint', 'protocol', 'code_repository', 'code_class', 'code_method', 'git_ref',
  'severity', 'rule_category', 'verification_status', 'granularity',
  'domain_object', 'primary_key', 'synthesized',
  'operation', 'transaction_code', 'pattern'
]

const slugify = id => id.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
const yamlEscape = v => /[:#[\]{}&*!|>%@"']/.test(String(v)) ? `"${v}"` : String(v)

function renderPage(node, now, loc) {
  const [plane] = loc
  const fm = ['---', `id: ${node.id}`, `type: ${node.type}`, `plane: ${plane}`]
  for (const f of SCALAR_FIELDS) if (node[f]) fm.push(`${f}: ${yamlEscape(node[f])}`)
  fm.push(`product: ${node.product || 'Semiconductor-MES'}`)
  fm.push(`version: ${node.version || 'v1.0'}`)
  fm.push(`domain: ${node.domain || ''}`)
  fm.push(`module: ${node.module || ''}`)
  if (Array.isArray(node.source)) {
    fm.push('source:')
    for (const s of node.source) fm.push(`  - "${s}"`)
  } else {
    fm.push(`source: ${node.source || ''}`)
  }
  for (const f of LIST_FIELDS) {
    const items = node[f] || []
    if (items.length) {
      fm.push(`${f}:`)
      for (const i of items) fm.push(`  - "${normLink(i)}"`)
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
    '', `# ${node.title}`, '', normLink(String(node.content).trim()), '',
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

  for (const d of DOC_DIRS) mkdirSync(join(wikiRoot, 'doc', d), { recursive: true })
  for (const d of CODE_DIRS) mkdirSync(join(wikiRoot, 'code', d), { recursive: true })

  // 状态门禁：manifest 中登记为 draft 的源文档禁止编译入库
  const docPaths = [...new Set([data.source_doc, ...(data.nodes || []).map(n => n.source)].filter(s => s && String(s).startsWith('data/')))]
  const manifest = loadManifest(PROJECT_ROOT)
  const drafts = manifest.docs.filter(r => docPaths.includes(r.path) && r.state === 'draft')
  if (drafts.length && !args.includes('--allow-draft')) {
    console.error(`编译被拒绝：以下源文档仍处于 draft 状态（须先修正定稿并 freeze）:\n${drafts.map(d => `  ${d.doc_id}  ${d.path}`).join('\n')}\n命令: node doc-state.mjs freeze <doc_id>\n（例外通道: --allow-draft，仅用于草稿预演，不激活状态）`)
    process.exit(1)
  }

  // api 事务码注册表：transaction_code 全局唯一，一码一卡，冲突拒绝整批入库
  const regPath = join(PROJECT_ROOT, 'data', 'documents', 'api-registry.json')
  const registry = existsSync(regPath) ? JSON.parse(readFileSync(regPath, 'utf-8')) : {}
  let regDirty = false
  for (const node of nodes) {
    if (node.type !== 'api' || !node.transaction_code || node.review_level === 'archive') continue
    const code = String(node.transaction_code).toUpperCase()
    const page = relative(PROJECT_ROOT, join(wikiRoot, 'code', 'apis', `${slugify(node.id)}.md`)).split('\\').join('/')
    if (registry[code] && registry[code].page !== page) {
      console.error(`编译被拒绝：transaction_code ${code} 已登记到 ${registry[code].page}（节点 ${registry[code].id}），与本批次节点 ${node.id} 冲突。同一事务码只允许一张 api card。`)
      process.exit(1)
    }
    registry[code] = { page, id: node.id, bundle: bundleId, registered_at: now }
    regDirty = true
  }
  if (regDirty) { mkdirSync(dirname(regPath), { recursive: true }); writeFileSync(regPath, JSON.stringify(registry, null, 2) + '\n', 'utf-8') }

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
    const loc = nodeLoc(node)
    node.plane = loc[0]
    if (node.type === 'business_rule') node.granularity ||= (loc[1] === 'rules' ? 'micro' : 'macro')
    const rel = join(loc[0], loc[1], `${slugify(node.id)}.md`)
    writeFileSync(join(wikiRoot, rel), renderPage(node, now, loc), 'utf-8')
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
