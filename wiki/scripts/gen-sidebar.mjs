// 扫描 data/wiki 生成 VitePress 侧边栏/导航数据与首页 index.md
// 目录按 project 分树：data/wiki/<project>/{doc,code}/...
// 页面链接以 /<project>/ 为前缀（VitePress base=/wiki/ 会自动补全 → /wiki/<project>/...）
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = join(__dirname, '..')
const WIKI_ROOT = process.env.WIKI_ROOT || (existsSync(join(WEB_ROOT, '../data/wiki')) ? join(WEB_ROOT, '../data/wiki') : existsSync('/data/wiki') ? '/data/wiki' : join(WEB_ROOT, 'data/wiki'))
const OUT = join(WEB_ROOT, '.vitepress', 'sidebar-data.mjs')

// 双平面物理分库：doc = 领域知识库（文档视图/高层导航），code = 代码契约库（工程实现/自动化编译）
const PLANES = [
  ['doc', '领域知识库 (Domain Wiki)', [
    ['modules', '模块驾驶舱'],
    ['designs', '架构设计'],
    ['requirements', '需求'],
    ['scenarios', '业务场景 (Scenario)'],
    ['dictionaries', '数据字典 (ER)'],
    ['tests', '测试用例'],
    ['runbooks', '运维预案 (Runbook)'],
    ['releases', '版本发布'],
    ['deployments', '部署配置'],
    ['incidents', '故障案例'],
    ['knowledge', '知识与 FAQ'],
    ['products', '产品线'],
    ['projects', '项目'],
    ['virtual', '虚拟合成视图'],
  ]],
  ['code', '代码契约库 (Code Wiki)', [
    ['domain', '领域对象 (Domain Card)'],
    ['apis', 'API 接口'],
    ['interactions', '交互时序流 (Interaction)'],
    ['rules', '微观业务规则'],
    ['schemas', '数据 Schema'],
    ['code-index', '代码索引'],
  ]],
]

// 文档视图层：data/wiki/<project>/doc/manuals/<系统>/<版本>/<大类>/<子类>/<文档>.md
const MANUAL_KIND = { 'user-manual': '用户手册', 'admin-manual': '系统管理手册', solution: '方案设计视图' }

function parseFrontmatter(text) {
  if (!text.startsWith('---')) return {}
  const parts = text.split('---')
  if (parts.length < 3) return {}
  const fm = {}
  for (const line of parts[1].split('\n')) {
    const m = line.match(/^([\w-]+):\s*(.+)$/)
    if (m) fm[m[1]] = m[2].trim().replace(/^"|"$/g, '')
  }
  return fm
}

function firstHeading(text) {
  const body = text.startsWith('---') ? text.split('---').slice(2).join('---') : text
  const m = body.match(/^#\s+(.+)$/m)
  return m ? m[1].trim() : null
}

function collectMd(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isFile() && e.name.endsWith('.md') && e.name !== 'index.md')
    .map(e => e.name)
    .sort()
}

function collectManuals(dir, prefix = '') {
  if (!existsSync(dir)) return []
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (e.name.endsWith('_assets')) continue
      out.push(...collectManuals(join(dir, e.name), `${prefix}${e.name}/`))
    } else if (e.isFile() && e.name.endsWith('.md')) out.push({ rel: prefix + e.name })
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel))
}

// 发现项目子目录：直接含 doc/ 或 code/ 的目录即为一个 project
function discoverProjects() {
  if (!existsSync(WIKI_ROOT)) return []
  return readdirSync(WIKI_ROOT, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .filter(name => existsSync(join(WIKI_ROOT, name, 'doc')) || existsSync(join(WIKI_ROOT, name, 'code')))
    .sort()
}

const projects = discoverProjects()
const sidebar = []
const nav = [{ text: '首页', link: '/' }]
let total = 0

// 为单个项目构建其 sidebar 分组（linkPrefix 含项目段）
function buildProjectGroups(proj) {
  const groups = []
  const linkBase = `/${proj}`
  // 手册视图层
  const mdir = join(WIKI_ROOT, proj, 'doc', 'manuals')
  const mfiles = collectManuals(mdir)
  if (mfiles.length) {
    const byKind = new Map()
    for (const { rel } of mfiles) {
      const text = readFileSync(join(mdir, rel), 'utf-8')
      const fm = parseFrontmatter(text)
      const title = fm.title || firstHeading(text) || rel
      const cat = fm.category || rel.split('/')[2] || 'misc'
      const label = MANUAL_KIND[cat] || cat
      if (!byKind.has(label)) byKind.set(label, [])
      byKind.get(label).push({ text: title, link: `${linkBase}/doc/manuals/${rel.replace(/\.md$/, '')}` })
    }
    for (const [label, items] of byKind) groups.push({ text: `${label} (${items.length})`, items, collapsed: false })
  }
  // 原子节点双平面
  for (const [plane, planeLabel, dirs] of PLANES) {
    const pgs = []
    for (const [dir, label] of dirs) {
      const files = collectMd(join(WIKI_ROOT, proj, plane, dir))
      if (!files.length) continue
      const items = files.map(f => {
        const text = readFileSync(join(WIKI_ROOT, proj, plane, dir, f), 'utf-8')
        const fm = parseFrontmatter(text)
        const title = fm.title || firstHeading(text) || f.replace(/\.md$/, '')
        const suffix = fm.review_level === 'L0_auto' ? '' : fm.status === 'archived' ? ' (归档)' : ''
        return { text: `${title}${suffix}`, link: `${linkBase}/${plane}/${dir}/${f.replace(/\.md$/, '')}` }
      })
      pgs.push({ text: `${label} (${items.length})`, items, collapsed: false })
      total += items.length
    }
    if (pgs.length) groups.push({ text: `${planeLabel} (${pgs.reduce((s, g) => s + g.items.length, 0)})`, items: pgs, collapsed: false })
  }
  return groups
}

for (const proj of projects) {
  const groups = buildProjectGroups(proj)
  if (!groups.length) continue
  if (projects.length > 1) {
    sidebar.push({ text: `📁 ${proj}`, items: groups, collapsed: false })
  } else {
    sidebar.push(...groups)
  }
  nav.push({ text: proj, link: `/${proj}/` })
}

// 首页 index.md
mkdirSync(WIKI_ROOT, { recursive: true })
const now = new Date().toISOString().slice(0, 16).replace('T', ' ')
const homeLinks = sidebar
  .map(g => `- **${g.text}**\n${(g.items || []).slice(0, 50).map(i => `  - [${(i.text || '').trim()}](${i.link || '#'})`).join('\n')}`)
  .join('\n')
writeFileSync(
  join(WIKI_ROOT, 'index.md'),
  `---
title: CIM 知识库
---

# 泛半导体 CIM 知识库

> 共 ${total} 个原子知识节点 · 项目：${projects.join(', ') || '（空）'} · 由 cim-wiki skill 流水线生成 · 侧边栏数据更新于 ${now}

${total ? homeLinks : '_知识库为空。使用 cim-wiki skill 摄取第一份文档。_'}
`,
  'utf-8'
)

writeFileSync(
  OUT,
  `// AUTO-GENERATED by scripts/gen-sidebar.mjs — do not edit
export const sidebar = ${JSON.stringify(sidebar, null, 2)}
export const nav = ${JSON.stringify(nav.slice(0, 8), null, 2)}
`,
  'utf-8'
)

console.log(`gen-sidebar: ${projects.length} project(s) [${projects.join(', ')}], ${total} pages, ${sidebar.length} groups -> ${relative(process.cwd(), OUT)}`)
