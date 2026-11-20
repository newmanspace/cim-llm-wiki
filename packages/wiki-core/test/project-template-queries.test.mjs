import { checkCandidate } from '../local-ingest.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { createDefaultsStore } from '../document-defaults.mjs'
import { createKnowledgeServer } from '../../wiki-service/server.mjs'

async function fixture(t, kind = 'repository_docs') {
  const root = mkdtempSync(join(tmpdir(), 'project-template-queries-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const defaults = createDefaultsStore(root)
  defaults.publish(0, 'Administrator')
  mkdirSync(join(root, 'data/project-wiki'), { recursive: true })
  writeFileSync(join(root, 'data/project-wiki/demo.json'), JSON.stringify({ contentKind: kind, sourceDirectory: 'data/projects/demo/wiki' }))
  let unavailable = false
  let sourceFailure = false
  const ledger = createServer((req, res) => {
    const parts = new URL(req.url, 'http://localhost').pathname.split('/')
    const project = parts[4], resource = parts.at(-1)
    res.writeHead(unavailable || (sourceFailure && resource === 'data-sources') ? 503 : project === 'demo' ? 200 : 404, { 'Content-Type': 'application/json' })
    const data = resource === 'project' ? { id: project, name: 'Demo', repos: [], modules: ['core'], docs: [] } : { items: [], next_cursor: null }
    res.end(JSON.stringify(unavailable || project !== 'demo' ? { error: 'Ledger failed' } : { data }))
  })
  ledger.listen(0, '127.0.0.1'); await once(ledger, 'listening')
  t.after(() => { ledger.closeAllConnections(); ledger.close() })
  const server = createKnowledgeServer({ projectRoot: root, logWriter: () => {}, token: 'agent', ledgerURL: `http://127.0.0.1:${ledger.address().port}`, ledgerToken: 'l'.repeat(40), roots: { team: root } })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close() })
  async function api(path, { token = 'agent', data, internal = false } = {}) {
    const r = await fetch(`http://127.0.0.1:${server.address().port}${internal ? '/internal/document-defaults/' : '/api/v2/knowledge/'}${path}`, {
      method: data ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(internal ? { 'X-Settings-Actor': 'Administrator' } : {}) }, body: data && JSON.stringify(data),
    })
    return { status: r.status, value: await r.json() }
  }
  return { root, defaults, api, failRegistry() { unavailable = true }, failSources() { sourceFailure = true } }
}

test('project discovery succeeds without templates and template errors distinguish missing source, template and project', async t => {
  const f = await fixture(t)
  const p = await f.api('projects/demo')
  assert.equal(p.status, 200)
  assert.equal(p.value.project_info.name, 'Demo')
  assert.equal(p.value.content_kind, 'repository_docs')
  assert.deepEqual(p.value.data_sources, [])
  assert.equal(Object.hasOwn(p.value, 'templates'), false)
  const missing = await f.api('projects/demo/templates?template_id=sdd')
  assert.equal(missing.status, 409)
  assert.equal(missing.value.code, 'TEMPLATE_SOURCE_UNBOUND')
  assert.equal(f.defaults.binding('demo'), null, 'GET does not bind global defaults')
  assert.equal((await f.api('projects/other/templates')).status, 404)
  assert.equal((await f.api('projects/demo', { token: 'wrong' })).status, 401)
  assert.equal((await f.api('projects/demo/templates', { token: 'wrong' })).status, 401)
  for (const path of ['projects/%ZZ', 'projects/constructor', 'projects/demo/templates?template_id=', 'projects/demo/templates?template_id=..']) assert.equal((await f.api(path)).status, 400)
  f.defaults.bind('demo', ['core'])
  const unknown = await f.api('projects/demo/templates?template_id=nonexistent')
  assert.equal(unknown.status, 404)
  assert.equal(unknown.value.code, 'TEMPLATE_NOT_FOUND')
})

test('both wiki modes read the exact bound templates; repository runtime context remains inapplicable', async t => {
  for (const kind of ['strict_nodes', 'repository_docs']) {
    const f = await fixture(t, kind)
    const sdd = f.defaults.state().draft.templates.find(t => t.id === 'sdd')
    f.defaults.bind('demo', ['core'], { templates: [{ ...sdd, body: sdd.body.replace('### 1.1 功能目的', '### 1.1 功能目的\n\nPROJECT_TEMPLATE_MARKER') }] })
    const before = readFileSync(join(f.root, 'data/document-defaults/state.json'), 'utf8')
    const result = await f.api('projects/demo/templates?template_id=sdd')
    assert.equal(result.status, 200)
    assert.equal(result.value.binding.version, 'v1')
    assert.equal(result.value.binding.digest, f.defaults.effective('demo').digest)
    assert.equal(result.value.templates.length, 1)
    assert.equal(result.value.templates[0].id, 'sdd')
    assert.ok(result.value.templates[0].body.includes('功能设计'))
    assert.ok(result.value.templates[0].body.includes('PROJECT_TEMPLATE_MARKER'), 'Read the project override instead of the global template')
    assert.ok(result.value.templates[0].contract.sections.length)
    assert.ok((await f.api('projects/demo/templates')).value.templates.length > 1)
    assert.equal(readFileSync(join(f.root, 'data/document-defaults/state.json'), 'utf8'), before)
    const context = await f.api('context?project=demo')
    assert.equal(context.value.capabilities.submit, kind === 'strict_nodes')
    if (kind === 'repository_docs') assert.equal(context.value.document_defaults, null)
  }
})

