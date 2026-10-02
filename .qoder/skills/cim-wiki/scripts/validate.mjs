#!/usr/bin/env node
// Stage 6 Wiki Lint 校验（方案 §7.2 的本地可行子集）
// 用法: node validate.mjs [wiki_root]   （默认 data/wiki）
//
// 检查规则:
//   1. metadata_error   : Frontmatter 缺失或必填字段不全
//   2. filename_mismatch: 文件名与 id slug 不一致
//   3. broken_link      : [[wikilink]] 指向不存在的文件
//   4. orphan_knowledge : 无任何入链的页面（virtual/index 页除外）
//   5. duplicate_suspect: 同模块同类型且 ID 高度相似的页面对
//   6. outdated         : updated_at 超过 365 天
//   7. doc_state        : 文档注册表（data/documents/manifest.json）校验——
//        非 draft 文档文件必须存在且 sha256 与 freeze 时一致（doc_drift/doc_missing，error）；
//        已发布 wiki 页面的 source 不得指向 draft 文档（doc_state，error）
//   8. 图闭合（api/scenario card v1）:
//        api card: operation 必须是 Operation 词表值（error）；transaction_code 全库唯一（error）；
//                  必须有 preconditions 或正文显式 None（warning）；缺 Purpose/Effects/Errors 槽位（warning）
//        scenario: pattern 枚举（error）；what-next-driven 缺分支表 / 缺 Steps 表（warning）
//        rule: applies_to 指向的节点必须是 api 类型（warning，悬空由 broken_link 覆盖）
//   9. 双平面物理分库: 页面必须位于 doc/（领域知识库）或 code/（代码契约库）之一，
//        且落点与类型路由一致（plane_mismatch，error）：
//        code/ = apis、schemas、code-index、domain（domain card）、rules（微观规则 granularity=micro）
//        doc/  = business（scenario + 宏观规则）、designs、modules、requirements、dictionaries、tests、
//                operations、releases、deployments、incidents、knowledge、products、projects、manuals(人读视图)
// 退出码: 0 = 无 error（warning 允许），1 = 存在 error
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { loadManifest } from './docstore.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..', '..')

const REQUIRED_FIELDS = ['id', 'type', 'product', 'version', 'domain', 'module', 'source', 'status']
const WIKILINK_RE = /\[\[([^\]]+)\]\]/g

const errors = []
const warnings = []

function walkMd(dir, root, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walkMd(p, root, out)
    else if (e.name.endsWith('.md')) out.push(relative(root, p).split('\\').join('/'))
  }
  return out
}

function parseFrontmatter(text) {
  if (!text.startsWith('---')) return null
  const parts = text.split('---')
  if (parts.length < 3) return null
  const fm = {}
  let currentKey = null
  for (const line of parts[1].split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const m = t.match(/^([\w-]+):\s*(.*)$/)
    if (m && !line.startsWith(' ')) {
      currentKey = m[1]
      fm[currentKey] = m[2].trim() || []
    } else if (t.startsWith('- ') && currentKey) {
      const item = t.slice(2).trim().replace(/^"|"$/g, '')
      if (!Array.isArray(fm[currentKey])) fm[currentKey] = fm[currentKey] ? [fm[currentKey]] : []
      fm[currentKey].push(item)
    }
  }
  return fm
}

const slugify = id => String(id).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')

// 双平面路由判据（与 compile.mjs nodeLoc 保持一致）
function expectedLoc(fm) {
  const t = fm.type
  if (t === 'api') return { plane: 'code', dir: 'apis' }
  if (t === 'data_schema') return { plane: 'code', dir: 'schemas' }
  if (t === 'code_index') return { plane: 'code', dir: 'code-index' }
  if (t === 'business_object') return { plane: 'code', dir: 'domain' }
  if (t === 'business_rule') {
    const micro = fm.granularity === 'micro' || (Array.isArray(fm.applies_to) && fm.applies_to.length > 0)
    return micro ? { plane: 'code', dir: 'rules' } : { plane: 'doc', dir: 'business' }
  }
  const dirs = { design: 'designs', module: 'modules', requirement: 'requirements', project: 'requirements', test_case: 'tests', release: 'releases', deployment: 'deployments', incident: 'incidents', defect: 'incidents', faq: 'knowledge', knowledge_article: 'knowledge', data_dictionary: 'dictionaries', product: 'products', workflow: 'business' }
  return { plane: 'doc', dir: dirs[t] || 'knowledge' }
}

