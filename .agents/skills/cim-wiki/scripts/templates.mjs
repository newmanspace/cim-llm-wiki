#!/usr/bin/env node
// templates.mjs — 文档模板自定义能力（Stage 2 抽取骨架的解析 / 管理 / 校验）
//
// 设计：模板按「节点类型」组织，纳入知识仓（data/wiki）版本管理，解析顺序为
//   1) 项目自定义   data/wiki/<project>/templates/   （by 项目覆盖，最高优先级）
//   2) 知识仓全局   data/wiki/templates/             （对所有项目生效的默认自定义）
//   3) skill 内置   .agents/skills/cim-wiki/assets/  （开箱即用骨架，兜底）
// 生效模板由各目录下的 manifest.json 声明：type → { file, plane, dir, requiredSections }。
// 项目 manifest 与全局 manifest 深度合并（项目优先），未声明的字段沿用全局。
// requiredSections 供 validate.mjs（Stage 6）做结构回归校验——自定义模板改了什么，就声明什么必填。
//
// 用法：
//   node templates.mjs list [--project <id>]                        列出每个类型当前生效模板与来源
//   node templates.mjs get <type> [--project <id>]                  打印生效模板正文（供 Stage 2 抽取遵循）
//   node templates.mjs path <type> [--project <id>]                 打印生效模板绝对路径
//   node templates.mjs init <type> [--project <id>] [--scope global|project] [--copy-from <t>]
//                                                                   生成可编辑副本并登记 manifest（覆盖内置/全局）
//   node templates.mjs check [--project <id>]                       校验 manifest 完整性 + 各模板必填槽位齐备
//
// 环境变量：
//   CIM_WIKI_ROOT   知识仓根目录（默认 <项目根>/data/wiki）

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadTemplateContracts, NODE_TYPES } from '../../../../packages/wiki-core/contracts.mjs'
import { parsePage, structureErrors } from '../../../../packages/wiki-core/markdown.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..', '..')
const BUILTIN_DIR = join(PROJECT_ROOT, '.agents', 'skills', 'cim-wiki', 'assets')
const WIKI_ROOT = resolve(process.env.CIM_WIKI_ROOT || join(PROJECT_ROOT, 'data', 'wiki'))

// 检索目录（不含内置）：[项目级?, 全局级]
function customDirs(project) {
  const dirs = []
  if (project) dirs.push({ dir: join(WIKI_ROOT, project, 'templates'), source: 'project' })
  dirs.push({ dir: join(WIKI_ROOT, 'templates'), source: 'wiki' })
  return dirs
}

function loadManifestAt(dir) {
  const mp = join(dir, 'manifest.json')
  if (!existsSync(mp)) return { version: 1, templates: {} }
  try { return JSON.parse(readFileSync(mp, 'utf-8')) }
  catch (e) { console.error(`manifest 解析失败 ${mp}: ${e.message}`); process.exit(1) }
}
function saveManifestAt(dir, m) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(m, null, 2) + '\n')
}

// 合并 manifest：全局为底，项目逐 type 覆盖（type 内字段浅合并）
function mergeManifest(project) {
  const contracts = loadTemplateContracts(WIKI_ROOT)(project)
  const globalM = loadManifestAt(join(WIKI_ROOT, 'templates'))
  const templates = Object.fromEntries(Object.entries(NODE_TYPES).filter(([, e]) => e.template).map(([type, e]) =>
    [type, { file: e.template, plane: e.plane, dir: `${e.plane}/${e.dir}` }]))
  for (const [type, entry] of Object.entries(globalM.templates || {})) templates[type] = { ...(templates[type] || {}), ...entry }
  if (project) {
    const projM = loadManifestAt(join(WIKI_ROOT, project, 'templates'))
    for (const [type, entry] of Object.entries(projM.templates || {})) {
      templates[type] = { ...(templates[type] || {}), ...entry }
    }
  }
  for (const [type, entry] of Object.entries(templates)) {
    entry.requiredSections = contracts[type].requiredSections
    entry.tables = contracts[type].tables
  }
  return { version: 1, templates }
}

