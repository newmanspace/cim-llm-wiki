import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, cpSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { Readable } from 'node:stream'
import { createDocumentUploads } from '../../wiki-service/document-uploads.mjs'
import { collectLocalPackage } from '../local-package.mjs'
import { packageDigest, resourcePath, documentResources } from '../document-package.mjs'
import { createDefaultsStore } from '../document-defaults.mjs'
import { createKnowledgeServer } from '../../wiki-service/server.mjs'
import { transferClient } from '../../../.agents/skills/cim-wiki/scripts/file-transfer.mjs'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0u8AAAAASUVORK5CYII=', 'base64')
function directory(t) { const root = mkdtempSync(join(tmpdir(), 'document-package-')); t.after(() => rmSync(root, { recursive: true, force: true })); return root }
test('local package follows Markdown dependencies including nested links and ignores examples', t => {
  const root = directory(t)
  mkdirSync(join(root, 'doc')); mkdirSync(join(root, 'assets'))
  writeFileSync(join(root, 'doc/main.md'), '# Main\n![流程图][图]\n\n[图]: ../assets/流程%20图.png\n\n[子页](child.md)\n[网页](https://example.test)\n```md\n![example](missing.png)\n```')
  writeFileSync(join(root, 'doc/child.md'), '[返回](main.md)\n![远程](https://example.test/image.png)')
  writeFileSync(join(root, 'assets/流程 图.png'), png)
  const pack = collectLocalPackage(root, 'doc/main.md')
  assert.equal(pack.files.length, 3); assert.equal(pack.warnings[0].rule_id, 'remote_image_unarchived')
  assert.equal(pack.package_sha256, packageDigest({ ...pack, files: [...pack.files].reverse() }))
  assert.throws(() => resourcePath('document.md', '../escape.pdf'), /path/)
  assert.throws(() => documentResources('<img src="image.png">', 'document.md'), /HTML resource/)
  assert.equal(documentResources('```html\n<img src="example.png">\n```', 'document.md').resources.length, 0)
  writeFileSync(join(root, 'assets/流程 图.png'), Buffer.concat([png, Buffer.from('changed')]))
  assert.notEqual(collectLocalPackage(root, 'doc/main.md').package_sha256, pack.package_sha256)
  symlinkSync(join(root, 'assets/流程 图.png'), join(root, 'assets/link.png'))
  writeFileSync(join(root, 'doc/main.md'), '![x](../assets/link.png)')
  assert.throws(() => collectLocalPackage(root, 'doc/main.md'), /Symbolic/)
})
test('uploads are project isolated, immutable, bounded, and packages reject missing resources', async t => {
  const root = directory(t), store = createDocumentUploads({ projectRoot: root, roots: {} })
  const image = await store.upload('demo', '流程 图.png', Readable.from([png.subarray(0, 10), png.subarray(10)]))
  assert.deepEqual(readFileSync(store.file('demo', image.uri).path), png)
  assert.throws(() => store.file('other', image.uri), /not found/)
  assert.throws(() => store.put('demo', 'fake.png', Buffer.from('<html>')), /signature/)
  assert.throws(() => store.put('demo', '../escape.md', Buffer.from('x')), /filename/)
  const md = store.put('demo', 'main.md', Buffer.from('![图](assets/image.png)'))
  assert.throws(() => store.seal('demo', { entry: 'main.md', files: [{ path: 'main.md', uri: md.uri, sha256: md.sha256 }] }), /missing/)
  const files = [{ path: 'main.md', uri: md.uri, sha256: md.sha256 }, { path: 'assets/image.png', uri: image.uri, sha256: image.sha256 }]
  const pack = store.seal('demo', { entry: 'main.md', files })
  assert.equal(store.seal('demo', { entry: 'main.md', files: files.toReversed() }).uri, pack.uri)
  assert.throws(() => store.seal('demo', { entry: 'main.md', files: [...files, { ...files[1], path: 'ASSETS/image.png' }] }), /case-conflicting/)
  writeFileSync(store.file('demo', image.uri).path, Buffer.from('tampered'))
  assert.throws(() => store.getPackage('demo', pack.uri), /changed/)
})
test('remote transfer converts, downloads and registers Markdown packages without shared roots', async t => {
  const root = directory(t), defaults = createDefaultsStore(root)
  defaults.publish(0, 'Administrator'); defaults.bind('demo', []); defaults.bind('other', [])
  const server = createKnowledgeServer({ projectRoot: root, roots: {}, token: 'agent', projectWikis: null, logWriter: () => {}, parser: async () => ({ md: '# Parsed\n\n<!-- image -->', images: [{ ext: 'png', data: png.toString('base64') }] }) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close() })
  const base = `http://127.0.0.1:${server.address().port}`, client = transferClient(base, 'agent')
  writeFileSync(join(root, 'original.txt'), 'original')
  writeFileSync(join(root, 'large.txt'), Buffer.alloc(9 * 1024 * 1024, 'x'))
  assert.equal((await client.upload('demo', join(root, 'large.txt'))).size, 9 * 1024 * 1024, 'Binary uploads bypass the JSON-only 8 MiB limit')
  const original = await client.upload('demo', join(root, 'original.txt'))
  assert.equal((await client.upload('demo', join(root, 'original.txt'))).uri, original.uri)
  const converted = await (await client.request('convert', { project: 'demo', system: 'CIM', version: 'v1', category: 'design', source: original.uri })).json()
  assert.match(converted.markdown, /document_assets\/img-001.png/); assert.equal(converted.files.length, 2)
  const destination = join(root, 'download')
  await client.downloadPackage('demo', converted, destination)
  assert.deepEqual(readFileSync(join(destination, 'document_assets/img-001.png')), png)
  await assert.rejects(client.downloadPackage('demo', converted, destination), /already exists/)
  const pack = await client.uploadPackage('demo', destination, 'document.md')
  assert.equal(pack.package_sha256, converted.package_sha256)
  const registered = await (await client.request('register', { project: 'demo', system: 'CIM', version: 'v1', category: 'design', source: pack.uri })).json()
  assert.equal(registered.parsed_uri, pack.uri)
  const otherPack = await client.uploadPackage('other', destination, 'document.md')
  assert.equal(otherPack.uri, pack.uri)
  const otherRegistered = await (await client.request('register', { project: 'other', system: 'CIM', version: 'v1', category: 'design', source: otherPack.uri })).json()
  assert.equal(otherRegistered.document.project, 'other')
  const selected = await (await client.request('document?' + new URLSearchParams({ project: 'other', source: otherPack.uri }))).json()
  assert.equal(selected.document.project, 'other')
  await assert.rejects(client.request('document?' + new URLSearchParams({ project: 'demo', source: pack.uri })), /multiple sources/)
  const exact = await (await client.request('document?' + new URLSearchParams({ project: 'demo', source: pack.uri, id: registered.document.doc_id }))).json()
  assert.equal(exact.document.doc_id, registered.document.doc_id)
  const skill = join(root, 'installed-skill')
  cpSync(resolve('.agents/skills/cim-wiki'), skill, { recursive: true })
  writeFileSync(join(root, 'convert.json'), JSON.stringify({ project: 'demo', system: 'CIM', version: 'v1', category: 'design' }))
  const cli = await promisify(execFile)(process.execPath, [join(skill, 'scripts/client.mjs'), 'convert', '--json-file', join(root, 'convert.json'), '--file', join(root, 'original.txt'), '--download-dir', join(root, 'cli-download'), '--output', join(root, 'cli-response.json')], { cwd: root, env: { ...process.env, CIM_WIKI_URL: base, CIM_WIKI_TOKEN: 'agent' } })
  assert.equal(JSON.parse(readFileSync(join(root, 'cli-response.json'), 'utf8')).files.length, 2)
  assert.equal(JSON.parse(cli.stdout).http_status, 200)
  assert.ok(readdirSync(join(root, 'cli-response.json.receipts')).length > 0)
  assert.deepEqual(readFileSync(join(root, 'cli-download/document_assets/img-001.png')), png)
  const unauthorized = await fetch(base + '/api/v2/knowledge/uploads/content?' + new URLSearchParams({ project: 'demo', uri: original.uri }))
  assert.equal(unauthorized.status, 401)
  const download = await client.request('uploads/content?' + new URLSearchParams({ project: 'demo', uri: original.uri }))
  assert.equal(download.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(download.headers.get('content-type'), 'application/octet-stream')
})

test('interrupted and oversized uploads do not create completed files; cleanup retains referenced objects', async t => {
  const root = directory(t), old = process.env.CIM_WIKI_UPLOAD_MAX_BYTES
  process.env.CIM_WIKI_UPLOAD_MAX_BYTES = '8'
  const store = createDocumentUploads({ projectRoot: root, roots: {} })
  if (old === undefined) delete process.env.CIM_WIKI_UPLOAD_MAX_BYTES
  else process.env.CIM_WIKI_UPLOAD_MAX_BYTES = old
  await assert.rejects(store.upload('demo', 'large.txt', Readable.from([Buffer.alloc(9)])), /limit/)
  async function * broken() { yield Buffer.from('one'); throw new Error('interrupted') }
  await assert.rejects(store.upload('demo', 'failed.txt', broken()), /interrupted/)
  const orphan = store.put('demo', 'orphan.txt', Buffer.from('orphan'))
  const retained = store.put('demo', 'main.md', Buffer.from('# Main'))
  const pack = store.seal('demo', { entry: 'main.md', files: [{ path: 'main.md', uri: retained.uri, sha256: retained.sha256 }] })
  assert.deepEqual(store.cleanup({ now: Date.now() + 8 * 24 * 60 * 60 * 1000 }), { removed: 1 })
  assert.throws(() => store.file('demo', orphan.uri), /not found/)
  assert.equal(store.getPackage('demo', pack.uri).uri, pack.uri)
})
