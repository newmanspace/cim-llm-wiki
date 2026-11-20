import { checkDocument as checkLocalDocument, checkOptionalColumns, validTimestamp, sectionLevel } from './document-check.mjs'
import { namingPolicyErrors } from './document-naming.mjs'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import Ajv from 'ajv'
import { urdTemplate } from './urd-template.mjs'
import { sddTemplate } from './sdd-template.mjs'
import { iddTemplate } from './idd-template.mjs'
import { apiTemplate } from './api-template.mjs'
import { ruleTemplate } from './rule-template.mjs'
import { domainTemplate } from './domain-template.mjs'
import { schemaTemplate } from './schema-template.mjs'
import { remainingTemplates } from './remaining-templates.mjs'
import { checkGroupDefinitions, weakensSectionGroups } from './section-groups.mjs'
import { DOCUMENT_FIELDS, formatTemplate, checkFormatContract, unnumberedTitle } from './document-format.mjs'
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
  namingPolicyErrors(value).forEach(message => add('document_naming_policy', message))
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
    projects: () => Object.keys(read().bindings),
    binding(project) {
      id(project)
      return read().bindings[project] || null
    },
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
    fail('No matching bound document template: type=' + JSON.stringify(node.type) + ', template_id=' + JSON.stringify(node.template_id ?? null))
  return template
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

function preservesTableContract(parent, replacement) {
  return replacement.section === parent.section &&
    JSON.stringify(replacement.columns) === JSON.stringify(parent.columns) &&
    replacement.min_rows >= parent.min_rows &&
    !(replacement.optional_columns || []).some((column) =>
      column !== '备注' && !(parent.optional_columns || []).includes(column),
    )
}

function compareDefinitions(current, target) {
  if (!target) return []
  const changes = ['templates', 'directories', 'terms', 'delivery'].flatMap(
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
  if (JSON.stringify(current?.naming) !== JSON.stringify(target.naming))
    changes.push({ section: 'naming', id: 'policy', action: current?.naming ? 'changed' : 'added' })
  return changes
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


export function checkDocument(template, text, options = {}) {
  return checkLocalDocument(template, text, { ...options, terms: options.terms ?? builtinDefaults().terms })
}
