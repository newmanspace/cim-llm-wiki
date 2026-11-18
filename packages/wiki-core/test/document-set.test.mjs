import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { stringify } from 'yaml'
import { validateWiki } from '../validate.mjs'
import { validateDocumentSets } from '../document-set.mjs'
import { createDefaultsStore } from '../document-defaults.mjs'
import { compileBundle } from '../compile.mjs'
import { bindFixture, managedBody } from './support/document-fixture.mjs'

function fixture(t) {
  const projectRoot = mkdtempSync(join(tmpdir(), 'project-delivery-'))
  t.after(() => rmSync(projectRoot, { recursive: true, force: true }))
  const wikiRoot = join(projectRoot, 'data/wiki')
  mkdirSync(join(wikiRoot, 'demo/doc'), { recursive: true })
  return { projectRoot, wikiRoot }
}
function bind(f, delivery = [{ id: 'requirements', type: 'requirement', scope: 'project', min: 1 }], modules = ['wip', 'eqp'], project = 'demo') {
  bindFixture(f.projectRoot, project)
  const store = createDefaultsStore(f.projectRoot)
  const state = store.state(), definition = structuredClone(state.draft)
  definition.delivery = delivery
  store.save(definition, state.revision, 'Test Administrator')
  store.publish(state.revision + 1, 'Test Administrator')
  store.bind(project, modules, {}, undefined, true)
}
function node(id = 'REQ-WIP-001', module = 'wip') {
  return { schema_version: '1.0', id, type: 'requirement', plane: 'doc', module,
    product: 'Test', version: 'v1', domain: 'test', source: 'source.md', status: 'published',
    confidence: 0.97, review_level: 'L0_auto', reviewer: 'auto',
    created_at: '2026-10-28T00:00:00Z', updated_at: '2026-10-28T00:00:00Z' }
}
function page(f, fm = node(), project = 'demo') {
  const path = join(f.wikiRoot, project, 'doc/requirements', `${fm.id.toLowerCase()}.md`)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, `---\n${stringify(fm)}---\n${managedBody('# Requirement\n\nConcrete behavior.')}\n`)
  return path
}
const codes = f => validateWiki(f).errors.map(e => e.code)

test('empty projects require a Project binding and enforce its delivery minimum without files', t => {
  const f = fixture(t)
  assert.ok(codes(f).includes('document_contract_error'))
  bind(f)
  assert.ok(codes(f).includes('document_count'))
  page(f)
  assert.deepEqual(validateWiki(f).errors, [])
  assert.equal(existsSync(join(f.wikiRoot, 'demo/document-contract.json')), false)
  writeFileSync(join(f.wikiRoot, 'demo/document-contract.json'), '{')
  assert.deepEqual(validateWiki(f).errors, [], 'Retired files cannot override Project delivery')
})

test('registered projects without content still require a valid Project binding', t => {
  const f = fixture(t); bind(f); page(f)
  const path = join(f.projectRoot, 'data/documents/project-registry.json')
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify({ projects: { demo: {}, registered: {} } }))
  assert.ok(validateWiki(f).errors.some(e => e.code === 'document_contract_error' && e.path === 'registered/delivery'))
})

test('Project delivery counts exclude archived pages and cover every bound module', t => {
  const f = fixture(t)
  bind(f, [{ id: 'requirements', type: 'requirement', scope: 'module', min: 1 }])
  page(f, { ...node(), status: 'archived' })
  assert.equal(validateWiki(f).errors.filter(e => e.code === 'document_count').length, 2)
  page(f)
  assert.ok(validateWiki(f).errors.some(e => e.code === 'document_count' && e.message.includes('eqp')))
  page(f, node('REQ-EQP-001', 'eqp'))
  assert.deepEqual(validateWiki(f).errors, [])
})

test('unknown modules and empty module inventories fail delivery validation', t => {
  const f = fixture(t); bind(f); page(f, node('REQ-OTHER-001', 'outside'))
  assert.ok(codes(f).includes('document_module_unknown'))
  bind(f, [{ id: 'requirements', type: 'requirement', scope: 'module', min: 1 }], [])
  assert.ok(codes(f).includes('document_contract_error'))
})

test('Project delivery versions stay pinned until an explicit binding change', t => {
  const f = fixture(t); bind(f); page(f)
  const store = createDefaultsStore(f.projectRoot), state = store.state()
  const definition = structuredClone(state.draft)
  definition.delivery = [{ id: 'requirements', type: 'requirement', scope: 'project', min: 2 }]
  store.save(definition, state.revision, 'Administrator'); store.publish(state.revision + 1, 'Administrator')
  assert.deepEqual(validateWiki(f).errors, [])
  store.bind('demo', ['wip', 'eqp'], {}, undefined, true)
  assert.ok(codes(f).includes('document_count'))
})

test('compilation enforces Project counts before changing published content', async t => {
  const f = fixture(t); bind(f); const dest = page(f), before = readFileSync(dest, 'utf8')
  bind(f, [{ id: 'requirements', type: 'requirement', scope: 'project', min: 3 }])
  const bundle = { schema_version: '1.0', bundle_id: 'add-requirement', project: 'demo', nodes: [
    { ...node('REQ-WIP-002'), title: 'New requirement', content: managedBody('# New requirement\n\nConcrete new behavior.').replace(/^# [^\n]+\n/, '') },
  ] }
  await assert.rejects(compileBundle(bundle, f), /document_count/)
  assert.equal(readFileSync(dest, 'utf8'), before)
  assert.equal(existsSync(join(f.wikiRoot, 'demo/doc/requirements/req-wip-002.md')), false)
  bind(f, [{ id: 'requirements', type: 'requirement', scope: 'project', min: 2 }])
  await compileBundle(bundle, f)
  assert.deepEqual(validateWiki(f).errors, [])
})

test('another Project cannot satisfy the delivery minimum', t => {
  const f = fixture(t); bind(f); bind(f, [{ id: 'requirements', type: 'requirement', scope: 'project', min: 0 }], [], 'other')
  page(f, node(), 'other')
  assert.ok(validateWiki(f).errors.some(e => e.code === 'document_count' && e.path === 'demo/delivery'))
})

// Preserve deterministic rule validation independently of configuration storage.
test('delivery validator retains maximum, selectors, structures and reference checks', () => {
  const contract = { schema_version: '1.0', project: 'demo', modules: ['wip'], allow_unlisted: false, documents: [
    { id: 'requirements', type: 'requirement', scope: 'module', min: 1, max: 1,
      where: { domain: 'test' }, structure: { requiredSections: ['## Acceptance'] },
      references: [{ field: 'related_requirements', target_rule: 'requirements', min: 1, same_module: true }] },
  ] }
  const pages = new Map(['one', 'two'].map(key => [key, { project: 'demo', fm: node(), tokens: [] }]))
  const validate = () => validateDocumentSets({ wikiRoot: '/tmp', projects: new Set(['demo']), pages, resolveLink: () => null, contractFor: () => contract })
  const errors = validate().map(e => e.code)
  for (const code of ['document_count', 'document_structure', 'document_reference']) assert.ok(errors.includes(code))
  contract.documents[0].where.domain = 'other'
  assert.ok(validate().some(e => e.code === 'document_unlisted'))
  contract.documents[0].references[0].target_rule = 'missing'
  assert.ok(validate().some(e => e.code === 'document_contract_error'))
})
