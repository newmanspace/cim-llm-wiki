import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createDefaultsStore } from '../document-defaults.mjs'
import { createDocumentQuality } from '../../wiki-service/document-quality.mjs'

test('wrong routing blocks registration, reassessment, preview and export before side effects', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'routing-service-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const store = createDefaultsStore(root)
  store.publish(0, 'Test Administrator')
  store.bind('demo', [])
  const requests = []
  const artifact = { id: 'legacy-wrong', template_id: 'sdd', target_path: 'doc/90-guides/example.md', document_contract_digest: store.effective('demo').digest }
  const ledger = createServer((req, res) => {
    requests.push(req.method)
    const resource = req.url.split('?')[0].split('/').at(-1)
    const items = resource === 'document-results' ? [artifact] : resource === 'document-directories'
      ? [{ path: 'doc/50-designs/nested', node_types: ['requirement'] }] : []
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ data: { items, next_cursor: null } }))
  })
  ledger.listen(0, '127.0.0.1')
  await once(ledger, 'listening')
  t.after(() => new Promise((resolve) => { ledger.closeAllConnections(); ledger.close(resolve) }))
  const quality = createDocumentQuality({
    projectRoot: root, wikiRoot: join(root, 'wiki'), roots: {}, organizedRoot: join(root, 'organized'),
    ledgerURL: `http://127.0.0.1:${ledger.address().port}`, ledgerToken: 'fixture-token',
    registeredDocument: () => { throw Error('Routing must reject before source or snapshot access') },
  })
  const rejected = (error) => error.status === 422 && error.message.includes('document_directory_mismatch')
  await assert.rejects(quality.mutate('artifacts', { project: 'demo', template_id: 'sdd', target_path: artifact.target_path }, 'register-wrong'), rejected)
  await assert.rejects(quality.mutate('artifacts', { project: 'demo', template_id: 'sdd', target_path: 'doc/../example.md' }, 'register-invalid'),
    (error) => error.status === 422 && error.message.includes('document_target_invalid'))
  assert.deepEqual(requests, [])
  await assert.rejects(quality.mutate('document-evaluations', { project: 'demo', artifact_id: artifact.id }, 'evaluate-wrong'), rejected)
  await assert.rejects(quality.preview('demo', artifact.id), rejected)
  await assert.rejects(quality.publish({ project: 'demo', artifact_id: artifact.id, evaluation_id: 'unused' }, 'publish-wrong'), rejected)
  assert.ok(requests.every((method) => method === 'GET'))
  assert.equal(existsSync(join(root, 'organized')), false)
  assert.equal(existsSync(join(root, 'data/document-content')), false)
  const context = await quality.context('demo')
  assert.deepEqual(context.document_directories[0].node_types, ['design', 'module', 'data_dictionary'])
})
