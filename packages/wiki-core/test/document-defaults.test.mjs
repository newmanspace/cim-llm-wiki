import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  builtinDefaults,
  renderTemplate,
  checkDefinition,
  checkDocument,
  createDefaultsStore,
} from '../document-defaults.mjs'

test('builtin templates bind executable contracts and positive/negative examples', () => {
  const definition = builtinDefaults()
  assert.deepEqual(checkDefinition(definition), [])
  for (const template of definition.templates) {
    assert.equal(
      checkDocument(template, template.example).filter(
        (x) => x.severity === 'error',
      ).length,
      0,
    )
    assert.ok(
      checkDocument(template, template.invalid_example).some(
        (x) => x.severity === 'error',
      ),
    )
  }
})

test('definition rejects unknown rules, contradictory fields and invalid examples', () => {
  const value = builtinDefaults()
  value.templates[0].contract.unknown_rule = true
  assert.ok(checkDefinition(value).length)
  delete value.templates[0].contract.unknown_rule
  value.templates[0].example = '# Empty'
  assert.ok(checkDefinition(value).some((x) => x.rule_id === 'example_invalid'))
})

test('confirmed URD requires its complete structure, unique identifiers and requirement acceptance links', () => {
  const template = builtinDefaults().templates.find((t) => t.id === 'urd')
  const check = (text) => checkDocument(template, text).filter((d) => d.severity === 'error')
  assert.deepEqual(check(template.example), [])
  assert.ok(check(template.example.replace('## 2. 需求范围', '## 需求范围未填写'))
    .some((d) => d.rule_id === 'section_required'))
  const requirement = template.example.split('\n').find((line) => line.startsWith('| REQ-001 |'))
  const acceptance = template.example.split('\n').find((line) => line.startsWith('| AC-001 |'))
  assert.ok(check(template.example.replace(requirement, requirement + '\n' + requirement))
    .some((d) => d.rule_id === 'identifier_duplicate'))
  assert.ok(check(template.example.replace(acceptance, acceptance + '\n' + acceptance))
    .some((d) => d.rule_id === 'identifier_duplicate'))
  assert.ok(check(template.example.replace(requirement, requirement.replace('AC-001', 'AC-404')))
    .some((d) => d.rule_id === 'identifier_reference'))
  assert.ok(check(template.example.replace(acceptance, acceptance.replace('REQ-001', 'REQ-404')))
    .some((d) => d.rule_id === 'identifier_reference'))
  const noReason = template.example.replace(/无参考文档：[^\n]+/, '')
  assert.ok(check(noReason).some((d) => d.rule_id === 'references_required'))
  assert.deepEqual(check(noReason.replace('| 文档名称或链接 | 参考用途 |\n| --- | --- |',
    '| 文档名称或链接 | 参考用途 |\n| --- | --- |\n| 业务需求确认纪要 | 确认需求范围及验收条件 |')), [])
})

