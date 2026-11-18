import { test } from 'node:test'
import assert from 'node:assert/strict'
import { builtinDefaults, checkDocument } from '../document-defaults.mjs'

test('Rule Card v2 retains all six slots and rejects omitted rule consequences or constraints', () => {
  const template = builtinDefaults().templates.find((t) => t.id === 'business-rule')
  assert.deepEqual(template.contract.sections.slice(1, -2), [
    '1. Statement', '2. Preconditions', '3. Constraint', '4. Violation', '5. Related Operations', '6. Test Hint',
  ])
  assert.deepEqual(checkDocument(template, template.example), [])
  for (const title of ['3. Constraint', '4. Violation', '6. Test Hint']) {
    const errors = checkDocument(template, template.example.replace('## ' + title, '## Removed'))
    assert.ok(errors.some((d) => d.rule_id === 'section_required'))
  }
  assert.match(template.body, /待确认/)
  assert.match(template.body, /applies_to/)
})
