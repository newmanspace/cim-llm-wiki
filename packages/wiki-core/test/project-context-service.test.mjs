import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { createDefaultsStore } from '../document-defaults.mjs'
import { createKnowledgeServer } from '../../wiki-service/server.mjs'

async function fixture(t, { enabled = true, bound = true, kind = 'strict_nodes' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'project-context-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const defaults = createDefaultsStore(root)
  defaults.publish(0, 'Administrator')
  if (bound) defaults.bind('demo', [])
  const source = join(root, 'data/projects/demo/wiki')
  mkdirSync(source, { recursive: true })
  mkdirSync(join(root, 'data/project-wiki'), { recursive: true })
  writeFileSync(join(root, 'data/project-wiki/demo.json'), JSON.stringify({ contentKind: kind, sourceDirectory: 'data/projects/demo/wiki' }))
  const failures = {}
  const sources = [{ id: '4', config_id: '6', type: 'svn', enabled: true }]
  const resources = {
    'data-sources': sources,
    'source-revisions': [{ id: '6', source_id: '4', url: 'https://example.test/docs', subpath: '', revision_selector: 'HEAD' }],
    'document-directories': [],
  }
  const ledger = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    const parts = new URL(req.url, 'http://localhost').pathname.split('/')
    const project = parts[4], resource = parts.at(-1)
    const status = project !== 'demo' ? 404 : failures[resource] || 200
    res.statusCode = status
    if (status !== 200) return res.end(JSON.stringify({ error: 'Ledger error' }))
    const data = resource === 'project' ? { id: project, name: 'Demo', repos: [], modules: [], docs: [] } : { items: resources[resource] || [], next_cursor: '' }
    res.end(JSON.stringify({ data }))
  })
  ledger.listen(0, '127.0.0.1')
  await once(ledger, 'listening')
  t.after(() => { ledger.closeAllConnections(); ledger.close() })
  const server = createKnowledgeServer({ projectRoot: root, token: 'agent', roots: { team: root }, ...(enabled ? { ledgerURL: `http://127.0.0.1:${ledger.address().port}`, ledgerToken: 'l'.repeat(40) } : {}) })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close() })
  async function api(path, data, token = 'agent') {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v2/knowledge/${path}`, { method: data === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) })
    return { status: response.status, value: await response.json() }
  }
  return { api, root, source, failures, sources, origin: `http://127.0.0.1:${server.address().port}` }
}

test('Project binding supplies delivery and directories without separate configuration files', async t => {
  const f = await fixture(t)
  const result = await f.api('context?project=demo')
  assert.equal(result.status, 200)
  assert.equal(result.value.data_sources[0].revision_selector, 'HEAD')
  assert.ok(result.value.document_defaults.definition.templates.some(t => t.id === 'glossary'))
  assert.equal(result.value.configuration_status.delivery_contract, 'ready')
  assert.equal(result.value.diagnostics.some(d => d.code === 'DELIVERY_CONTRACT_MISSING'), false)
  assert.equal(result.value.capabilities.submit, true)
  assert.equal(result.value.capabilities.compile, true)
  assert.deepEqual(result.value.delivery_contract.documents, result.value.document_defaults.definition.delivery)
  assert.deepEqual(result.value.directory.directories, result.value.document_defaults.definition.directories)
  assert.equal(result.value.capabilities.collect, true)
  assert.ok(result.value.diagnostics.filter(d => ['delivery_contract', 'directory'].includes(d.component)).every(d => !d.affected_operations.includes('collect')))
  assert.equal(result.value.capabilities.check_document, true)
  assert.deepEqual(result.value.repos, [])
  for (const resource of ['data-sources', 'source-revisions']) assert.equal((await f.api(resource + '?project=demo')).status, 200)
  const artifact = await f.api('artifacts', { project: 'demo' })
  assert.equal(artifact.status, 422)
  assert.doesNotMatch(artifact.value.error, /delivery contract is required/)
  const publication = await f.api('publish-document', { project: 'demo' })
  assert.equal(publication.status, 503)
  assert.doesNotMatch(publication.value.error, /delivery contract is required/)
  assert.equal((await f.api('context?project=demo', undefined, 'wrong')).status, 401)
  assert.equal((await f.api('context?project=other')).status, 404)
  assert.equal((await f.api('data-sources?project=other')).status, 404)
})

test('unbound templates and upstream failures have distinct states and never masquerade as empty sources', async t => {
  const f = await fixture(t, { bound: false })
  f.failures['data-sources'] = 503
  const result = await f.api('context?project=demo')
  assert.equal(result.status, 200)
  assert.equal(result.value.configuration_status.document_defaults, 'missing')
  assert.equal(result.value.configuration_status.data_sources, 'unavailable')
  assert.equal(result.value.data_sources, null)
  assert.deepEqual(result.value.document_directories, [])
  assert.equal(result.value.capabilities.check_document, false)
  delete f.failures['data-sources']
  assert.equal((await f.api('context?project=demo')).value.capabilities.collect, true)
  f.failures.project = 503
  assert.equal((await f.api('context?project=demo')).status, 503)
})

