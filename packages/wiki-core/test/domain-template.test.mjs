import { test } from 'node:test'
import assert from 'node:assert/strict'
import { builtinDefaults, checkDocument } from '../document-defaults.mjs'

test('Domain Card keeps eight slots and permits an explicitly inapplicable empty state table', () => {
  const template = builtinDefaults().templates.find((t) => t.id === 'business-object')
  assert.deepEqual(template.contract.sections.slice(1, -2), [
    '1. Description', '2. Identity', '3. State Machine', '4. Attributes',
    '5. Relations', '6. Reasoning Hint', '7. Invariants', '8. Related Operations',
  ])
  assert.deepEqual(checkDocument(template, template.example), [])
  const stateTables = template.contract.tables.filter((t) => t.section === '3. State Machine')
  assert.equal(stateTables.length, 1)
  assert.equal(stateTables[0].min_rows, 0)
  for (const title of ['3. State Machine', '6. Reasoning Hint', '7. Invariants']) {
    assert.ok(checkDocument(template, template.example.replace('## ' + title, '## Removed'))
      .some((d) => d.rule_id === 'section_required'))
  }
  assert.ok(checkDocument(template, template.example.replace('| from | trigger | to | guard |', '| from | trigger | to | other |'))
    .some((d) => d.rule_id === 'table_columns'))
})
