import { parseDocument, stringify } from 'yaml'
import MarkdownIt from 'markdown-it'

const markdown = new MarkdownIt({ html: true })

export function parsePage(text) {
  const match = text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) throw new Error('Missing or unterminated YAML frontmatter')
  const doc = parseDocument(match[1], { uniqueKeys: true, schema: 'core' })
  if (doc.errors.length)
    throw new Error(doc.errors.map((e) => e.message).join('; '))
  const fm = doc.toJS({ maxAliasCount: 0 })
  if (!fm || Array.isArray(fm) || typeof fm !== 'object')
    throw new Error('Frontmatter must be an object')
  const body = text
    .slice(match[0].length)
    .replace(
      /\n---\r?\n> \*\*来源文档\*\*: [^\n]*\r?\n> \*\*置信度\*\*: [^\n]*\r?\n> \*\*适用版本\*\*: [^\n]*(?:\r?\n)*$/,
      '',
    )
  return { fm, body, tokens: markdown.parse(body, {}) }
}

const escapeTrace = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(/[\r\n]/g, ' ')

export function renderPage(fm, title, content) {
  const trace = (fm.provenance || [])
    .map(
      (p) =>
        `> 原始文档路径：${escapeTrace(p.original_path)}\n> 原始文档标识：${escapeTrace(p.original_uri)}\n> 原件 SHA-256：${escapeTrace(p.original_sha256)}\n> 文档版本：${escapeTrace(p.version)}`,
    )
    .join('\n>\n')
  const location = fm.source_location
    ? `\n> 文档内位置：${Object.entries(fm.source_location)
        .map(([k, v]) => `${k}=${escapeTrace(v)}`)
        .join('; ')}`
    : ''
  return `---\n${stringify(fm, { lineWidth: 0 })}---\n\n# ${title}\n\n${content.trim()}\n${trace ? `\n---\n${trace}${location}\n` : ''}`
}

export function headings(tokens) {
  const result = []
  tokens.forEach((t, index) => {
    if (t.type === 'heading_open')
      result.push({
        level: Number(t.tag.slice(1)),
        title: tokens[index + 1].content.trim(),
        index,
      })
  })
  return result
}