test('retired configuration files do not affect Project binding or repository documentation', async t => {
  const f = await fixture(t, { enabled: false })
  writeFileSync(join(f.source, 'document-contract.json'), '{')
  const result = await f.api('context?project=demo')
  assert.equal(result.status, 200)
  assert.equal(result.value.configuration_status.delivery_contract, 'ready')
  assert.equal(result.value.configuration_status.data_sources, 'disabled')
  assert.equal(result.value.data_sources, null)
  assert.equal((await f.api('context?project=unknown')).status, 404)
  const repo = await fixture(t, { kind: 'repository_docs' })
  const repositoryContext = await repo.api('context?project=demo')
  assert.equal(repositoryContext.status, 200)
  assert.equal(repositoryContext.value.configuration_status.delivery_contract, 'not_applicable')
  assert.equal(repositoryContext.value.capabilities.submit, false)
  assert.equal(repositoryContext.value.capabilities.collect, true)
  assert.equal((await repo.api('ingest-runs', { project: 'demo' })).status, 422)
})

test('collection client starts from zero documents without a delivery contract, but rejects unavailable sources', async t => {
  const f = await fixture(t)
  const client = new URL('../../../.agents/skills/cim-wiki/scripts/source-client.mjs', import.meta.url).href
  const script = `import { runSourceCLI } from ${JSON.stringify(client)}; process.argv = ['node', 'source', '--project', 'demo', '--source-id', '4']; await runSourceCLI(() => { throw new Error('COLLECTOR_WAS_CALLED') }, 'svn')`
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, CIM_WIKI_URL: f.origin, CIM_WIKI_TOKEN: 'agent' } })
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk })
  const [code] = await once(child, 'exit')
  assert.notEqual(code, 0)
  assert.match(stderr, /COLLECTOR_WAS_CALLED/)
  assert.doesNotMatch(stderr, /DELIVERY_CONTRACT_MISSING/)
  f.failures['data-sources'] = 503
  assert.equal((await f.api('context?project=demo')).value.capabilities.collect, false)
})

test('complete configuration enables collection only for enabled sources; binding drift remains visible', async t => {
  const f = await fixture(t)
  let result = await f.api('context?project=demo')
  assert.equal(result.value.configuration_status.delivery_contract, 'ready')
  assert.equal(result.value.capabilities.collect, true)
  assert.equal(result.value.capabilities.submit, true)
  writeFileSync(join(f.source, 'directory.json'), '{}')
  result = await f.api('context?project=demo')
  assert.equal(result.value.configuration_status.directory, 'ready')
  assert.equal(result.value.capabilities.submit, true)
  assert.equal(result.value.diagnostics.some(d => d.component === 'directory'), false)
  assert.equal((await f.api('ingest-runs', { project: 'demo' })).status, 422)
  rmSync(join(f.source, 'directory.json'))
  f.sources[0].enabled = false
  result = await f.api('context?project=demo')
  assert.equal(result.value.configuration_status.data_sources, 'ready')
  assert.equal(result.value.data_sources[0].enabled, false)
  assert.equal(result.value.capabilities.collect, false)
  f.sources.length = 0
  result = await f.api('context?project=demo')
  assert.deepEqual(result.value.data_sources, [])
  assert.equal(result.value.capabilities.collect, false)
  const statePath = join(f.root, 'data/document-defaults/state.json')
  const state = JSON.parse(readFileSync(statePath, 'utf8'))
  state.bindings.demo.digest = 'drift'
  writeFileSync(statePath, JSON.stringify(state))
  result = await f.api('context?project=demo')
  assert.equal(result.value.configuration_status.document_defaults, 'invalid')
  assert.equal(result.value.template_binding.version, 'v1')
  assert.equal(result.value.document_defaults, null)
  assert.equal(result.value.capabilities.submit, false)
  assert.equal((await f.api('data-sources?project=demo')).status, 200)
  assert.equal((await f.api('ingest-runs', { project: 'demo' })).status, 422)
})


test('retired files cannot authorize submission without a Project binding', async t => {
  const f = await fixture(t, { bound: false })
  writeFileSync(join(f.source, 'document-contract.json'), JSON.stringify({ schema_version: '1.0', project: 'demo', documents: [{ id: 'req', type: 'requirement', scope: 'project', min: 0 }] }))
  writeFileSync(join(f.source, 'directory.json'), '{}')
  const context = (await f.api('context?project=demo')).value
  assert.equal(context.configuration_status.document_defaults, 'missing')
  assert.equal(context.configuration_status.delivery_contract, 'missing')
  assert.equal(context.capabilities.submit, false)
  writeFileSync(join(f.root, 'bundle.json'), JSON.stringify({ project: 'demo', bundle_id: 'CR-20261118-0001', nodes: [] }))
  const submitted = await f.api('bundles', { uri: 'shared://team/bundle.json' })
  assert.equal(submitted.status, 409)
  assert.match(submitted.value.error, /must bind a published/)
})
