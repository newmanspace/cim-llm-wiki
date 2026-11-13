import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { builtinDefaults, checkDefinition, checkDocument, createDefaultsStore } from '../document-defaults.mjs'

const idd = () => builtinDefaults().templates.find((t) => t.id === 'idd')
const errors = (text) => checkDocument(idd(), text).filter((d) => d.severity === 'error')

test('IDD is an optional API entry supplement with the five ordered server phases', () => {
  const template = idd()
  assert.equal(template.usage, 'supplementary')
  assert.deepEqual(errors(template.example), [])
  assert.equal(template.contract.tables.filter((t) => t.columns.includes('Function Agreement')).length, 5)
  assert.doesNotMatch(template.body, /## \d\. (模块结构|内部设计|界面设计|设计决策|验证与恢复)/)
  assert.ok(errors(template.example.replace('## 6. 执行后处理（After Execute Transaction）', '## 6. 省略后处理'))
    .some((d) => d.rule_id === 'section_required'))
  const withoutIDD = builtinDefaults()
  withoutIDD.templates = withoutIDD.templates.filter((t) => t.id !== 'idd')
  assert.deepEqual(checkDefinition(withoutIDD), [])
})

test('phase tables allow inapplicable return fields but still require agreement and unique sequence', () => {
  const template = idd()
  const row = template.example.split('\n').find((line) => line.startsWith('| 1 | 校验入参'))
  assert.ok(row)
  assert.deepEqual(errors(template.example), [])
  const cells = row.split('|')
  cells[2] = ' '
  assert.ok(errors(template.example.replace(row, cells.join('|'))).some((d) => d.rule_id === 'table_cell'))
  cells[2] = row.split('|')[2]
  cells[6] = ' '
  assert.deepEqual(errors(template.example.replace(row, cells.join('|'))), [])
  assert.ok(errors(template.example.replace(row, row + '\n' + row)).some((d) => d.rule_id === 'identifier_duplicate'))
})

test('optional columns must exist and cannot weaken common metadata or inherited phase requirements', () => {
  const definition = builtinDefaults()
  const template = definition.templates.find((t) => t.id === 'idd')
  const phase = template.contract.tables.find((t) => t.columns.includes('Function Agreement'))
  phase.optional_columns.push('Unknown')
  assert.ok(checkDefinition(definition).some((d) => d.rule_id === 'table_optional_column'))
  phase.optional_columns.pop()
  template.contract.tables.find((t) => t.section === '文档信息').optional_columns = ['内容']
  assert.ok(checkDefinition(definition).some((d) => d.rule_id === 'document_format_contract'))

  const root = mkdtempSync(join(tmpdir(), 'idd-contract-'))
  try {
    const store = createDefaultsStore(root)
    store.publish(0, 'Administrator')
    const replacement = idd()
    replacement.contract.tables.find((t) => t.columns.includes('Function Agreement')).optional_columns.push('Function Agreement')
    assert.throws(() => store.bind('demo', ['module'], { templates: [replacement] }), /weaken/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