// 解析某类型的生效模板：项目 > 全局 > 内置
// 文件名候选：合并 manifest 登记的 file → `${type}-template.md` → `${type}.md` → 内置中 stem 含 type 的文件
// 返回 { type, entry, source: 'project'|'wiki'|'builtin'|'missing', path, fileName }
function resolveTemplate(type, project) {
  const merged = mergeManifest(project)
  const entry = merged.templates?.[type] || null
  const candidates = []
  if (entry?.file) candidates.push(entry.file)
  candidates.push(`${type}-template.md`, `${type}.md`)
  for (const { dir, source } of customDirs(project)) {
    for (const f of candidates) { const p = join(dir, f); if (existsSync(p)) return { type, entry, source, path: p, fileName: f } }
  }
  for (const f of candidates) { const p = join(BUILTIN_DIR, f); if (existsSync(p)) return { type, entry, source: 'builtin', path: p, fileName: f } }
  const hit = safeReaddir(BUILTIN_DIR).find((f) => f.endsWith('.md') && f.replace(/-template\.md$/, '').replace(/\.md$/, '').includes(type))
  if (hit) return { type, entry, source: 'builtin', path: join(BUILTIN_DIR, hit), fileName: hit }
  return { type, entry, source: 'missing', path: join(join(WIKI_ROOT, 'templates'), `${type}-template.md`), fileName: `${type}-template.md` }
}

function typesInManifest(project) {
  const merged = mergeManifest(project)
  const keys = Object.keys(merged.templates)
  const usedFiles = new Set(keys.map((t) => merged.templates[t].file))
  // 内置 assets 里未被 manifest 登记的模板文件也纳入展示（按文件名派生类型）
  const extra = Object.entries(NODE_TYPES).filter(([, e]) => e.template && !usedFiles.has(e.template)).map(([type]) => type)
  return [...new Set([...keys, ...extra])].sort()
}
function safeReaddir(d) { try { return readdirSync(d) } catch { return [] } }

function cmdList(project) {
  const rows = typesInManifest(project).map((t) => {
    const r = resolveTemplate(t, project)
    const reqN = r.entry?.requiredSections?.length || 0
    return { type: t, source: r.source, file: r.fileName, reqN }
  })
  console.log(`知识仓根:   ${WIKI_ROOT}${project ? `   (project=${project})` : ''}`)
  console.log(`检索顺序:   ${customDirs(project).map((d) => d.dir).join('  >  ')}  >  ${BUILTIN_DIR} (builtin)\n`)
  console.log(pad('TYPE', 14) + pad('SOURCE', 9) + pad('FILE', 30) + 'REQUIRED')
  for (const x of rows) console.log(pad(x.type, 14) + pad(x.source, 9) + pad(x.file, 30) + (x.reqN ? `${x.reqN} slot(s)` : '-'))
}

function cmdGet(type, project) {
  const r = resolveTemplate(type, project)
  if (r.source === 'missing') { console.error(`未找到类型「${type}」的模板（${r.fileName} 不在项目/全局/内置目录）`); process.exit(1) }
  process.stderr.write(`# source=${r.source} path=${r.path}\n`)
  process.stdout.write(readFileSync(r.path, 'utf-8'))
}

function cmdPath(type, project) {
  const r = resolveTemplate(type, project)
  if (r.source === 'missing') { console.error(`missing: ${type}`); process.exit(1) }
  console.log(r.path)
}

