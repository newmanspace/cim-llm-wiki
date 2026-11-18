import { test } from 'node:test'
import assert from 'node:assert/strict'
import { builtinDefaults, checkDocument } from '../document-defaults.mjs'

test('Schema Card retains four slots and checks physical field columns and minimum rows', () => {
  const template = builtinDefaults().templates.find((t) => t.id === 'data-schema')
  assert.deepEqual(template.contract.sections.slice(1, -2), [
    '1. Mapping', '2. Fields', '3. Keys & Constraints', '4. Referenced By',
  ])
  assert.deepEqual(checkDocument(template, template.example), [])
  assert.equal(template.contract.tables.filter((t) => t.section === '2. Fields').length, 1)
  for (const title of ['2. Fields', '3. Keys & Constraints', '4. Referenced By']) {
    assert.ok(checkDocument(template, template.example.replace('## ' + title, '## Removed'))
      .some((d) => d.rule_id === 'section_required'))
  }
  assert.ok(checkDocument(template, template.example.replace('| 字段 | 类型/长度 | 空否 | 值域/码表 | 业务含义 |', '| 字段 | 类型/长度 | 空否 | 其他 | 业务含义 |'))
    .some((d) => d.rule_id === 'table_columns'))
  const row = template.example.split('\n').find((line) => line.startsWith('| id |'))
  assert.ok(row)
  assert.ok(checkDocument(template, template.example.replace(row, ''))
    .some((d) => d.rule_id === 'table_rows'))
})
