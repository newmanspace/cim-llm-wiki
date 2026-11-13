import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createKnowledgeServer } from '../../wiki-service/server.mjs'

test('administrative settings require independent service authentication; contracts bind and survive restart', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'global-templates-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const ledger = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ data: { items: [], next_cursor: null } }))
  })
  ledger.listen(0, '127.0.0.1')
  await once(ledger, 'listening')
  t.after(
    () =>
      new Promise((resolve) => {
        ledger.closeAllConnections()
        ledger.close(resolve)
      }),
  )
  const ledgerURL = `http://127.0.0.1:${ledger.address().port}`
  const ledgerToken = 'service-' + 's'.repeat(40)
  const server = createKnowledgeServer({
    projectRoot: root,
    wikiRoot: join(root, 'data/wiki'),
    roots: { team: root },
    token: 'agent-token',
    ledgerToken,
    ledgerURL,
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections()
        server.close(resolve)
      }),
  )
  const base = `http://127.0.0.1:${server.address().port}`
  const call = async (path, data, token = ledgerToken) => {
    const response = await fetch(base + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        'X-Settings-Actor': 'Administrator',
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    })
    return { status: response.status, value: await response.json() }
  }
  const endpoint = '/internal/document-defaults'
  assert.equal(
    (await call(endpoint + '/publish', { expected_revision: 0 }, 'agent-token'))
      .status,
    403,
  )
  const state = (await call(endpoint)).value
  assert.equal(
    (await call(endpoint + '/check', { definition: state.draft })).value.errors
      .length,
    0,
  )
  assert.equal(
    (await call(endpoint + '/publish', { expected_revision: 0 })).status,
    200,
  )
  const bound = await call(endpoint + '/bind', {
    project: 'demo',
    name: 'Demo',
    product_version: 'v1',
    modules: ['pipeline'],
  })
  assert.equal(bound.status, 200, JSON.stringify(bound.value))
  assert.equal(bound.value.version, 'v1')
  const context = await call(
    '/api/v2/knowledge/context?project=demo',
    undefined,
    'agent-token',
  )
  assert.equal(context.status, 200, JSON.stringify(context.value))
  assert.equal(context.value.document_defaults.version, 'v1')
  assert.equal(
    context.value.directory.directories.length,
    state.draft.directories.length,
  )
  const bad = await call(endpoint + '/check', {
    project: 'demo',
    template_id: 'glossary',
    document: '# Missing',
  })
  assert.ok(bad.value.errors.some((e) => e.rule_id === 'section_required'))
  const missing = await call(
    '/api/v2/knowledge/context?project=unbound',
    undefined,
    'agent-token',
  )
  assert.equal(missing.status, 409)
  assert.equal(
    (
      await call(endpoint + '/save', {
        expected_revision: 0,
        definition: state.draft,
      })
    ).status,
    409,
  )
  const unknown = structuredClone(state.draft)
  unknown.templates[0].contract.ignored_rule = true
  assert.equal(
    (
      await call(endpoint + '/save', {
        expected_revision: 1,
        definition: unknown,
      })
    ).status,
    422,
  )
  assert.equal(
    (
      await call(
        '/api/v2/knowledge/initialize',
        { project: 'old', name: 'Old', version: 'v1', modules: ['pipeline'] },
        'agent-token',
      )
    ).status,
    400,
  )
  const rendered = await call(
    '/api/v2/knowledge/render-document',
    {
      project: 'demo',
      template_id: 'urd',
      values: {
        document_id: 'URD-DEMO',
        document_name: 'Demo requirements',
        document_version: 'v1',
        product: 'Demo',
        author: 'Operator',
        reviewer: '待指定',
        created_at: '2026-11-13T00:00:00Z',
        updated_at: '2026-11-13T00:00:00Z',
        scope: 'Demo project',
      },
    },
    'agent-token',
  )
  assert.equal(rendered.status, 200, JSON.stringify(rendered.value))
  assert.ok(rendered.value.document.includes('URD-DEMO'))
  const next = structuredClone(state.draft)
  next.name = 'Next defaults'
  assert.equal(
    (await call(endpoint + '/save', { expected_revision: 1, definition: next }))
      .status,
    200,
  )
  assert.equal(
    (await call(endpoint + '/publish', { expected_revision: 2 })).status,
    200,
  )
  const preview = (
    await call(endpoint + '/preview', { project: 'demo', overrides: {} })
  ).value
  assert.equal(preview.from_version, 'v1')
  assert.equal(preview.to_version, 'v2')
  const upgrade = {
    project: 'demo',
    name: 'Demo',
    product_version: 'v1',
    modules: ['pipeline'],
    upgrade: true,
    version: 'v2',
    expected_digest: 'stale',
  }
  assert.equal((await call(endpoint + '/bind', upgrade)).status, 409)
  assert.equal(
    (
      await call(endpoint + '/bind', {
        ...upgrade,
        expected_digest: preview.from_digest,
      })
    ).status,
    200,
  )
  assert.equal((await call(endpoint)).value.audit.at(-1).actor, 'Administrator')
})

test('failed project initialization restores configuration, catalog and contract binding', async (t) => {
  const fs = await import('node:fs'),
    { syncBuiltinESMExports } = await import('node:module')
  const { createDocumentDefaults } =
    await import('../../wiki-service/document-defaults.mjs')
  const root = mkdtempSync(join(tmpdir(), 'defaults-rollback-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const defaults = createDocumentDefaults(root, join(root, 'data/wiki'))
  defaults.store.publish(0, 'Administrator')
  const realRename = fs.default.renameSync
  let failed = false
  t.mock.method(fs.default, 'renameSync', (source, dest) => {
    if (String(dest).endsWith('document-contract.json')) {
      failed = true
      throw new Error('Simulated disk failure')
    }
    return realRename(source, dest)
  })
  syncBuiltinESMExports()
  try {
    assert.throws(
      () =>
        defaults.initialize({
          project: 'demo',
          name: 'Demo',
          product_version: 'v1',
          modules: ['pipeline'],
        }),
      /Simulated/,
    )
    assert.equal(failed, true)
    assert.equal(
      fs.existsSync(join(root, 'data/wiki/demo/directory.json')),
      false,
    )
    assert.throws(() => defaults.store.effective('demo'), /must bind/)
  } finally {
    t.mock.restoreAll()
    syncBuiltinESMExports()
  }
})
