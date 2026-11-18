import { test } from 'node:test'
import assert from 'node:assert/strict'
import { builtinDefaults, checkDocument } from '../document-defaults.mjs'

test('API Card preserves six extraction slots and checks request and error table contracts', () => {
  const template = builtinDefaults().templates.find((t) => t.id === 'api')
  assert.deepEqual(template.contract.sections.slice(1, -2), [
    '1. Purpose', '2. Preconditions', '3. Request', '4. Effects', '5. Errors', '6. Related Scenarios',
  ])
  assert.deepEqual(checkDocument(template, template.example), [])
  for (const title of ['3. Request', '6. Related Scenarios']) {
    const errors = checkDocument(template, template.example.replace('## ' + title, '## Removed'))
    assert.ok(errors.some((d) => d.rule_id === 'section_required'))
  }
  const errors = checkDocument(template, template.example.replace('| param | 语义 | 值约束 |', '| param | 语义 | 其他 |'))
  assert.ok(errors.some((d) => d.severity === 'error'))
})