function sectionMatch(heading, selector) {
  const m = selector.match(/^(#{1,6})\s+(.+)$/)
  if (!m) return false
  const title = m[2].trim()
  if (
    heading.level >= m[1].length &&
    /^\d+(?:\.\d+)+\s/.test(heading.title) &&
    (heading.title.endsWith(`(${title})`) ||
      heading.title.endsWith(`（${title}）`))
  )
    return true
  if (heading.level !== m[1].length) return false
  return /^\d+\.$/.test(title)
    ? heading.title.startsWith(`${title} `) || heading.title === title
    : heading.title === title
}

function checkHeadings(tokens, hs, add) {
  if (hs.filter((h) => h.level === 1).length !== 1 || hs[0]?.level !== 1)
    add('document_title', 'Exactly one top-level document title is required')
  if (
    !tokens.some(
      (t, i) =>
        ['inline', 'fence', 'code_block'].includes(t.type) &&
        t.content.trim() &&
        tokens[i - 1]?.type !== 'heading_open',
    )
  ) {
    add('document_empty', 'Document body must contain more than headings')
  }
  for (let i = 1; i < hs.length; i++) {
    if (hs[i].level > hs[i - 1].level + 1)
      add('heading_level', `Heading skips a level: ${hs[i].title}`)
  }
}

function sectionRanges(tokens, hs, contract, selectors, add) {
  const ranges = new Map()
  for (const selector of new Set(selectors)) {
    const found = hs.filter((h) => sectionMatch(h, selector))
    if (!found.length) {
      add('section_missing', `Required section missing: ${selector}`)
      continue
    }
    if (found.length > 1 && !contract.repeatableSections?.includes(selector))
      add('section_duplicate', `Required section repeated: ${selector}`)
    const sections = []
    for (const start of found) {
      const end =
        hs.find((h) => h.index > start.index && h.level <= start.level)
          ?.index ?? tokens.length
      const content = tokens.slice(start.index + 3, end)
      sections.push(content)
      if (
        !content.some(
          (t) =>
            ['inline', 'fence', 'code_block', 'image'].includes(t.type) &&
            t.content.trim(),
        )
      ) {
        add('section_empty', `Required section has no content: ${selector}`)
      }
    }
    ranges.set(selector, sections)
  }
  return ranges
}

function tableHeaders(content) {
  const headers = []
  for (let i = 0; i < content.length; i++) {
    if (content[i].type !== 'thead_open') continue
    const cells = []
    for (
      let j = i + 1;
      j < content.length && content[j].type !== 'thead_close';
      j++
    ) {
      if (content[j].type === 'inline') cells.push(content[j].content.trim())
    }
    let hasRows = false
    for (
      let j = i + 1;
      j < content.length && content[j].type !== 'table_close';
      j++
    ) {
      if (content[j].type === 'tbody_open') hasRows = true
    }
    if (hasRows) headers.push(cells)
  }
  return headers
}

export function structureErrors(tokens, contract, fm) {
  const errors = []
  const hs = headings(tokens)
  const add = (code, message) => errors.push({ code, message })
  checkHeadings(tokens, hs, add)
  const selectors = [...contract.requiredSections]
  if (fm.type === 'frd' && fm.pattern === 'what-next-driven')
    selectors.push('## What-Next Branches')
  const ranges = sectionRanges(tokens, hs, contract, selectors, add)
  for (const table of contract.tables || []) {
    for (const content of ranges.get(table.section) || [[]]) {
      const headers = tableHeaders(content)
      if (
        !headers.some((cols) => table.columns.every((c) => cols.includes(c)))
      ) {
        add(
          'table_columns',
          `${table.section} requires a table with columns: ${table.columns.join(', ')}`,
        )
      }
    }
  }
  for (const token of tokens) {
    if (
      token.type === 'inline' &&
      /\b(?:TODO|TBD|FIXME)\b|\[(?:待填写|待补充|占位[^\]]*)\]|<(?:节点标题|填写[^>]*|待[^>]*)>/i.test(
        token.content,
      )
    ) {
      add('placeholder', 'Unresolved document placeholder')
    }
  }
  return errors
}

export function pageLinks(tokens) {
  const result = []
  for (const token of tokens) {
    if (token.type !== 'inline') continue
    for (const child of token.children || []) {
      if (child.type === 'text') {
        for (const [, target] of child.content.matchAll(/\[\[([^\]]+)\]\]/g))
          result.push({ target: target.split('|')[0], wiki: true })
      }
      if (child.type === 'link_open')
        result.push({ target: child.attrGet('href'), wiki: false })
      if (child.type === 'image')
        result.push({ target: child.attrGet('src'), wiki: false, image: true })
    }
  }
  return result
}

// Markdown is document data. VitePress must not compile executable HTML/Vue
// supplied through documents, while fenced and inline code remain readable.
export function renderingErrors(tokens) {
  const errors = []
  const visit = (token) => {
    if (['html_block', 'html_inline'].includes(token.type)) {
      const html = token.content.trim()
      const comment =
        html.startsWith('<!--') &&
        html.endsWith('-->') &&
        !html.slice(4, -3).includes('<!--') &&
        !html.slice(4, -3).includes('-->')
      const safeTags =
        /^(?:<\/?(?:br|hr|sub|sup|kbd|details|summary)\s*\/?>\s*)+$/i.test(html)
      if (!comment && !safeTags)
        errors.push({
          code: 'active_content',
          message:
            'Executable or unsupported HTML is not permitted in Wiki content; use fenced examples',
        })
    }
    if (token.type === 'text' && /\{\{|\}\}/.test(token.content))
      errors.push({
        code: 'active_content',
        message:
          'Vue interpolation must be shown as code, not executable document content',
      })
    for (const child of token.children || []) visit(child)
  }
  for (const token of tokens) visit(token)
  return errors
}
