import MarkdownIt from 'markdown-it'

const markdown = new MarkdownIt({ html: true })
const fixedSections = ['文档信息', '参考文档', '修订记录']
export const DOCUMENT_FORMAT = 'markdown-v1'
export const DOCUMENT_FIELDS = [
  '文档 ID', '文档名称', '文档版本', '所属产品', '状态',
  '编写者', '审核者', '创建时间', '修订时间', '适用范围',
]
export const FORMAT_TABLES = [
  { section: '文档信息', columns: ['项目', '内容'], min_rows: 10, repeat: false },
  { section: '参考文档', columns: ['文档名称或链接', '参考用途'], min_rows: 0, repeat: false },
  { section: '修订记录', columns: ['版本', '时间', '变更说明', '编写者'], min_rows: 1, repeat: false },
]

export const unnumberedTitle = (title) => title.replace(/^\d+(?:\.\d+)*(?:\.\s*|\s+)/, '').trim()

function numberedHeadings(text) {
  const lines = text.split('\n'), tokens = markdown.parse(text, {})
  const counters = [], mapping = new Map()
  tokens.forEach((token, i) => {
    if (token.type !== 'heading_open' || token.tag === 'h1') return
    const title = tokens[i + 1].content, level = Number(token.tag.slice(1))
    if (level === 2 && fixedSections.includes(title)) return
    counters.length = level - 1
    counters[level - 2] = (counters[level - 2] || 0) + 1
    const number = counters.join('.') + (level === 2 ? '.' : '')
    const next = number + ' ' + (unnumberedTitle(title) || '章节说明')
    mapping.set(title, next)
    lines[token.map[0]] = '#'.repeat(level) + ' ' + next
  })
  return { text: lines.join('\n'), mapping }
}

function referenceTable(text) {
  const start = text.indexOf('## 参考文档\n'), end = text.indexOf('## 修订记录\n', start)
  const body = text.slice(start, end < 0 ? text.length : end)
  if (body.includes('| 文档名称或链接 | 参考用途 |')) return text
  const insertion = '\n| 文档名称或链接 | 参考用途 |\n| --- | --- |\n\n'
  return end < 0 ? text + insertion : text.slice(0, end) + insertion + text.slice(end)
}

// Apply an explicitly authorized format change to a template definition.
// Submitted documents are validated as written and are never converted.
export function formatTemplate(template) {
  const result = structuredClone(template)
  const prepare = (text) => {
    const body = markdown.parse(text, {}).some((token, i, tokens) =>
      token.type === 'heading_open' && token.tag === 'h2' &&
      !fixedSections.includes(tokens[i + 1].content),
    )
    return body ? text : text.replace('## 参考文档', '## 正文说明\n\n说明本类文档的实际内容。\n\n## 参考文档')
  }
  const example = numberedHeadings(prepare(result.example))
  result.example = referenceTable(example.text)
  result.body = referenceTable(numberedHeadings(prepare(result.body)).text)
  const rename = (title) => example.mapping.get(title) || title
  result.contract.sections = result.contract.sections.map(rename)
  if (!result.contract.sections.some((title) => !fixedSections.includes(title)))
    result.contract.sections.splice(1, 0, '1. 正文说明')
  result.contract.tables = result.contract.tables.map((rule) => ({ ...rule, section: rename(rule.section) }))
  for (const rule of FORMAT_TABLES) {
    const i = result.contract.tables.findIndex((table) => table.section === rule.section)
    if (i < 0) result.contract.tables.push(structuredClone(rule))
    else result.contract.tables[i] = structuredClone(rule)
  }
  for (const key of ['identifiers', 'references', 'section_groups'])
    for (const rule of result.contract[key] || [])
      for (const field of ['section', 'target_section', 'parent'])
        if (rule[field]) rule[field] = rename(rule[field])
  result.contract.format = DOCUMENT_FORMAT
  return result
}

export function checkFormatContract(contract, add) {
  if (contract.format !== DOCUMENT_FORMAT)
    add('document_format_contract', 'The common markdown-v1 document format is required')
  for (const rule of FORMAT_TABLES)
    if (!contract.tables.some((table) =>
      table.section === rule.section && JSON.stringify(table.columns) === JSON.stringify(rule.columns) &&
      table.min_rows >= rule.min_rows && table.repeat === false && !table.optional_columns?.length,
    )) add('document_format_contract', 'Required common table contract: ' + rule.section)
}

function checkNumbering(headings, add) {
  const counters = []
  for (const section of headings) {
    if (section.level < 2 || fixedSections.includes(section.title)) continue
    if (section.level > counters.length + 2) {
      add('heading_level', 'Document heading skips a level', section)
      continue
    }
    counters.length = section.level - 1
    counters[section.level - 2] = (counters[section.level - 2] || 0) + 1
    const prefix = counters.join('.') + (section.level === 2 ? '.' : '') + ' '
    if (!section.title.startsWith(prefix) || !section.title.slice(prefix.length).trim())
      add('heading_number', 'Expected continuously numbered heading: ' + prefix, section)
  }
}

export function checkDocumentFormat(sections, values, add, tablesOf) {
  const title = sections.find((section) => section.level === 1)
  if (sections[0] !== title || title?.title !== values.get('文档名称'))
    add('document_name', 'Document title must precede all sections and match the document name', title)
  const main = sections.filter((section) => section.level === 2)
  const names = main.map((section) => section.title)
  if (names[0] !== '文档信息' || names.at(-2) !== '参考文档' || names.at(-1) !== '修订记录')
    add('document_layout', 'Required order: document information, body, references, revision history')
  if (main.filter((section) => !fixedSections.includes(section.title)).length === 0)
    add('document_body', 'At least one numbered body chapter is required')
  for (const name of fixedSections)
    if (sections.filter((section) => section.level === 2 && section.title === name).length !== 1)
      add('document_layout', 'Exactly one unnumbered common section is required: ' + name)
  const info = main.find((section) => section.title === '文档信息')
  const keys = (info ? tablesOf(info.tokens) : []).flatMap((table) => table.rows.map((row) => row[0]))
  if (JSON.stringify(keys) !== JSON.stringify(DOCUMENT_FIELDS))
    add('document_field_order', 'Document information fields must follow the common order', info)
  checkNumbering(sections, add)
  for (const section of sections)
    checkFormatContent(section, add, tablesOf)
}

function checkFormatContent(section, add, tablesOf) {
  for (const token of section.tokens)
    if (token.type === 'inline' && /^不涉及(?:[：:]\s*)?(?:TODO|待补|—)?[。\s]*$/.test(token.content.trim()))
      add('not_applicable_reason', 'Explain why this section does not apply', section)
  if (section.title !== '修订记录') return
  for (const row of tablesOf(section.tokens).flatMap((table) => table.rows)) {
    const date = new Date(row[1])
    if (Number.isNaN(date.getTime()) || date.toISOString().replace('.000Z', 'Z') !== row[1])
      add('revision_datetime', 'Revision time must be UTC ISO8601', section)
  }
}
