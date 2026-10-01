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

function main() {
  const root = resolve(process.argv[2] || join(PROJECT_ROOT, 'data', 'wiki'))
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    console.error(`wiki 目录不存在: ${root}`)
    process.exit(1)
  }

  const keys = walkMd(root, root)
  const incoming = Object.fromEntries(keys.map(k => [k, 0]))
  const metas = {}

  for (const key of keys) {
    const text = readFileSync(join(root, key), 'utf-8')
    const fm = parseFrontmatter(text)

    if (key === 'index.md') continue // 站点首页由 gen-sidebar.mjs 生成，不适用知识节点校验
    if (key.startsWith('manuals/')) continue // 人读视图层（gen-manuals.mjs 生成），不参与知识节点校验

    if (fm === null) {
      errors.push(`[metadata_error] ${key}: 缺少 YAML Frontmatter`)
    } else {
      const missing = REQUIRED_FIELDS.filter(f => !(Array.isArray(fm[f]) ? fm[f].length : fm[f]))
      if (missing.length) errors.push(`[metadata_error] ${key}: 缺少必填字段 [${missing.join(', ')}]`)
      metas[key] = fm
    }

    const nodeId = fm?.id
    if (nodeId && !key.startsWith('virtual/') && dirname(key) !== '.' ) {
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
    if (incoming[key] === 0 && !key.startsWith('virtual/') && !key.startsWith('manuals/') && key !== 'index.md') {
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
  for (const [key, fm] of Object.entries(metas)) {
    const src = typeof fm.source === 'string' ? fm.source : ''
    const rec = byPath[src]
    if (rec && rec.state === 'draft') errors.push(`[doc_state] ${key}: source 文档 ${rec.doc_id} 仍为 draft（未定稿即发布，违反状态门禁）`)
  }

  console.log(`扫描页面: ${keys.length}`)
  for (const w of warnings) console.log(`WARN  ${w}`)
  for (const e of errors) console.log(`ERROR ${e}`)
  console.log(`\n结果: ${errors.length} error, ${warnings.length} warning`)
  process.exit(errors.length ? 1 : 0)
}

main()