test('identifier rules reject unbound columns and project overrides cannot remove confirmed checks', () => {
  const definition = builtinDefaults()
  definition.templates[0].contract.references[0].target_column = '不存在的列'
  assert.ok(checkDefinition(definition).some((d) => d.rule_id === 'reference_contract'))
  const root = mkdtempSync(join(tmpdir(), 'urd-contract-'))
  try {
    const store = createDefaultsStore(root)
    store.publish(0, 'Administrator')
    const template = structuredClone(builtinDefaults().templates[0])
    delete template.contract.identifiers
    assert.throws(() => store.bind('demo', ['requirements'], { templates: [template] }), /weaken/)
    template.contract.identifiers = builtinDefaults().templates[0].contract.identifiers
    delete template.contract.references
    assert.throws(() => store.bind('demo', ['requirements'], { templates: [template] }), /weaken/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('glossary enforces actual tables and order, ignores fenced headings', () => {
  const t = builtinDefaults().templates.find((x) => x.id === 'glossary')
  assert.ok(
    checkDocument(
      t,
      t.example.replace('英文名称 | 中文名称', '中文名称 | 英文名称'),
    ).some((x) => x.rule_id === 'table_columns'),
  )
  assert.ok(
    checkDocument(t, '```markdown\n' + t.example + '\n```').some(
      (x) => x.rule_id === 'section_required',
    ),
  )
  assert.ok(
    checkDocument(
      t,
      t.example.replace(
        'User Requirement Definition',
        'User Requirements Document',
      ),
    ).some((x) => x.rule_id === 'term_definition'),
  )
})

test('published defaults are immutable, optimistic revisions and project bindings persist', () => {
  const path = mkdtempSync(join(tmpdir(), 'defaults-'))
  try {
    const store = createDefaultsStore(path)
    assert.equal(store.state().revision, 0)
    store.save(builtinDefaults(), 0, 'operator')
    assert.throws(
      () => store.save(builtinDefaults(), 0, 'operator'),
      /revision/i,
    )
    store.publish(1, 'operator')
    const bound = store.bind('demo', ['module-a'])
    const updated = builtinDefaults()
    updated.name = 'Changed'
    store.save(updated, 2, 'operator')
    store.publish(3, 'operator')
    assert.equal(store.effective('demo').version, bound.version)
    assert.equal(
      createDefaultsStore(path).effective('demo').version,
      bound.version,
    )
    assert.equal(store.preview('demo', {}).from_version, bound.version)
    const upgraded = store.bind(
      'demo',
      ['module-a'],
      {},
      store.state().published_version,
      true,
    )
    assert.notEqual(upgraded.version, bound.version)
    assert.equal(upgraded.definition.name, 'Changed')
  } finally {
    rmSync(path, { recursive: true, force: true })
  }
})

test('project overrides cannot relax contracts and contract drift is rejected', () => {
  const root = mkdtempSync(join(tmpdir(), 'override-defaults-'))
  try {
    const store = createDefaultsStore(root)
    store.publish(0, 'Administrator')
    const replacement = structuredClone(builtinDefaults().templates[0])
    replacement.contract.fields = []
    assert.throws(
      () => store.bind('demo', ['module'], { templates: [replacement] }),
      /weaken/,
    )
    store.bind('demo', ['module'])
    const file = join(root, 'data/document-defaults/state.json')
    const state = JSON.parse(readFileSync(file, 'utf8'))
    state.versions.v1.definition.name = 'Changed outside publication'
    writeFileSync(file, JSON.stringify(state))
    assert.throws(() => store.effective('demo'), /drifted/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('document times, required cells, duplicate terms and publication reviewer are checked', () => {
  const definition = builtinDefaults(),
    template = definition.templates.find((t) => t.id === 'glossary')
  const check = (text, options = {}) =>
    checkDocument(template, text, { terms: definition.terms, ...options })
  assert.ok(
    check(
      template.example.replaceAll(
        '2026-11-13T00:00:00Z',
        '2026-02-30T00:00:00Z',
      ),
    ).some((d) => d.rule_id === 'field_datetime'),
  )
  assert.ok(
    check(template.example.replace('用户需求定义 | 定义', ' | 定义')).some(
      (d) => d.rule_id === 'table_cell',
    ),
  )
  assert.ok(
    check(template.example, {
      phase: 'publish',
      reviewer: 'Actual Reviewer',
    }).some((d) => d.rule_id === 'reviewer_mismatch'),
  )
})

test('rendered templates require real declared metadata and reject unfilled variables', () => {
  const template = builtinDefaults().templates.find((t) => t.id === 'urd')
  assert.throws(() => renderTemplate(template, {}), /variable/)
  const document = renderTemplate(template, {
    document_id: 'URD-TEST',
    document_name: 'Actual requirements',
    document_version: 'v2',
    product: 'Actual Product',
    author: 'Actual Author',
    reviewer: '待指定',
    created_at: '2026-11-13T00:00:00Z',
    updated_at: '2026-11-13T00:00:00Z',
    scope: 'Project requirements',
  })
  assert.ok(document.includes('Actual Product'))
  assert.ok(!document.includes('{{'))
  assert.equal(
    checkDocument(template, document).filter((d) => d.severity === 'error')
      .length,
    0,
  )
})

test('copied glossary templates retain terminology checks', () => {
  const definition = builtinDefaults(),
    template = definition.templates.find((t) => t.id === 'glossary')
  template.id = 'module-glossary'
  const invalid = template.example.replace(
    'User Requirement Definition',
    'User Requirements Document',
  )
  assert.ok(
    checkDocument(template, invalid, { terms: definition.terms }).some(
      (d) => d.rule_id === 'term_definition',
    ),
  )
})

test('automatic publication uses system approval evidence while manual reviewer matching remains strict', () => {
  const template = builtinDefaults().templates.find(t => t.id === 'glossary')
  const check = options => checkDocument(template, template.example, { phase: 'publish', ...options })
  assert.deepEqual(check({ approvalMode: 'auto', reviewer: 'system:quality-policy' }).filter(d => d.severity === 'error'), [])
  for (const options of [{ approvalMode: 'auto' }, { approvalMode: 'auto', reviewer: 'Claimed Human' }, { reviewer: 'system:quality-policy' }]) {
    assert.ok(check(options).some(d => d.rule_id === 'reviewer_mismatch'))
  }
  assert.ok(checkDocument(template, template.invalid_example, {phase:'publish', approvalMode:'auto', reviewer:'system:quality-policy'}).some(d=>d.severity==='error'))
})