test('template corruption is independent from project lookup and upstream outage is not unbound', async t => {
  const f = await fixture(t)
  f.defaults.bind('demo', ['core'])
  const path = join(f.root, 'data/document-defaults/state.json')
  const state = JSON.parse(readFileSync(path, 'utf8'))
  state.versions.v1.definition.templates[0].body += '\nchanged'
  writeFileSync(path, JSON.stringify(state))
  assert.equal((await f.api('projects/demo')).status, 200)
  const bad = await f.api('projects/demo/templates')
  assert.equal(bad.status, 422)
  assert.equal(bad.value.code, 'TEMPLATE_SOURCE_INVALID')
  f.failRegistry()
  const unavailable = await f.api('projects/demo/templates')
  assert.equal(unavailable.status, 503)
  assert.equal(unavailable.value.code, 'PROJECT_UNAVAILABLE')
})

test('explicit template reference does not initialize a documentation repository or permit Agent binding', async t => {
  const f = await fixture(t)
  const input = { project: 'demo', version: 'v1', expected_digest: null }
  assert.equal((await f.api('bind-templates', { internal: true, token: 'agent', data: input })).status, 403)
  const bound = await f.api('bind-templates', { internal: true, token: 'l'.repeat(40), data: input })
  assert.equal(bound.status, 200, JSON.stringify(bound.value))
  assert.equal(bound.value.version, 'v1')
  assert.equal(existsSync(join(f.root, 'data/projects/demo/wiki')), false, 'Template reference does not create a Wiki worktree')
  assert.deepEqual(bound.value.modules, ['core'])
  assert.equal((await f.api('projects/demo/templates?template_id=sdd')).status, 200)
  const stale = await f.api('bind-templates', { internal: true, token: 'l'.repeat(40), data: input })
  assert.equal(stale.status, 409)
  assert.equal((await f.api('initialize', { data: { project: 'demo', name: 'Demo', product_version: 'v1', modules: [] } })).status, 409)
  const context = await f.api('context?project=demo')
  assert.equal(context.value.content_kind, 'repository_docs')
  assert.equal(context.value.capabilities.submit, false)
})


test('template read does not depend on sources and never follows the newest global version', async t => {
  const f = await fixture(t)
  f.defaults.bind('demo', ['core'])
  const state = f.defaults.state()
  f.defaults.save({ ...state.draft, name: 'A newer global definition' }, state.revision, 'Administrator')
  f.defaults.publish(f.defaults.state().revision, 'Administrator')
  f.failSources()
  const result = await f.api('projects/demo/templates?template_id=sdd')
  assert.equal(result.status, 200)
  assert.equal(result.value.binding.version, 'v1')
  assert.equal((await f.api('projects/demo')).value.code, 'PROJECT_SOURCES_UNAVAILABLE')
})

test('reference writes require an explicit published version and optimistic concurrency', async t => {
  const f = await fixture(t)
  const args = { internal: true, token: 'l'.repeat(40) }
  assert.equal((await f.api('bind-templates', { ...args, data: { project: 'demo', expected_digest: null } })).status, 422)
  assert.equal((await f.api('bind-templates', { ...args, data: { project: 'demo', version: 'unpublished', expected_digest: null } })).status, 409)
  assert.equal(f.defaults.binding('demo'), null)
  const bound = await f.api('bind-templates', { ...args, data: { project: 'demo', version: 'v1', expected_digest: null } })
  assert.equal(bound.status, 200)
  const rules = (await f.api('projects/demo/templates?template_id=sdd')).value
  const template = rules.templates[0]
  const check = await f.api('check-document', { data: { project: 'demo', template_id: 'sdd', document: template.example, phase: 'draft', target_path: 'doc/50-designs/example.md' } })
  assert.equal(check.status, 404)
  assert.deepEqual(checkCandidate(rules, { project: 'demo', template_id: 'sdd', document: template.example, target_path: 'doc/50-designs/example.md' }).errors, [])
})
