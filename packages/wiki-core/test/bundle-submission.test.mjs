import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { schemaErrors, schemaDiagnostics } from '../contracts.mjs'
import { builtinDefaults, templateFor } from '../document-defaults.mjs'

const example = () => JSON.parse(readFileSync(new URL('./fixtures/sdd-bundle.json', import.meta.url), 'utf8'))

test('the SDD Bundle fixture satisfies the full machine schema and selects the actual SDD type', () => {
  const bundle = example(), node = bundle.nodes[0]
  assert.deepEqual(schemaErrors('bundle', bundle), [])
  assert.deepEqual(schemaDiagnostics('submissionBundle', bundle), [])
  assert.equal(templateFor(builtinDefaults(), node).id, 'sdd')
  assert.equal(node.type, 'design')
  assert.ok(!/^# /m.test(node.content), 'Submission content excludes its leading H1')
  assert.equal(node.qscore.total, node.confidence)
})

test('schema paths include missing and extra property names with correct JSON Pointer escaping', () => {
  const bundle = example()
  delete bundle.nodes[0].type
  bundle.nodes[0]['a/b~c'] = 'extra'
  const diagnostics = schemaDiagnostics('submissionBundle', bundle)
  assert.ok(diagnostics.some(d => d.path === '/nodes/0/type' && d.keyword === 'required'))
  assert.ok(diagnostics.some(d => d.path === '/nodes/0/a~1b~0c' && d.keyword === 'additionalProperties'))
  assert.ok(!diagnostics.some(d => /api_type|rule_type|pattern/.test(d.path)))
  assert.ok(schemaDiagnostics('submissionBundle', null).some(d => d.path === '/' && d.keyword === 'type'))
})

test('submission schema defers only fields owned by server processing and validates supplied values', () => {
  const bundle = example()
  for (const field of ['schema_version', 'confidence', 'reviewer', 'status', 'created_at', 'updated_at']) delete bundle.nodes[0][field]
  assert.deepEqual(schemaDiagnostics('submissionBundle', bundle), [])
  assert.ok(schemaErrors('bundle', bundle).length > 0)
  bundle.nodes[0].confidence = 'invalid'
  assert.ok(schemaDiagnostics('submissionBundle', bundle).some(d => d.path === '/nodes/0/confidence'))
  delete bundle.nodes[0].product
  assert.ok(schemaDiagnostics('submissionBundle', bundle).some(d => d.path === '/nodes/0/product'))
})

test('template mismatch reports both the node type and the requested template ID', () => {
  const node = example().nodes[0]; node.template_id = 'sdd-alarm'
  assert.throws(() => templateFor(builtinDefaults(), node), error => error.message.includes('design') && error.message.includes('sdd-alarm'))
})
