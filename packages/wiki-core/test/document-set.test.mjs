import { bindFixture, managedBody } from './support/document-fixture.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { stringify } from 'yaml'
import { validateWiki } from '../validate.mjs'
import { compileBundle } from '../compile.mjs'

const contract = () => ({ schema_version: '1.0', project: 'demo', modules: ['wip', 'eqp'], documents: [
  { id: 'requirements', type: 'requirement', scope: 'project', min: 1 },
] })

function fixture(t) {
  const projectRoot = mkdtempSync(join(tmpdir(), 'document-set-'))
  t.after(() => rmSync(projectRoot, { recursive: true, force: true }))
  const wikiRoot = join(projectRoot, 'data/wiki')
  mkdirSync(join(wikiRoot, 'demo/doc'), { recursive: true })
  return { projectRoot, wikiRoot }
}
function save(f, value = contract(), project = 'demo') {
  bindFixture(f.projectRoot,project)
  const dest = join(f.wikiRoot, project, 'document-contract.json')
  mkdirSync(join(dest, '..'), { recursive: true })
  writeFileSync(dest, typeof value === 'string' ? value : JSON.stringify(value))
  return dest
}
function node(id = 'REQ-WIP-001', module = 'wip') {
  return { schema_version: '1.0', id, type: 'requirement', plane: 'doc', module,
    product: 'Test', version: 'v1', domain: 'test', source: 'source.md', status: 'published',
    confidence: 0.97, review_level: 'L0_auto', reviewer: 'auto',
    created_at: '2026-10-28T00:00:00Z', updated_at: '2026-10-28T00:00:00Z' }
}
function page(f, fm = node(), body = '# Requirement\n\nConcrete behavior.') {
  body=managedBody(body,fm.reviewer)
  const path = join(f.wikiRoot, 'demo/doc/requirements', `${fm.id.toLowerCase()}.md`)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, `---\n${stringify(fm)}---\n${body}\n`)
  return path
}
const codes = f => validateWiki(f).errors.map(e => e.code)

test('every project, including an empty project, must have a contract', t => {
  const f = fixture(t)
  assert.ok(codes(f).includes('document_contract_missing'))
  save(f)
  assert.ok(codes(f).includes('document_count'))
  page(f)
  assert.deepEqual(validateWiki(f).errors, [])
  mkdirSync(join(f.wikiRoot, 'empty/doc'), { recursive: true })
  assert.ok(codes(f).includes('document_contract_missing'))
})

test('registered projects without wiki directories are also required to declare a contract', t => {
  const f = fixture(t); save(f); page(f)
  const registry = join(f.projectRoot, 'data/documents/project-registry.json')
  mkdirSync(join(registry, '..'), { recursive: true })
  writeFileSync(registry, JSON.stringify({ projects: { demo: {}, registered: {} } }))
  assert.ok(validateWiki(f).errors.some(e => e.code === 'document_contract_missing' && e.path.startsWith('registered/')))
})

test('legacy empty category directories are not mistaken for projects', t => {
  const f = fixture(t); save(f); page(f)
  for (const dir of ['apis', 'requirements', 'modules']) mkdirSync(join(f.wikiRoot, dir))
  assert.deepEqual(validateWiki(f).errors, [])
})

test('corrupt, unknown-version, wrong-project and unknown-type contracts fail closed', t => {
  const f = fixture(t); page(f)
  for (const value of ['{bad', { ...contract(), schema_version: '2.0' }, { ...contract(), project: 'other' },
    { ...contract(), documents: [{ id: 'bad', type: 'unknown', scope: 'project', min: 0 }] }]) {
    save(f, value)
    assert.ok(codes(f).includes('document_contract_error'))
  }
  save(f, '{"schema_version":"1.0","project":"demo","project":"other","documents":[]}')
  assert.ok(codes(f).includes('document_contract_error'))
})

test('project counts enforce both minimum and maximum and exclude archived pages', t => {
  const f = fixture(t)
  const c = contract(); c.documents[0].max = 1
  save(f, c)
  page(f, { ...node(), status: 'archived' })
  assert.ok(codes(f).includes('document_count'))
  page(f)
  assert.deepEqual(validateWiki(f).errors, [])
  page(f, node('REQ-WIP-002'))
  assert.ok(codes(f).includes('document_count'))
})

test('per-module coverage uses the declared module inventory, including modules with no pages', t => {
  const f = fixture(t)
  const c = contract(); c.documents[0].scope = 'module'
  save(f, c); page(f)
  assert.ok(validateWiki(f).errors.some(e => e.code === 'document_count' && e.message.includes('eqp')))
  page(f, node('REQ-EQP-001', 'eqp'))
  assert.deepEqual(validateWiki(f).errors, [])
})

test('module subsets work and invalid/empty module scopes and duplicate rule IDs are rejected', t => {
  const f = fixture(t); page(f)
  const c = contract(); c.documents[0].scope = 'module'; c.documents[0].modules = ['wip']
  save(f, c); assert.deepEqual(validateWiki(f).errors, [])
  for (const modify of [c => { c.documents[0].modules = ['missing'] }, c => { c.modules = [] },
    c => { c.documents.push({ ...c.documents[0] }) }, c => { c.documents[0].max = 0 }]) {
    const invalid = structuredClone(c); modify(invalid); save(f, invalid)
    assert.ok(codes(f).includes('document_contract_error'))
  }
})