function cmdInit(type, opts) {
  const { project, scope, copyFrom } = opts
  const contract = NODE_TYPES[type]
  if (!contract) throw new Error(`Unregistered node type: ${type}; register it in contracts/wiki/v1 first`)
  const src = resolveTemplate(copyFrom || type, project)
  if (src.source === 'missing') { console.error(`无可复制来源：类型「${copyFrom || type}」在项目/全局/内置目录均不存在`); process.exit(1) }
  // 写入目标：scope=project 且给了 project → 项目级；否则全局级
  const targetDir = (scope === 'project' && project) ? join(WIKI_ROOT, project, 'templates') : join(WIKI_ROOT, 'templates')
  const m = loadManifestAt(targetDir)
  // 目标文件名：该目录 manifest 已登记则沿用其 file，否则 `<type>-template.md`
  const fileName = m.templates?.[type]?.file || `${type}-template.md`
  const dest = join(targetDir, fileName)
  mkdirSync(targetDir, { recursive: true })
  if (existsSync(dest)) { console.error(`已存在，不覆盖：${dest}`); process.exit(1) }
  copyFileSync(src.path, dest)
  m.templates = m.templates || {}
  if (!m.templates[type]) m.templates[type] = { file: fileName, plane: contract.plane, dir: `${contract.plane}/${contract.dir}`, requiredSections: contract.requiredSections }
  saveManifestAt(targetDir, m)
  console.log(`已生成可编辑模板：${dest}`)
  console.log(`作用域：${targetDir === join(WIKI_ROOT, 'templates') ? 'global' : `project(${project})`}`)
  console.log(`来源：${src.source} (${src.path})`)
  console.log(`下一步：直接编辑该文件；如需结构回归校验，在其 manifest 的 "${type}".requiredSections 填入必填槽位标题。`)
}

function cmdCheck(project) {
  const merged = mergeManifest(project)
  let bad = 0
  for (const [type, entry] of Object.entries(merged.templates)) {
    const r = resolveTemplate(type, project)
    if (r.source === 'missing') { console.error(`ERR ${type}: 模板文件不存在 ${r.fileName}`); bad++; continue }
    if (!entry.requiredSections) { console.error(`WARN ${type}: manifest 缺 requiredSections 字段（视为不校验）`) }
    const text = readFileSync(r.path, 'utf-8')
    const tokens = parsePage(`---\ntype: ${type}\n---\n${text}`).tokens
    const miss = structureErrors(tokens, entry, { type }).filter(e => ['section_missing', 'section_duplicate', 'heading_level', 'table_columns'].includes(e.code))
    if (miss.length) { console.error(`ERR ${type}: ${miss.map(e => e.message).join('; ')}`); bad++ }
    else console.log(`OK  ${type}: ${r.fileName} (${r.source}) — ${entry.requiredSections?.length || 0} 必填槽位齐备`)
  }
  process.exit(bad ? 1 : 0)
}

function pad(s, n) { s = String(s); return s.length >= n ? s + ' ' : s + ' '.repeat(n - s.length) }

function parseFlags(argv) {
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project') flags.project = argv[++i]
    else if (argv[i] === '--scope') flags.scope = argv[++i]
    else if (argv[i] === '--copy-from') flags.copyFrom = argv[++i]
  }
  return flags
}

const [cmd, ...rest] = process.argv.slice(2)
switch (cmd) {
  case 'list': cmdList(parseFlags(rest).project); break
  case 'get': { const f = parseFlags(rest); const t = firstPositional(rest); if (!t) { console.error('用法: get <type> [--project <id>]'); process.exit(1) } cmdGet(t, f.project); break }
  case 'path': { const f = parseFlags(rest); const t = firstPositional(rest); if (!t) { console.error('用法: path <type> [--project <id>]'); process.exit(1) } cmdPath(t, f.project); break }
  case 'init': {
    const f = parseFlags(rest)
    const t = firstPositional(rest)
    if (!t) { console.error('用法: init <type> [--project <id>] [--scope global|project] [--copy-from <type>]'); process.exit(1) }
    cmdInit(t, { project: f.project, scope: f.scope || (f.project ? 'project' : 'global'), copyFrom: f.copyFrom }); break
  }
  case 'check': cmdCheck(parseFlags(rest).project); break
  default:
    console.log('用法: node templates.mjs <list|get|path|init|check> [type] [--project <id>] [--scope global|project] [--copy-from <type>]')
}

function firstPositional(argv) {
  const flagVals = new Set()
  for (let i = 0; i < argv.length; i++) if (['--project', '--scope', '--copy-from'].includes(argv[i])) flagVals.add(argv[i + 1])
  return argv.find((a) => !a.startsWith('--') && !flagVals.has(a))
}
