import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve, relative } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import MarkdownIt from 'markdown-it'
import Ajv from 'ajv'
import { urdTemplate } from './urd-template.mjs'
import { sddTemplate } from './sdd-template.mjs'
import { iddTemplate } from './idd-template.mjs'
import { apiTemplate } from './api-template.mjs'
import { ruleTemplate } from './rule-template.mjs'
import { domainTemplate } from './domain-template.mjs'
import { schemaTemplate } from './schema-template.mjs'
import { remainingTemplates } from './remaining-templates.mjs'
import { checkSectionGroups, checkGroupDefinitions, weakensSectionGroups } from './section-groups.mjs'
import { DOCUMENT_FORMAT, DOCUMENT_FIELDS, formatTemplate, checkFormatContract, checkDocumentFormat, unnumberedTitle } from './document-format.mjs'
import { renderingErrors } from './markdown.mjs'
import {
  NODE_TYPES,
  schemaErrors,
  CONTRACT_ROOT,
  readContractJson,
} from './contracts.mjs'

export const templateVariables = {
  document_id: 'string',
  document_name: 'string',
  document_version: 'string',
  product: 'string',
  author: 'string',
  reviewer: 'string',
  created_at: 'utc_datetime',
  updated_at: 'utc_datetime',
  scope: 'string',
}
const markdown = new MarkdownIt({ html: true })
const clone = (value) => structuredClone(value)
const digest = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')
const fail = (message, status = 422) => {
  throw Object.assign(new Error(message), { status })
}
const id = (value) => {
  if (
    typeof value !== 'string' ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ||
    ['constructor', 'prototype'].includes(value)
  )
    fail('Invalid identifier')
  return value
}
export const definitionSchema = readContractJson(
  join(CONTRACT_ROOT, 'document-defaults.schema.json'),
)
const check = new Ajv({ allErrors: true, strict: false }).compile(
  definitionSchema,
)