// 受控词表：references/vocabulary.md 是 Rule Category / Operation / Relation 枚举的唯一来源
function loadVocabulary() {
  const p = join(__dirname, '..', 'references', 'vocabulary.md')
  if (!existsSync(p)) return null
  const sets = { category: new Set(), operation: new Set(), relation: new Set() }
  let cur = null
  for (const line of readFileSync(p, 'utf-8').split('\n')) {
    const h = line.match(/^## (Rule Category|Operation|Relation)\b/)
    if (h) { cur = h[1] === 'Rule Category' ? 'category' : h[1] === 'Operation' ? 'operation' : 'relation'; continue }
    const m = line.match(/^- ([A-Za-z_][A-Za-z0-9_]*)/)
    if (m && cur) sets[cur].add(m[1])
  }
  return sets
}

function main() {
  const root = resolve(process.argv[2] || join(PROJECT_ROOT, 'data', 'wiki'))
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    console.error(`wiki 目录不存在: ${root}`)
    process.exit(1)
  }

  const keys = walkMd(root, root)
  const incoming = Object.fromEntries(keys.map(k => [k, 0]))
  const metas = {}
  const vocab = loadVocabulary()

  for (const key of keys) {
    const text = readFileSync(join(root, key), 'utf-8')
    const fm = parseFrontmatter(text)

    if (key === 'index.md') continue // 站点首页由 gen-sidebar.mjs 生成，不适用知识节点校验
    if (/^(doc\/)?manuals\//.test(key)) continue // 人读视图层（gen-manuals.mjs 生成），不参与知识节点校验

    if (fm === null) {
      errors.push(`[metadata_error] ${key}: 缺少 YAML Frontmatter`)
    } else {
      const missing = REQUIRED_FIELDS.filter(f => !(Array.isArray(fm[f]) ? fm[f].length : fm[f]))
      if (missing.length) errors.push(`[metadata_error] ${key}: 缺少必填字段 [${missing.join(', ')}]`)
      metas[key] = fm
    }

    const nodeId = fm?.id
    if (nodeId && !/(^|\/)virtual\//.test(key) && dirname(key) !== '.' ) {
      const stem = key.split('/').pop().replace(/\.md$/, '')
      if (stem !== slugify(nodeId)) warnings.push(`[filename_mismatch] ${key}: id=${nodeId} 期望文件名 ${slugify(nodeId)}.md`)
    }

    for (const [, target] of text.matchAll(WIKILINK_RE)) {
      const t = target.trim().replace(/^\//, '')
      if (incoming[t] !== undefined) incoming[t]++
      else if (t.endsWith('.md') && incoming[t.slice(0, -3)] !== undefined) incoming[t.slice(0, -3)]++
      else errors.push(`[broken_link] ${key}: [[${t}]] 不存在`)
    }

    const updated = fm?.updated_at
    if (updated && !Array.isArray(updated)) {
      const ts = Date.parse(updated)
      if (Number.isNaN(ts)) warnings.push(`[metadata_error] ${key}: updated_at 格式非法: ${updated}`)
      else if ((Date.now() - ts) / 86400000 > 365) warnings.push(`[outdated] ${key}: updated_at 超过 365 天，建议复审`)
    }
  }

  for (const key of keys) {
    if (incoming[key] === 0 && !/(^|\/)virtual\//.test(key) && !/(^|\/)manuals\//.test(key) && key !== 'index.md') {
      warnings.push(`[orphan_knowledge] ${key}: 无入链，建议挂载到模块驾驶舱页`)
    }
  }

  const byGroup = {}
  for (const [key, fm] of Object.entries(metas)) {
    const g = `${fm.module || ''}|${fm.type || ''}`
    ;(byGroup[g] ||= []).push(key)
  }
  for (const [g, group] of Object.entries(byGroup)) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const t1 = String(metas[group[i]].id || group[i]).toLowerCase()
        const t2 = String(metas[group[j]].id || group[j]).toLowerCase()
        if (t1 !== t2 && (t1.includes(t2) || t2.includes(t1))) {
          const [module, type] = g.split('|')
          warnings.push(`[duplicate_suspect] ${group[i]} 与 ${group[j]}: 同模块(${module})同类型(${type})且 ID 高度相似，请人工确认是否重复`)
        }
      }
    }
  }

  // 7. 文档状态管控校验
  const manifest = loadManifest(PROJECT_ROOT)
  const byPath = Object.fromEntries(manifest.docs.map(r => [r.path, r]))
  for (const r of manifest.docs) {
    const abs = join(PROJECT_ROOT, r.path)
    if (!existsSync(abs)) { errors.push(`[doc_missing] ${r.doc_id}: ${r.path} 不存在`); continue }
    if (r.state !== 'draft' && r.sha256) {
      const h = createHash('sha256').update(readFileSync(abs)).digest('hex')
      if (h !== r.sha256) errors.push(`[doc_drift] ${r.doc_id}: 内容已变更但状态为 ${r.state}（须先 unfreeze 再修正并重新 freeze）`)
    }
  }
  const wikilinkKey = link => {
    const t = String(link).trim().replace(/^\[\[|\]\]$/g, '').replace(/^\//, '')
    if (incoming[t] !== undefined) return t
    if (t.endsWith('.md') && incoming[t.slice(0, -3)] !== undefined) return t.slice(0, -3)
    return null
  }
  const txCodes = {}
  for (const [key, fm] of Object.entries(metas)) {
    const src = typeof fm.source === 'string' ? fm.source : ''
    const rec = byPath[src]
    if (rec && rec.state === 'draft') errors.push(`[doc_state] ${key}: source 文档 ${rec.doc_id} 仍为 draft（未定稿即发布，违反状态门禁）`)
    // 双平面路由校验（virtual / sources 聚合层豁免落点目录，仅要求平面正确）
    if (!fm.virtual) {
      const seg = key.split('/')
      const pagePlane = ['doc', 'code'].includes(seg[0]) ? seg[0] : null
      const pageDir = pagePlane ? seg[1] : seg[0]
      const exp = expectedLoc(fm)
      if (!pagePlane) errors.push(`[plane_mismatch] ${key}: 原子知识页必须位于 doc/（领域知识库）或 code/（代码契约库）平面目录下`)
      else if (!['virtual', 'sources'].includes(pageDir) && (exp.plane !== pagePlane || exp.dir !== pageDir)) {
        errors.push(`[plane_mismatch] ${key}: type=${fm.type}${fm.granularity ? '/' + fm.granularity : ''} 应落在 ${exp.plane}/${exp.dir}/`)
      }
    }
    if (fm.plane && !['doc', 'code'].includes(fm.plane)) errors.push(`[metadata_error] ${key}: plane 取值非法: ${fm.plane}`)
    if (fm.granularity && !['macro', 'micro'].includes(fm.granularity)) errors.push(`[metadata_error] ${key}: granularity 取值非法: ${fm.granularity}`)
    if (fm.type === 'business_rule' && !fm.granularity) warnings.push(`[granularity_missing] ${key}: business_rule 缺少 granularity（macro|micro）`)
    // rule card v2：business_rule 一旦声明 severity 就必须使用结构化槽位
    if (fm.type === 'business_rule' && fm.severity) {
      const pageText = readFileSync(join(root, key), 'utf-8')
      const missing = ['## Statement', '## Constraint', '## Violation'].filter(s => !pageText.includes(s))
      if (missing.length) warnings.push(`[rule_card_incomplete] ${key}: 声明了 severity=${fm.severity} 但缺少槽位 [${missing.join(', ')}]`)
      if (!['Critical', 'High', 'Medium', 'Low'].includes(fm.severity)) warnings.push(`[rule_card_incomplete] ${key}: severity 取值非法: ${fm.severity}`)
      if (fm.severity === 'Critical' && fm.review_level !== 'L2_arch') errors.push(`[metadata_error] ${key}: severity=Critical 必须为 L2_arch 人审（当前 ${fm.review_level}）`)
    }
    // 词表一致性 + domain card 槽位
    if (vocab) {
      if (fm.type === 'business_rule' && fm.rule_category && !Array.isArray(fm.rule_category) && !vocab.category.has(fm.rule_category)) {
        errors.push(`[vocabulary_violation] ${key}: rule_category "${fm.rule_category}" 未在 vocabulary.md 登记`)
      }
      if (fm.type === 'business_object' && fm.domain_object) {
        const raw = fm.rule_tags
        const tags = raw ? (Array.isArray(raw) ? raw : String(raw).replace(/^\[|\]$/g, '').split(',')).map(s => String(s).trim().replace(/^"|"$/g, '')).filter(Boolean) : []
        for (const t of tags) if (!vocab.category.has(t)) errors.push(`[vocabulary_violation] ${key}: rule_tags 含未登记值 "${t}"`)
        const pageText = readFileSync(join(root, key), 'utf-8')
        const missing = ['## State Machine', '## Attributes', '## Relations', '## Reasoning Hint', '## Invariants'].filter(s => !pageText.includes(s))
        if (missing.length) warnings.push(`[domain_card_incomplete] ${key}: domain card 缺少槽位 [${missing.join(', ')}]`)
      }
    }
    // rule card 图闭合：applies_to 必须指向 api 节点（存在性已由 broken_link 覆盖）
    if (fm.type === 'business_rule' && Array.isArray(fm.applies_to)) {
      for (const l of fm.applies_to) {
        const tk = wikilinkKey(l)
        if (tk && metas[tk] && metas[tk].type !== 'api') warnings.push(`[applies_to_target] ${key}: applies_to 指向非 api 节点 ${tk}（type=${metas[tk].type}）`)
      }
    }
    // api card v1：operation 词表、事务码唯一、Preconditions 槽位
    if (fm.type === 'api' && (fm.operation || fm.transaction_code)) {
      const pageText = readFileSync(join(root, key), 'utf-8')
      if (fm.operation && vocab && !vocab.operation.has(fm.operation)) {
        errors.push(`[vocabulary_violation] ${key}: operation "${fm.operation}" 未在 vocabulary.md 登记`)
      }
      if (fm.transaction_code) (txCodes[String(fm.transaction_code).toUpperCase()] ||= []).push(key)
      const pres = Array.isArray(fm.preconditions) ? fm.preconditions.filter(Boolean) : []
      if (!pres.length && !/##\s*Preconditions\s*\n[^\n]*\bNone\b/i.test(pageText)) {
        warnings.push(`[api_card_incomplete] ${key}: 无 preconditions 引用且正文 Preconditions 槽位未显式写 None`)
      }
      const missing = ['## Purpose', '## Effects', '## Errors'].filter(s => !pageText.includes(s))
      if (missing.length) warnings.push(`[api_card_incomplete] ${key}: 缺少槽位 [${missing.join(', ')}]`)
      if (fm.domain_objects && !Array.isArray(fm.domain_objects) && String(fm.domain_objects).trim()) {
        warnings.push(`[api_card_incomplete] ${key}: domain_objects 应为列表`)
      }
    }
    // scenario card v1：pattern 枚举与必需槽位
    if (fm.type === 'workflow' && fm.pattern) {
      if (!['linear', 'what-next-driven'].includes(fm.pattern)) errors.push(`[metadata_error] ${key}: pattern 取值非法: ${fm.pattern}（仅 linear | what-next-driven）`)
      const pageText = readFileSync(join(root, key), 'utf-8')
      if (!pageText.includes('## Steps')) warnings.push(`[scenario_card_incomplete] ${key}: 缺少 Steps 表`)
      if (fm.pattern === 'what-next-driven' && !pageText.includes('## What-Next Branches')) warnings.push(`[scenario_card_incomplete] ${key}: what-next-driven 流程缺少 What-Next Branches 分支表`)
    }
  }

  for (const [code, pages] of Object.entries(txCodes)) {
    if (new Set(pages).size > 1) errors.push(`[transaction_code_conflict] 事务码 ${code} 被多个 api card 使用: ${[...new Set(pages)].join(', ')}（一码一卡）`)
  }

  console.log(`扫描页面: ${keys.length}`)
  for (const w of warnings) console.log(`WARN  ${w}`)
  for (const e of errors) console.log(`ERROR ${e}`)
  console.log(`\n结果: ${errors.length} error, ${warnings.length} warning`)
  process.exit(errors.length ? 1 : 0)
}

main()
