import { test } from 'node:test'
import assert from 'node:assert/strict'
import { builtinDefaults } from '../document-defaults.mjs'
import { documentDirectoryRule, documentTargetErrors } from '../document-routing.mjs'

test('document routing rejects a valid SDD body location in guides and reports the actual allowed directory', () => {
  const definition = builtinDefaults()
  assert.deepEqual(documentTargetErrors(definition, 'sdd', 'doc/50-designs/example.md'), [])
  const [error] = documentTargetErrors(definition, 'sdd', 'doc/90-guides/example.md')
  assert.equal(error.rule_id, 'document_directory_mismatch')
  assert.equal(error.node_type, 'design')
  assert.deepEqual(error.allowed_directories, ['doc/50-designs'])
  for (const [id, path] of [['urd', 'doc/40-requirements/req.md'], ['user-manual', 'doc/90-guides/manual.md'], ['api', 'code/apis/api.md']])
    assert.deepEqual(documentTargetErrors(definition, id, path), [], id)
})

test('nearest nonempty rule overrides parents while containers do not grant or erase types', () => {
  const definition = builtinDefaults()
  definition.directories.push(
    { path: 'doc/50-designs/restricted', node_types: ['requirement'] },
    { path: 'doc/50-designs/restricted/container', node_types: [] },
  )
  const path = 'doc/50-designs/restricted/container/example.md'
  assert.equal(documentTargetErrors(definition, 'sdd', path)[0].rule_id, 'document_directory_mismatch')
  assert.deepEqual(documentTargetErrors(definition, 'urd', path), [])
  assert.deepEqual(documentTargetErrors(definition, 'sdd', 'doc/50-designs/other/nested/example.md'), [])
  assert.equal(documentDirectoryRule(definition, 'doc/50-designs/restricted/container').path, 'doc/50-designs/restricted')
})

test('unknown or unsafe paths cannot be rescued by filename heuristics or a similar directory prefix', () => {
  const definition = builtinDefaults()
  for (const path of ['doc/50-designs-other/example.md', 'doc/10-planning/example.md'])
    assert.equal(documentTargetErrors(definition, 'sdd', path)[0].rule_id, 'document_directory_unmapped')
  for (const path of ['doc/50-designs/../90-guides/example.md', '/doc/50-designs/example.md', 'doc//50-designs/example.md', 'doc/50-designs/README.md', 'code/apis/a.txt', 'doc/50-designs\\example.md', null])
    assert.equal(documentTargetErrors(definition, 'sdd', path)[0].rule_id, 'document_target_invalid')
  assert.equal(documentTargetErrors(definition, 'missing', 'doc/50-designs/example.md')[0].rule_id, 'document_template_unknown')
  assert.equal(documentTargetErrors(definition, 'code-index', 'code/code-index/example.md')[0].rule_id, 'document_directory_unmapped')
})

test('custom Project routes are authoritative and sibling candidates are reported rather than guessed', () => {
  const definition = builtinDefaults()
  definition.directories = [{ path: 'doc', node_types: [] },
    { path: 'doc/team-a', node_types: ['design'] }, { path: 'doc/team-b', node_types: ['design'] }]
  assert.deepEqual(documentTargetErrors(definition, 'sdd', 'doc/team-a/example.md'), [])
  assert.deepEqual(documentTargetErrors(definition, 'sdd', 'doc/50-designs/example.md')[0].allowed_directories, ['doc/team-a', 'doc/team-b'])
})