export function builtinDefaults() {
  const stages = [
    '00-overview:产品总览',
    '10-planning:产品规划',
    '20-architecture:系统架构',
    '30-standards:工程规范',
    '40-requirements:业务需求',
    '50-designs:设计方案',
    '60-test:测试验证',
    '70-release:版本发布',
    '80-deploy:部署运维',
    '90-guides:使用指南',
    '99-templates:文档模板',
  ]
  const directories = [
    { path: 'doc', title: '产品文档', description: '生命周期文档' },
    ...stages.map((x) => {
      const [path, title] = x.split(':')
      return { path: 'doc/' + path, title, description: title }
    }),
    { path: 'code', title: '代码契约', description: '代码契约唯一正文' },
    ...[
      'apis:API 契约',
      'domain:领域实体',
      'rules:可执行规则',
      'schemas:物理数据结构',
    ].map((x) => {
      const [path, title] = x.split(':')
      return { path: 'code/' + path, title, description: title }
    }),
  ]
  const routes = {
    'doc/00-overview': ['project', 'product', 'knowledge_article'],
    'doc/40-requirements': ['requirement', 'frd'],
    'doc/50-designs': ['design', 'module', 'data_dictionary'],
    'doc/60-test': ['test_case'],
    'doc/70-release': ['release'],
    'doc/80-deploy': ['deployment', 'runbook', 'incident', 'defect'],
    'doc/90-guides': ['user-manual', 'admin-manual', 'faq', 'solution'],
    'code/apis': ['api'],
    'code/domain': ['business_object'],
    'code/rules': ['business_rule'],
    'code/schemas': ['data_schema'],
  }
  for (const directory of directories)
    directory.node_types = routes[directory.path] || []
  const terms = [
    {
      abbreviation: 'URD',
      english: 'User Requirement Definition',
      chinese: '用户需求定义',
    },
    {
      abbreviation: 'SDD',
      english: 'Solution Design Definition',
      chinese: '方案设计定义',
    },
    {
      abbreviation: 'IDD',
      english: 'Internal Design Definition',
      chinese: '内部设计定义',
    },
  ]
  const fields = [...DOCUMENT_FIELDS]
  const templates = [
    [
      'urd',
      'URD 用户需求定义',
      'requirement',
      urdTemplate.sections,
    ],
    [
      'sdd',
      'SDD 方案设计定义',
      'design',
      sddTemplate.sections,
    ],
    [
      'idd',
      'IDD 内部设计定义',
      'design',
      iddTemplate.sections,
    ],
    ['glossary', 'Glossary 术语表', 'knowledge_article', ['术语定义']],
    ...Object.keys(NODE_TYPES)
      .filter(
        (x) => !['requirement', 'design', 'knowledge_article'].includes(x),
      )
      .map((type) => [type.replaceAll('_', '-'), type, type, []]),
  ].map(([templateId, name, node_type, sections]) => {
    const specific = { ...remainingTemplates, urd: urdTemplate, sdd: sddTemplate, idd: iddTemplate, api: apiTemplate, 'business-rule': ruleTemplate, 'business-object': domainTemplate, 'data-schema': schemaTemplate }[templateId]
    if (specific?.name) name = specific.name
    if (specific && sections.length === 0) sections = specific.sections
    const baseSections = (NODE_TYPES[node_type].requiredSections || []).map(
      (x) => x.replace(/^## /, ''),
    )
    const required = [
      '文档信息',
      ...new Set([
        ...sections,
        ...baseSections.filter((x) => !sections.some((s) => s.startsWith(x) || unnumberedTitle(s) === x)),
      ]),
      '参考文档',
      '修订记录',
    ]
    const tables = [
      {
        section: '修订记录',
        columns: ['版本', '时间', '变更说明', '编写者'],
        min_rows: 1,
        repeat: false,
      },
    ]
    tables.push(
      ...(NODE_TYPES[node_type].tables || []).filter((t) =>
        !specific?.tables.some((table) => unnumberedTitle(table.section) === t.section.replace(/^## /, '')),
      ).map((t) => ({
        section: t.section.replace(/^## /, ''),
        columns: t.columns,
        min_rows: 1,
        repeat: (NODE_TYPES[node_type].repeatableSections || []).includes(
          t.section,
        ),
      })),
    )
    if (templateId === 'glossary')
      tables.unshift({
        section: '术语定义',
        columns: ['英文名称', '中文名称', '描述', '备注'],
        min_rows: 1,
        repeat: true,
      })
    if (specific) tables.push(...clone(specific.tables))
    const values = {
      '文档 ID': 'DOC-001',
      文档名称: name,
      文档版本: 'v1.0',
      所属产品: 'Example',
      状态: '草稿',
      编写者: 'Example Author',
      审核者: '待指定',
      创建时间: '2026-11-13T00:00:00Z',
      修订时间: '2026-11-13T00:00:00Z',
      适用范围: '项目文档',
    }
    const table = (cols, rows) =>
      '| ' +
      cols.join(' | ') +
      ' |\n| ' +
      cols.map(() => '---').join(' | ') +
      ' |\n' +
      rows.map((r) => '| ' + r.join(' | ') + ' |').join('\n')
    const content = required
      .map((section) => {
        let text = '内容说明。'
        if (section === '文档信息')
          text = table(
            ['项目', '内容'],
            fields.map((f) => [f, values[f]]),
          )
        if (section === '参考文档')
          text = '无参考文档：本例为独立的模板验证样例。'
        const t = tables.find((t) => t.section === section)
        if (t)
          text = table(t.columns, [
            templateId === 'glossary' && section === '术语定义'
              ? [
                  'User Requirement Definition (URD)',
                  '用户需求定义',
                  '定义用户需求、范围和验收条件。',
                  '项目术语',
                ]
              : section === '修订记录'
                ? ['v1.0', '2026-11-13T00:00:00Z', '初始版本', 'Example Author']
                : t.columns.map((c) => '示例 ' + c),
          ])
        if (specific) {
          text = specific.content[section] || text
          if (t && Object.hasOwn(specific.rows, section))
            text = (specific.content[section] ? specific.content[section] + '\n\n' : '') +
              table(t.columns, specific.rows[section])
        }
        return '#'.repeat(sectionLevel(section)) + ' ' + section + '\n\n' + text
      })
      .join('\n\n')
    const example = '# ' + name + '\n\n' + content
    return formatTemplate({
      id: templateId,
      name,
      node_type,
      ...(specific?.usage ? { usage: specific.usage } : {}),
      body: example
        .replaceAll('Example Author', '{{author}}')
        .replaceAll('DOC-001', '{{document_id}}')
        .replaceAll(name, '{{document_name}}')
        .replaceAll('v1.0', '{{document_version}}')
        .replaceAll('Example', '{{product}}')
        .replaceAll('待指定', '{{reviewer}}')
        .replaceAll('项目文档', '{{scope}}')
        .replaceAll('2026-11-13T00:00:00Z', '{{created_at}}')
        .replace(
          '| 修订时间 | {{created_at}} |',
          '| 修订时间 | {{updated_at}} |',
        ),
      example,
      invalid_example: '# 缺少内容',
      contract: {
        fields, sections: required, tables,
        ...specificContract(specific),
      },
    })
  })
  return {
    name: '全局项目文档模板定义',
    directories,
    terms,
    templates,
    delivery: [
      { id: 'requirements', type: 'requirement', scope: 'project', min: 1 },
      { id: 'designs', type: 'design', scope: 'project', min: 1 },
      { id: 'modules', type: 'module', scope: 'module', min: 1 },
    ],
  }
}

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
    terms = builtinDefaults().terms,
    documentPath = '',
    root,
    reviewer,
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
  template = withNodeContract(template)
  const { sections, tokens } = sectionsOf(text)
  const hs = sections.filter((x) => x.level >= 2)
  if (sections.filter((x) => x.level === 1).length !== 1 || tokens[0]?.tag !== 'h1')
    add('document_title', 'Exactly one document title is required')
  checkSections(template, hs, add)
  checkSectionGroups(template.contract, hs, add, checkSections)
  const values = checkFields(template, hs, add, phase, reviewer)
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

export function checkDefinition(value) {
  if (!check(value))
    return check.errors.map((e) => ({
      rule_id: 'definition_schema',
      severity: 'error',
      message: `${e.instancePath}: ${e.message}`,
    }))
  const errors = []
  const add = (rule_id, message) =>
    errors.push({ rule_id, severity: 'error', message })
  const paths = new Set()
  for (const d of value.directories) {
    if (d.node_types.some((t) => !Object.hasOwn(NODE_TYPES, t)))
      add('directory_type', 'Unknown directory document type')
    if (/[<>[\]`{}\r\n]/.test(d.title))
      add('directory_title', 'Directory title must be plain text')
    if (
      !/^(doc|code)(\/[a-z0-9]+(?:[.-][a-z0-9]+)*)*$/.test(d.path) ||
      paths.has(d.path)
    )
      add('directory_path', 'Invalid or duplicate directory: ' + d.path)
    paths.add(d.path)
  }
  for (const path of paths)
    if (path.includes('/') && !paths.has(path.slice(0, path.lastIndexOf('/'))))
      add('directory_parent', 'Missing directory parent: ' + path)
  const ids = new Set()
  for (const t of value.templates) checkTemplateDefinition(t, value, ids, add)
  for (const rule of value.delivery)
    if (rule.min > 0 && !value.templates.some((t) => t.node_type === rule.type))
      add(
        'delivery_template',
        'Required delivery type has no template: ' + rule.type,
      )
  if (
    schemaErrors('documentSet', {
      schema_version: '1.0',
      project: 'check',
      modules: ['check'],
      documents: value.delivery,
    }).length
  )
    add('delivery_contract', 'Invalid delivery contract')
  return errors
}
const builtinFields = DOCUMENT_FIELDS

export function createDefaultsStore(projectRoot) {
  const base = join(projectRoot, 'data/document-defaults'),
    file = join(base, 'state.json')
  const read = () =>
    existsSync(file)
      ? JSON.parse(readFileSync(file, 'utf8'))
      : {
          revision: 0,
          draft: builtinDefaults(),
          published_version: null,
          versions: {},
          bindings: {},
          audit: [],
        }
  const write = (value) => {
    mkdirSync(base, { recursive: true })
    const temp = file + '.' + randomUUID()
    writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
    renameSync(temp, file)
  }
  const state = () => {
    const s = read()
    return {
      revision: s.revision,
      draft: s.draft,
      published_version: s.published_version,
      versions: Object.keys(s.versions),
      audit: s.audit,
    }
  }
  const effective = (project) => {
    id(project)
    const s = read(),
      binding = s.bindings[project]
    if (!binding)
      fail('Project must bind a published document template contract', 409)
    const version = s.versions[binding.version]
    if (!version) fail('Bound template version is missing', 409)
    if (digest(version.definition) !== version.digest)
      fail('Published document defaults have drifted', 409)
    const definition = applyOverrides(
      version.definition,
      binding.overrides || {},
    )
    if (digest({ definition, modules: binding.modules }) !== binding.digest)
      fail('Project document contract has drifted', 409)
    return { ...binding, definition }
  }
  return {
    state,
    save(definition, revision, actor) {
      const s = read()
      if (s.revision !== revision) fail('Settings revision conflict', 409)
      if (!check(definition))
        fail('Definition format invalid: ' + JSON.stringify(check.errors))
      s.draft = clone(definition)
      s.revision++
      s.audit.push({ action: 'save', actor, at: new Date().toISOString() })
      write(s)
      return state()
    },
    publish(revision, actor) {
      const s = read()
      if (s.revision !== revision) fail('Settings revision conflict', 409)
      const errors = checkDefinition(s.draft)
      if (errors.length)
        fail('Contract definition failed: ' + JSON.stringify(errors))
      const version = 'v' + (Object.keys(s.versions).length + 1)
      s.versions[version] = {
        definition: clone(s.draft),
        digest: digest(s.draft),
      }
      s.published_version = version
      s.revision++
      s.audit.push({
        action: 'publish',
        actor,
        at: new Date().toISOString(),
        version,
      })
      write(s)
      return state()
    },
    effective,
    bind(
      project,
      modules,
      overrides = {},
      version,
      upgrade = false,
      persist = true,
      actor = 'system',
    ) {
      id(project)
      if (
        !Array.isArray(modules) ||
        modules.some((m) => typeof m !== 'string' || !m.trim())
      )
        fail('Explicit modules are required')
      const s = read()
      if (s.bindings[project] && !upgrade) return effective(project)
      version ||= s.published_version
      if (!s.versions[version])
        fail('Publish global document defaults first', 409)
      const definition = applyOverrides(
        s.versions[version].definition,
        overrides,
      )
      const errors = checkDefinition(definition)
      if (errors.length)
        fail('Project contract invalid: ' + JSON.stringify(errors))
      s.bindings[project] = {
        version,
        digest: digest({ definition, modules }),
        modules,
        overrides,
        at: new Date().toISOString(),
      }
      s.audit.push({
        action: 'bind',
        actor,
        project,
        version,
        at: new Date().toISOString(),
      })
      if (persist) write(s)
      return { ...s.bindings[project], definition }
    },
    preview(project, overrides = {}) {
      id(project)
      const s = read(),
        current = s.bindings[project]
      const target = s.published_version
        ? applyOverrides(s.versions[s.published_version].definition, overrides)
        : null
      if (target) {
        const errors = checkDefinition(target)
        if (errors.length)
          fail('Project preview contract invalid: ' + JSON.stringify(errors))
      }
      return {
        from_version: current?.version || null,
        from_digest: current?.digest || null,
        to_version: s.published_version,
        changes: compareDefinitions(
          current ? effective(project).definition : null,
          target,
        ),
        current: current ? effective(project).definition : null,
        target,
      }
    },
  }
}

function checkOverrideShape(overrides) {
  if (
    !overrides ||
    typeof overrides !== 'object' ||
    Array.isArray(overrides) ||
    Object.keys(overrides).some(
      (k) => !['templates', 'directories'].includes(k),
    )
  )
    fail('Unsupported project override')
}

function applyOverrides(base, overrides) {
  checkOverrideShape(overrides)
  const result = clone(base)
  if (overrides.directories) result.directories = clone(overrides.directories)
  if (overrides.templates) {
    if (!Array.isArray(overrides.templates))
      fail('Template overrides must be an array')
    for (const replacement of overrides.templates) {
      const index = result.templates.findIndex((t) => t.id === replacement.id)
      if (index < 0) fail('Cannot override an unknown template')
      const parent = result.templates[index]
      if (
        replacement.node_type !== parent.node_type ||
        parent.contract.fields.some(
          (x) => !replacement.contract?.fields?.includes(x),
        ) ||
        parent.contract.sections.some(
          (x) => !replacement.contract?.sections?.includes(x),
        ) ||
        parent.contract.tables.some(
          (t) =>
            !replacement.contract?.tables?.some(
              (r) =>
                preservesTableContract(t, r),
            ),
        ) ||
        weakensSectionGroups(parent.contract, replacement.contract) ||
        ['identifiers', 'references'].some((key) =>
          (parent.contract[key] || []).some((rule) =>
            !replacement.contract?.[key]?.some((next) =>
              Object.keys(rule).every((field) => next[field] === rule[field]),
            ),
          ),
        )
      )
        fail('Project overrides cannot weaken the published contract')
      result.templates[index] = clone(replacement)
    }
  }
  return result
}

export function templateFor(definition, node) {
  const template = definition.templates.find((t) =>
    node.template_id ? t.id === node.template_id : t.node_type === node.type,
  )
  if (!template || template.node_type !== node.type)
    fail('No matching bound document template for ' + node.type)
  return template
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

function checkFields(template, hs, add, phase, reviewer) {
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
  if (phase === 'publish' && (!reviewer || values.get('审核者') !== reviewer))
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

function checkRelationDefinitions(contract, add) {
  const bound = (section, column) => contract.tables.some((t) => t.section === section && t.columns.includes(column))
  for (const rule of contract.identifiers || [])
    if (!bound(rule.section, rule.column))
      add('identifier_contract', 'Identifier rule must bind a declared table column')
  for (const rule of contract.references || [])
    if (!bound(rule.section, rule.column) || !bound(rule.target_section, rule.target_column))
      add('reference_contract', 'Reference rule must bind declared source and target columns')
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

function checkTemplateDefinition(t, value, ids, add) {
  if (ids.has(t.id)) add('template_id', 'Duplicate template identifier')
  ids.add(t.id)
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(t.id) ||
    !Object.hasOwn(NODE_TYPES, t.node_type)
  )
    add('template_type', 'Invalid template ID or node type')
  for (const required of ['文档信息', '参考文档', '修订记录'])
    if (!t.contract.sections.includes(required))
      add('base_contract', 'Required base section: ' + required)
  for (const field of builtinFields)
    if (!t.contract.fields.includes(field))
      add('base_contract', 'Required base field: ' + field)
  checkFormatContract(t.contract, add)
  checkOptionalColumns(t.contract, add)
  for (const table of t.contract.tables)
    if (!t.contract.sections.includes(table.section) || !table.columns.length)
      add('table_contract', 'Table must bind a required section and columns')
  checkRelationDefinitions(t.contract, add)
  checkGroupDefinitions(t.contract, add)
  const body = t.body.replace(
    /\{\{([a-z_]+)\}\}/g,
    (original, key) => sampleVariables[key] || original,
  )
  if (/\{\{/.test(body))
    add('placeholder_unknown', 'Unknown template placeholder')
  if (
    checkDocument(t, body, { terms: value.terms }).some(
      (x) => x.severity === 'error',
    )
  )
    add('skeleton_invalid', 'Template skeleton violates its contract: ' + t.id)
  if (
    checkDocument(t, t.example, { terms: value.terms }).some(
      (x) => x.severity === 'error',
    )
  )
    add('example_invalid', 'Positive example violates contract: ' + t.id)
  if (
    !checkDocument(t, t.invalid_example, { terms: value.terms }).some(
      (x) => x.severity === 'error',
    )
  )
    add(
      'negative_example_valid',
      'Negative example must violate contract: ' + t.id,
    )
}

function checkOptionalColumns(contract, add) {
  for (const rule of contract.tables)
    if ((rule.optional_columns || []).some((column) => !rule.columns.includes(column)))
      add('table_optional_column', 'Optional columns must belong to the declared table')
}

function preservesTableContract(parent, replacement) {
  return replacement.section === parent.section &&
    JSON.stringify(replacement.columns) === JSON.stringify(parent.columns) &&
    replacement.min_rows >= parent.min_rows &&
    !(replacement.optional_columns || []).some((column) =>
      column !== '备注' && !(parent.optional_columns || []).includes(column),
    )
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

function validTimestamp(value) {
  const date = new Date(value)
  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().replace('.000Z', 'Z') === value
  )
}

function compareDefinitions(current, target) {
  if (!target) return []
  return ['templates', 'directories', 'terms', 'delivery'].flatMap(
    (section) => {
      const key =
        section === 'directories'
          ? 'path'
          : section === 'terms'
            ? 'abbreviation'
            : 'id'
      const old = new Map((current?.[section] || []).map((v) => [v[key], v]))
      const next = new Map(target[section].map((v) => [v[key], v]))
      return [...new Set([...old.keys(), ...next.keys()])].flatMap((id) =>
        JSON.stringify(old.get(id)) === JSON.stringify(next.get(id))
          ? []
          : [
              {
                section,
                id,
                action: !old.has(id)
                  ? 'added'
                  : !next.has(id)
                    ? 'removed'
                    : 'changed',
              },
            ],
      )
    },
  )
}

const sampleVariables = {
  document_id: 'DOC-001',
  document_name: 'Example Document',
  document_version: 'v1.0',
  product: 'Example',
  author: 'Example Author',
  reviewer: '待指定',
  created_at: '2026-11-13T00:00:00Z',
  updated_at: '2026-11-13T00:00:00Z',
  scope: '项目文档',
}

export function renderTemplate(template, values) {
  const text = template.body.replace(/\{\{([a-z_]+)\}\}/g, (_, key) => {
    const value = values?.[key]
    if (
      !Object.hasOwn(templateVariables, key) ||
      typeof value !== 'string' ||
      !value.trim() ||
      /[\r\n|<>]/.test(value)
    )
      fail('Missing or invalid template variable: ' + key)
    if (templateVariables[key] === 'utc_datetime' && !validTimestamp(value))
      fail('Template time must be UTC ISO8601: ' + key)
    return value
  })
  if (/\{\{/.test(text)) fail('Unknown template placeholder')
  return text
}

function specificContract(specific) {
  return Object.fromEntries(
    ['identifiers', 'references', 'section_groups']
      .filter((key) => specific?.[key])
      .map((key) => [key, clone(specific[key])]),
  )
}

function sectionLevel(title) {
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

function withNodeContract(template) {
  const base = NODE_TYPES[template.node_type] || {},
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
