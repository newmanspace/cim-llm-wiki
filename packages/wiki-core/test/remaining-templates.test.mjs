import { test } from 'node:test'
import assert from 'node:assert/strict'
import { builtinDefaults, checkDefinition, checkDocument } from '../document-defaults.mjs'

const ids = [
  'data-dictionary', 'code-index', 'frd', 'module', 'project', 'test-case',
  'release', 'deployment', 'runbook', 'incident', 'defect', 'faq', 'product',
  'scenario', 'interaction', 'user-manual', 'admin-manual', 'solution',
]

test('all remaining document types have concrete numbered contracts without increasing delivery obligations', () => {
  const definition = builtinDefaults()
  assert.equal(definition.templates.length, 26)
  assert.deepEqual(checkDefinition(definition), [])
  assert.deepEqual(definition.delivery, [
    { id: 'requirements', type: 'requirement', scope: 'project', min: 1 },
    { id: 'designs', type: 'design', scope: 'project', min: 1 },
    { id: 'modules', type: 'module', scope: 'module', min: 1 },
  ])
  for (const id of ids) {
    const template = definition.templates.find((t) => t.id === id)
    assert.ok(template, id)
    assert.doesNotMatch(template.body, /章节说明|正文说明|内容说明。/)
    assert.deepEqual(checkDocument(template, template.example), [], id)
    const title = template.contract.sections[1]
    const invalid = template.example.replace(title, title + '（删除的章节）')
    assert.ok(checkDocument(template, invalid).some((d) => d.rule_id === 'section_required'), id)
    for (const table of template.contract.tables.filter((t) => !['文档信息', '参考文档', '修订记录'].includes(t.section))) {
      const header = '| ' + table.columns.join(' | ') + ' |'
      const invalidTable = template.example.replace(header, header.replace(table.columns[0], '错误列名'))
      assert.ok(checkDocument(template, invalidTable).some((d) => d.rule_id === 'table_columns'), id + ': ' + table.section)
    }
  }
})

test('FRD has numbered nested Steps with exactly one inherited step table contract', () => {
  const template = builtinDefaults().templates.find((t) => t.id === 'frd')
  assert.ok(template.contract.sections.includes('2.1 Steps'))
  assert.ok(template.contract.sections.includes('2.2 What-Next Branches'))
  const tables = template.contract.tables.filter((t) => t.columns.includes('Target / Transaction'))
  assert.equal(tables.length, 1)
  assert.equal(tables[0].section, '2.1 Steps')
  assert.equal(tables[0].repeat, true)
})

test('optional supporting artifacts do not replace canonical requirements, designs or implementation contracts', () => {
  const templates = builtinDefaults().templates
  for (const id of ['code-index', 'frd', 'module', 'scenario', 'interaction', 'solution'])
    assert.equal(templates.find((t) => t.id === id).usage, 'supplementary', id)
  const testCase = templates.find((t) => t.id === 'test-case')
  assert.match(testCase.example, /未执行/)
  assert.match(templates.find((t) => t.id === 'deployment').example, /回退与数据恢复/)
})