test('optional rules and strict document lists honor metadata selectors', t => {
  const f = fixture(t); page(f)
  const c = contract(); c.allow_unlisted = false; c.documents[0].where = { domain: 'other' }
  c.documents[0].min = 0
  save(f, c)
  assert.ok(codes(f).includes('document_unlisted'))
  c.documents[0].where.domain = 'test'; save(f, c)
  assert.deepEqual(validateWiki(f).errors, [])
  page(f, node('REQ-OTHER-001', 'outside'))
  assert.ok(codes(f).includes('document_module_unknown'))
})

test('document rules add mandatory sections and tables without weakening base contracts', t => {
  const f = fixture(t); page(f)
  const c = contract(); c.documents[0].structure = { requiredSections: ['## Acceptance'],
    tables: [{ section: '## Acceptance', columns: ['Case', 'Expected'] }] }
  save(f, c)
  assert.ok(codes(f).includes('document_structure'))
  page(f, node(), '# Requirement\n\n## Acceptance\n\n| Case | Expected |\n|---|---|\n| 1 | Accepted |')
  assert.deepEqual(validateWiki(f).errors, [])
})

test('single-character section titles are valid structural selectors', t => {
  const f = fixture(t)
  const c = contract(); c.documents[0].structure = { requiredSections: ['## 一'] }
  save(f, c); page(f, node(), '# Requirement\n\n## 一\n\nConcrete acceptance behavior.')
  assert.deepEqual(validateWiki(f).errors, [])
})

test('required references must target matching published documents in the permitted module', t => {
  const f = fixture(t)
  const c = contract(); c.documents = [
    { id: 'wip', type: 'requirement', scope: 'module', modules: ['wip'], min: 1,
      references: [{ field: 'related_requirements', target_rule: 'eqp', min: 1 }] },
    { id: 'eqp', type: 'requirement', scope: 'module', modules: ['eqp'], min: 1 },
  ]
  save(f, c); page(f); page(f, node('REQ-EQP-001', 'eqp'))
  assert.ok(codes(f).includes('document_reference'))
  page(f, { ...node(), related_requirements: ['[[doc/requirements/req-eqp-001.md]]'] })
  assert.deepEqual(validateWiki(f).errors, [])
  c.documents[0].references[0].same_module = true; save(f, c)
  assert.ok(codes(f).includes('document_reference'))
})

test('unknown reference rules, wrong reference types and missing templates are configuration errors', t => {
  const f = fixture(t); page(f)
  const c = contract(); c.documents[0].references = [{ field: 'related_apis', target_rule: 'missing', min: 1 }]
  save(f, c); assert.ok(codes(f).includes('document_contract_error'))
  c.documents[0].references[0].target_rule = 'requirements'
  save(f, c); assert.ok(codes(f).includes('document_contract_error'))
  delete c.documents[0].references; c.documents[0].template = 'missing.md'
  save(f, c); assert.ok(codes(f).includes('document_contract_error'))
})

test('compilation enforces collection counts before changing published content', async t => {
  const f = fixture(t); const dest = page(f); const before = readFileSync(dest, 'utf8')
  const c = contract(); c.documents[0].max = 1; save(f, c)
  const b = { schema_version: '1.0', bundle_id: 'add-requirement', project: 'demo', nodes: [
    { ...node('REQ-WIP-002'), title: 'New requirement', content: managedBody('# New requirement\n\nConcrete new behavior.').replace(/^# [^\n]+\n/,'') },
  ] }
  await assert.rejects(compileBundle(b, f), /document_count/)
  assert.equal(readFileSync(dest, 'utf8'), before)
  assert.equal(existsSync(join(f.wikiRoot, 'demo/doc/requirements/req-wip-002.md')), false)
  c.documents[0].max = 2; save(f, c)
  await compileBundle(b, f)
  assert.deepEqual(validateWiki(f).errors, [])
})

test('existing template manifests cannot relax the document contract structure', t => {
  const f = fixture(t); page(f)
  const c = contract(); c.documents[0].structure = { requiredSections: ['## Acceptance'] }
  save(f, c)
  const path = join(f.wikiRoot, 'demo/templates/manifest.json')
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify({ version: 1, templates: { requirement: { requiredSections: [] } } }))
  assert.ok(codes(f).includes('document_structure'))
})

test('another project cannot satisfy the current project delivery minimum', t => {
  const f = fixture(t); save(f)
  save(f, { schema_version: '1.0', project: 'other', documents: [{ id: 'requirements', type: 'requirement', scope: 'project', min: 0 }] }, 'other')
  const fm = node()
  const dest = join(f.wikiRoot, 'other/doc/requirements/req-wip-001.md')
  mkdirSync(join(dest, '..'), { recursive: true })
  writeFileSync(dest, `---\n${stringify(fm)}---\n# Requirement\n\nConcrete behavior.`)
  assert.ok(validateWiki(f).errors.some(e => e.code === 'document_count' && e.path.startsWith('demo/')))
})

test('the documented MES example is a valid delivery contract', t => {
  const f = fixture(t)
  const c = JSON.parse(readFileSync(new URL('../../../contracts/wiki/examples/mes-document-contract.json', import.meta.url), 'utf8'))
  c.project = 'demo'
  save(f, c)
  const result = validateWiki(f)
  assert.equal(result.errors.some(e => e.code === 'document_contract_error'), false, JSON.stringify(result.errors))
  assert.ok(result.errors.some(e => e.code === 'document_count'))
})
