// Portable authoring checks: no project store or service access.
import { existsSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import MarkdownIt from 'markdown-it'
import nodeTypes from '../../contracts/wiki/v1/node-types.json' with { type: 'json' }
import { checkSectionGroups } from './section-groups.mjs'
import { DOCUMENT_FORMAT, checkFormatContract, checkDocumentFormat, unnumberedTitle } from './document-format.mjs'
import { renderingErrors } from './markdown.mjs'
const NODE_TYPES = nodeTypes.types
const markdown = new MarkdownIt({ html: true })
const fail = message => { throw new Error(message) }
function sectionsOf(text) {
  const tokens = markdown.parse(text, {})
  const sections = []
  for (let i = 0; i < tokens.length; i++)
    if (tokens[i].type === 'heading_open') {
      const level = Number(tokens[i].tag.slice(1)),
        title = tokens[i + 1].content
      let end = i + 1
      while (
        ++end < tokens.length &&
        !(
          tokens[end].type === 'heading_open' &&
          Number(tokens[end].tag.slice(1)) <= level
        )
      ) {
        /* Find the section boundary. */
      }
      sections.push({
        title,
        level,
        line: tokens[i].map[0] + 1,
        tokens: tokens.slice(i + 3, end),
      })
    }
  return { tokens, sections }
}
function tablesOf(tokens) {
  const tables = []
  let table = null,
    row = null
  for (const token of tokens) {
    if (token.type === 'table_close') {
      table = null
      row = null
    }
    if (token.type === 'table_open') {
      table = { headers: [], rows: [] }
      tables.push(table)
    }
    if (token.type === 'tr_open') row = []
    if (token.type === 'inline' && row) row.push(token.content)
    if (token.type === 'tr_close' && table) {
      if (!table.headers.length) table.headers = row
      else table.rows.push(row)
      row = null
    }
  }
  return tables
}

export function checkDocument(
  template,
  text,
  {
    phase = 'draft',
    terms = [],
    documentPath = '',
    root,
    reviewer,
    approvalMode = 'manual',
    nodeTypes,
  } = {},
) {
  const errors = []
  const add = (
    rule_id,
    message,
    section,
    expected,
    actual,
    severity = 'error',
  ) =>
    errors.push({
      rule_id,
      severity,
      document_path: documentPath,
      section: section?.title,
      line: section?.line,
      expected,
      actual,
      message,
      suggestion: message,
    })
  if (typeof text !== 'string' || text.length > 2 * 1024 * 1024)
    return [
      {
        rule_id: 'document_size',
        severity: 'error',
        message: 'Document must be text within 2 MiB',
      },
    ]
  if (!['draft', 'review', 'publish'].includes(phase))
    fail('Unknown document validation phase')
  if (template.contract.format !== DOCUMENT_FORMAT)
    fail('Unknown or missing common document format')
  checkFormatContract(template.contract, add)
  checkOptionalColumns(template.contract, add)
  if (errors.length) return errors
  template = withNodeContract(template, nodeTypes)
  const { sections, tokens } = sectionsOf(text)
  const hs = sections.filter((x) => x.level >= 2)
  if (sections.filter((x) => x.level === 1).length !== 1 || tokens[0]?.tag !== 'h1')
    add('document_title', 'Exactly one document title is required')
  checkSections(template, hs, add)
  checkSectionGroups(template.contract, hs, add, checkSections)
  const values = checkFields(template, hs, add, phase, reviewer, approvalMode)
  checkDocumentFormat(sections, values, add, tablesOf)
  checkTables(template, hs, add)
  checkTableRelations(template.contract, hs, add)
  checkTerms(template, hs, terms, add)
  checkRevisions(hs, values, add)
  checkReferences(hs, root, add)
  for (const diagnostic of renderingErrors(tokens))
    add(diagnostic.code, diagnostic.message)
  return errors
}


function checkSections(template, hs, add) {
  let previous = -1
  for (const title of template.contract.sections) {
    const found = hs.filter((s) => matchesSection(s, title))
    if (!found.length) {
      add(
        'section_required',
        'Missing required section: ' + title,
        undefined,
        title,
      )
      continue
    }
    const index = hs.indexOf(found[0])
    const ordered = found[0].level === 2 || found[0].title === title
    if (ordered && index < previous)
      add('section_order', 'Required section order is incorrect', found[0])
    if (ordered) previous = index
    if (
      found.length > 1 &&
      !template.contract.tables.some((t) => t.section === title && t.repeat)
    )
      add('section_duplicate', 'Duplicate section: ' + title, found[0])
    for (const s of found)
      if (
        !s.tokens.some(
          (t) =>
            ['inline', 'fence', 'code_block'].includes(t.type) &&
            t.content.trim() &&
            !/^\{\{.*\}\}$|^待补$|^TODO$/.test(t.content.trim()),
        )
      )
        add('section_empty', 'Section body must contain content', s)
  }
}

function checkFields(template, hs, add, phase, reviewer, approvalMode) {
  const info = hs.find((s) => s.title === '文档信息')
  const values = new Map(
    (info ? tablesOf(info.tokens) : [])
      .flatMap((t) => t.rows)
      .map((r) => [r[0], r[1]]),
  )
  for (const field of template.contract.fields) {
    const value = values.get(field)
    if (!value || /^—$|^待补$|^TODO$|\{\{/.test(value))
      add(
        'field_required',
        'Missing document field: ' + field,
        info,
        field,
        value,
      )
    if (
      ['创建时间', '修订时间'].includes(field) &&
      value &&
      !validTimestamp(value)
    )
      add('field_datetime', 'Time must be UTC ISO8601', info, field, value)
  }
  const validReviewer = approvalMode === 'auto'
    ? reviewer === 'system:quality-policy'
    : reviewer && values.get('审核者') === reviewer
  if (phase === 'publish' && !validReviewer)
    add(
      'reviewer_mismatch',
      'Document reviewer must match authenticated review evidence',
      info,
    )
  return values
}

function checkTables(template, hs, add) {
  for (const rule of template.contract.tables) {
    for (const section of hs.filter((s) => matchesSection(s, rule.section) ||
      (rule.repeat && unnumberedTitle(s.title) === unnumberedTitle(rule.section)))) {
      const tables = tablesOf(section.tokens)
      if (!tables.length)
        add('table_required', 'Missing required table', section)
      for (const table of tables) {
        if (JSON.stringify(table.headers) !== JSON.stringify(rule.columns))
          add(
            'table_columns',
            'Table columns and order must match the contract',
            section,
            rule.columns,
            table.headers,
          )
        if (table.rows.length < rule.min_rows)
          add(
            'table_rows',
            'Not enough table data rows',
            section,
            rule.min_rows,
            table.rows.length,
          )
        checkCells(table, rule, section, add)
      }
    }
  }
}

function columnValues(hs, sectionTitle, column) {
  return hs.filter((s) => matchesSection(s, sectionTitle)).flatMap((section) =>
    tablesOf(section.tokens).flatMap((table) => {
      const index = table.headers.indexOf(column)
      return index < 0 ? [] : table.rows.map((row) => ({
        value: (row[index] || '').trim(), section,
      }))
    }),
  )
}

function checkTableRelations(contract, hs, add) {
  for (const rule of contract.identifiers || []) {
    const seen = new Set()
    for (const { value, section } of columnValues(hs, rule.section, rule.column)) {
      if (seen.has(value))
        add('identifier_duplicate', 'Identifier must be unique: ' + value, section, rule.column, value)
      seen.add(value)
    }
  }
  for (const rule of contract.references || []) {
    const targets = new Set(columnValues(hs, rule.target_section, rule.target_column).map((cell) => cell.value))
    for (const { value, section } of columnValues(hs, rule.section, rule.column)) {
      for (const target of value.split(/[,，、;；\s]+/).filter(Boolean))
        if (!targets.has(target))
          add('identifier_reference', 'Referenced identifier does not exist: ' + target, section, rule.target_section + ' / ' + rule.target_column, target)
    }
  }
}


function checkTerms(template, hs, terms, add) {
  const glossarySections = template.contract.tables
    .filter(
      (t) =>
        JSON.stringify(t.columns) ===
        JSON.stringify(['英文名称', '中文名称', '描述', '备注']),
    )
    .map((t) => t.section)
  if (!glossarySections.length) return
  const seen = new Set()
  const entries = hs
    .filter((s) => glossarySections.some((title) => unnumberedTitle(title) === unnumberedTitle(s.title)))
    .flatMap((section) =>
      tablesOf(section.tokens).flatMap((table) =>
        table.rows.map((row) => ({ section, row })),
      ),
    )
  for (const { section, row } of entries) {
    const key = row[0]?.trim().toLowerCase()
    if (seen.has(key)) add('term_duplicate', 'Duplicate English term', section)
    seen.add(key)
    for (const term of terms)
      if (
        (row[0]?.includes('(' + term.abbreviation + ')') ||
          row[0]?.trim() === term.abbreviation) &&
        !row[0].includes(term.english)
      )
        add(
          'term_definition',
          'Abbreviation must use the configured English definition',
          section,
          term.english,
          row[0],
        )
  }
}

function checkRevisions(hs, values, add) {
  const revisions = hs.find((s) => s.title === '修订记录')
  if (
    revisions &&
    !tablesOf(revisions.tokens).some((t) =>
      t.rows.some((r) => r[0] === values.get('文档版本')),
    )
  )
    add(
      'revision_version',
      'Revision history must contain the document version',
      revisions,
    )
}

function checkReferences(hs, root, add) {
  const references = hs.find((s) => s.title === '参考文档')
  if (references) {
    const links = references.tokens.flatMap((t) =>
      (t.children || [])
        .filter((c) => c.type === 'link_open')
        .map((c) => c.attrGet('href')),
    )
    const content = references.tokens
      .filter((t) => t.type === 'inline')
      .map((t) => t.content)
      .join('\n')
    const listed = tablesOf(references.tokens).some((table) =>
      table.headers.includes('文档名称或链接') && table.rows.length > 0,
    )
    if (!links.length && !listed && !/无参考文档[：:].+/.test(content))
      add(
        'references_required',
        'Provide references or explicitly explain why none apply',
        references,
      )
    for (const link of links) {
      if (/^https?:\/\//.test(link)) {
        add(
          'reference_unverified',
          'External reference has not been verified',
          references,
          undefined,
          link,
          'warning',
        )
        continue
      }
      if (link.startsWith('#')) continue
      if (!root) {
        add(
          'reference_unverified',
          'Local reference root is not available',
          references,
          undefined,
          link,
          'warning',
        )
        continue
      }
      const target = resolve(root, link.split('#')[0])
      const rel = relative(resolve(root), target)
      if (rel.startsWith('..') || !existsSync(target))
        add(
          'reference_missing',
          'Reference target is missing or outside the allowed root',
          references,
          undefined,
          link,
        )
    }
  }
}


export function checkOptionalColumns(contract, add) {
  for (const rule of contract.tables)
    if ((rule.optional_columns || []).some((column) => !rule.columns.includes(column)))
      add('table_optional_column', 'Optional columns must belong to the declared table')
}


function checkCells(table, rule, section, add) {
  for (const row of table.rows) {
    if (
      row.length !== rule.columns.length ||
      row.some(
        (cell, i) =>
          rule.columns[i] !== '备注' && !rule.optional_columns?.includes(rule.columns[i]) &&
          (!cell.trim() || /^—$|^TODO$|^待补$|\{\{/.test(cell)),
      )
    )
      add('table_cell', 'Required table cells must be populated', section)
  }
}

export function validTimestamp(value) {
  const date = new Date(value)
  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().replace('.000Z', 'Z') === value
  )
}


export function sectionLevel(title) {
  const number = title.match(/^(\d+(?:\.\d+)*)(?:\.\s|\s)/)
  return number ? number[1].split('.').length + 1 : 2
}

function matchesSection(section, title) {
  if (section.level === sectionLevel(title) && section.title === title)
    return true
  if (/^\d+(?:\.\d+)*(?:\.\s|\s)/.test(section.title) && unnumberedTitle(section.title) === title)
    return true
  if (
    section.level === 2 &&
    (section.title === title ||
      (/^\d+\.$/.test(title) && section.title.startsWith(title + ' ')))
  )
    return true
  return (
    /^\d+(?:\.\d+)+\s/.test(section.title) &&
    (section.title.endsWith('(' + title + ')') ||
      section.title.endsWith('（' + title + '）'))
  )
}

function withNodeContract(template, nodeTypes = NODE_TYPES) {
  const base = nodeTypes[template.node_type] || {},
    contract = structuredClone(template.contract)
  const missing = (base.requiredSections || [])
    .map((s) => s.replace(/^## /, ''))
    .filter(
      (title) =>
        !contract.sections.some((s) =>
          matchesSection({ level: 2, title: s }, title),
        ),
    )
  contract.sections.splice(contract.sections.indexOf('参考文档'), 0, ...missing)
  for (const table of base.tables || []) {
    const section = table.section.replace(/^## /, '')
    if (
      !contract.tables.some(
        (t) =>
          matchesSection({ level: sectionLevel(t.section), title: t.section }, section) &&
          table.columns.every((c) => t.columns.includes(c)),
      )
    )
      contract.tables.push({
        section,
        columns: table.columns,
        min_rows: 1,
        repeat: (base.repeatableSections || []).includes(table.section),
      })
  }
  return { ...template, contract }
}
