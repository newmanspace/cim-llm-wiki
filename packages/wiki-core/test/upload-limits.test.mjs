import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { Readable } from 'node:stream'
import { createDefaultsStore } from '../document-defaults.mjs'
import { documentLimits } from '../package-limits.mjs'
import { createDocumentUploads } from '../../wiki-service/document-uploads.mjs'
import { createKnowledgeServer } from '../../wiki-service/server.mjs'
import { transferClient } from '../../../.agents/skills/cim-wiki/scripts/file-transfer.mjs'
import { collectLocalPackage } from '../local-package.mjs'

beforeEach(t => {
  const previous = ['CIM_WIKI_UPLOAD_MAX_BYTES', 'CIM_WIKI_PACKAGE_MAX_BYTES'].map(name => [name, process.env[name]])
  process.env.CIM_WIKI_UPLOAD_MAX_BYTES = '64'
  process.env.CIM_WIKI_PACKAGE_MAX_BYTES = '96'
  t.after(() => { for (const [name, value] of previous) { if (value === undefined) delete process.env[name]; else process.env[name] = value } })
})
function directory(t) {
  const root = mkdtempSync(join(tmpdir(), 'upload-limits-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}
test('service requires explicit positive safe integer byte limits', () => {
  for (const name of ['CIM_WIKI_UPLOAD_MAX_BYTES', 'CIM_WIKI_PACKAGE_MAX_BYTES']) {
    const previous = process.env[name]
    for (const value of ['', '0', '-1', 'NaN', '1.5', '9007199254740992']) {
      process.env[name] = value
      assert.throws(documentLimits, new RegExp(name))
    }
    delete process.env[name]
    assert.throws(documentLimits, new RegExp(name))
    process.env[name] = previous
  }
  assert.deepEqual(documentLimits(), { file: 64, package: 96 })
})
test('service enforces exact streamed byte boundary and clears rejected uploads', async t => {
  const root = directory(t), store = createDocumentUploads({ projectRoot: root, roots: {} })
  for (const size of [63, 64]) {
    const receipt = await store.upload('demo', size + '.txt', Readable.from([Buffer.alloc(size, 'x')]))
    assert.equal(receipt.size, size)
  }
  await assert.rejects(store.upload('demo', 'large.txt', Readable.from([Buffer.alloc(32), Buffer.alloc(33)])), error => {
    assert.equal(error.status, 413)
    assert.equal(error.code, 'UPLOAD_SIZE_LIMIT_EXCEEDED')
    assert.deepEqual(error.diagnostics, [{ kind: 'file', limit_bytes: 64, received_bytes: 65 }])
    return true
  })
  assert.equal(readdirSync(join(root, 'data/document-uploads/demo')).filter(name => name.endsWith('.tmp')).length, 0)
})
test('client ignores local size configuration; server alone rejects files and package totals', async t => {
  const root = directory(t)
  const defaults = createDefaultsStore(root); defaults.publish(0, 'Administrator'); defaults.bind('demo', [])
  const server = createKnowledgeServer({ projectRoot: root, roots: {}, projectWikis: null, token: 'agent', logWriter: () => {} })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close() })
  // The service captured its configuration; local client environment must not matter.
  process.env.CIM_WIKI_UPLOAD_MAX_BYTES = 'invalid-client-value'
  process.env.CIM_WIKI_PACKAGE_MAX_BYTES = '1'
  const client = transferClient(`http://127.0.0.1:${server.address().port}`, 'agent')
  writeFileSync(join(root, 'document.md'), '[a](a.txt) [b](b.txt)')
  writeFileSync(join(root, 'a.txt'), Buffer.alloc(50, 'a'))
  writeFileSync(join(root, 'b.txt'), Buffer.alloc(50, 'b'))
  assert.equal(collectLocalPackage(root, 'document.md').files.length, 3)
  assert.equal((await client.upload('demo', join(root, 'a.txt'))).size, 50)
  await assert.rejects(client.uploadPackage('demo', root, 'document.md'), /HTTP 413.*UPLOAD_SIZE_LIMIT_EXCEEDED.*package/)
  writeFileSync(join(root, 'too-large.txt'), Buffer.alloc(65, 'x'))
  await assert.rejects(client.upload('demo', join(root, 'too-large.txt')), /HTTP 413.*UPLOAD_SIZE_LIMIT_EXCEEDED/)
})
test('client streams a 37 MiB file beyond old default and server retains original bytes', async t => {
  const root = directory(t)
  const defaults = createDefaultsStore(root); defaults.publish(0, 'Administrator'); defaults.bind('demo', [])
  process.env.CIM_WIKI_UPLOAD_MAX_BYTES = String(40 * 1024 * 1024)
  process.env.CIM_WIKI_PACKAGE_MAX_BYTES = String(40 * 1024 * 1024)
  const server = createKnowledgeServer({ projectRoot: root, roots: {}, projectWikis: null, token: 'agent', logWriter: () => {} })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close() })
  const client = transferClient(`http://127.0.0.1:${server.address().port}`, 'agent')
  const bytes = Buffer.alloc(37 * 1024 * 1024, 'x'), path = join(root, 'large.txt')
  writeFileSync(path, bytes)
  const receipt = await client.upload('demo', path)
  assert.equal(receipt.size, bytes.length)
  const stored = join(root, 'data/document-uploads/demo', receipt.uri.slice(11) + '.txt')
  assert.deepEqual(readFileSync(stored), bytes)
})


test('upload rejects multipart and missing or unsupported media types before storing bytes', async t => {
  const root = directory(t), defaults = createDefaultsStore(root)
  defaults.publish(0, 'Administrator'); defaults.bind('demo', [])
  const server = createKnowledgeServer({ projectRoot: root, roots: {}, projectWikis: null, token: 'agent', logWriter: () => {} })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close() })
  const url = `http://127.0.0.1:${server.address().port}/api/v2/knowledge/upload?project=demo&filename=document.md`
  const form = new FormData(); form.set('file', new Blob(['# Good']), 'document.md')
  const invalid = [{ body: form }, ...[undefined, 'text/markdown', 'application/json'].map(type => ({
    body: Buffer.from('# Good'), headers: type ? { 'Content-Type': type } : {},
  }))]
  for (const { body, headers } of invalid) {
    const response = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer agent', ...headers }, body })
    assert.equal(response.status, 415)
    assert.equal((await response.json()).code, 'UPLOAD_CONTENT_TYPE_UNSUPPORTED')
    assert.equal(existsSync(join(root, 'data/document-uploads')), false, 'Rejected requests must not create upload storage')
  }
  const response = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer agent', 'Content-Type': 'application/octet-stream' }, body: '# Good' })
  assert.equal(response.status, 200)
  const receipt = await response.json()
  assert.equal(receipt.size, Buffer.byteLength('# Good'))
  assert.equal(readFileSync(join(root, 'data/document-uploads/demo', receipt.uri.slice(11) + '.md'), 'utf8'), '# Good')
})
