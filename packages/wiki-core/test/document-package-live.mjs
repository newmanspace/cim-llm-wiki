import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { createKnowledgeServer } from '../../wiki-service/server.mjs'
import { createDefaultsStore } from '../document-defaults.mjs'
import { checkCandidate } from '../local-ingest.mjs'
import { collectLocalPackage } from '../local-package.mjs'
import { transferClient } from '../../../.agents/skills/cim-wiki/scripts/file-transfer.mjs'
const ledgerURL = process.env.QUALITY_TEST_LEDGER_URL, ledgerToken = process.env.QUALITY_TEST_LEDGER_TOKEN
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0u8AAAAASUVORK5CYII=', 'base64')
test('remote package submit lists attachments immediately and freezes immutable versions', async t => {
  const root = mkdtempSync(join(tmpdir(), 'remote-package-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const defaults = createDefaultsStore(root)
  defaults.publish(0, 'Administrator'); defaults.bind('other', [])
  const server = createKnowledgeServer({ projectRoot: root, roots: {}, projectWikis: null, token: 'agent', ledgerURL, ledgerToken, logWriter: () => {} })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close() })
  const base = `http://127.0.0.1:${server.address().port}`, client = transferClient(base, 'agent')
  const call = async (path, data) => { const value = await (await client.request(path, data)).json(); return value.data ?? value }
  const rules = await call('projects/other/templates?template_id=sdd')
  const local = join(root, 'candidate'); mkdirSync(local); mkdirSync(join(local, 'assets'))
  const document = rules.templates[0].example + '\n\n![流程图](assets/流程%20图.png)\n\n[附件](附件.txt)\n'
  writeFileSync(join(local, 'document.md'), document); writeFileSync(join(local, 'assets/流程 图.png'), png); writeFileSync(join(local, '附件.txt'), 'attachment bytes')
  const pack = await client.uploadPackage('other', local, 'document.md')
  const registered = await call('register', { project: 'other', source: pack.uri, system: 'CIM', version: 'v1', category: 'design' })
  const run = await call('ingest-runs', { project: 'other', source_type: 'local_file', recipe_version: 'remote-test' })
  const observation = await call('source-observations', { project: 'other', run_id: run.id, repository_path: 'document.md', original_uri: pack.uri, original_sha256: registered.document.original_sha256 })
  assert.equal(observation.source_type, 'local_file')
  const report = { ...checkCandidate(rules, { project: 'other', template_id: 'sdd', target_path: 'doc/50-designs/remote.md', document }), package_sha256: pack.package_sha256 }
  assert.deepEqual(report.errors, [])
  const input = { project: 'other', run_id: run.id, content_uri: pack.uri, parsed_uri: registered.parsed_uri, source_links: [{ source_version_id: observation.id }], logical_key: 'remote', template_id: 'sdd', target_path: report.target_path, local_report: report, recipe_version: 'remote-test' }
  const submitted = await call('document-submit', input)
  assert.equal(submitted.workflow_state, 'submitted'); assert.equal(submitted.package_sha256, pack.package_sha256)
  const listing = await call('document-results?project=other')
  assert.ok(listing.items.some(row => row.id === submitted.id))
  const preview = await call(`document-result-preview?project=other&id=${submitted.id}`)
  assert.equal(preview.candidate_package.files.length, 3)
  const resourceURL = base + '/internal/document-result-resource?' + new URLSearchParams({ project: 'other', id: submitted.id, scope: 'candidate', path: 'assets/流程 图.png' })
  const image = await fetch(resourceURL, { headers: { Authorization: 'Bearer ' + ledgerToken } })
  assert.equal(image.status, 200); assert.equal(image.headers.get('x-content-type-options'), 'nosniff'); assert.deepEqual(Buffer.from(await image.arrayBuffer()), png)
  const cross = await fetch(resourceURL.replace('project=other', 'project=demo'), { headers: { Authorization: 'Bearer ' + ledgerToken } })
  assert.equal(cross.status, 404)
  const frozen = await call('document-freeze', { project: 'other', artifact_id: submitted.id, expected_revision: submitted.revision })
  assert.equal(frozen.workflow_state, 'frozen')
  const task = await call('document-review-requests', { project: 'other', artifact_id: submitted.id })
  assert.equal(task.artifact_digest, pack.package_sha256)
  const reviewer = transferClient(base, process.env.QUALITY_TEST_REVIEW_TOKEN)
  const decision = await (await reviewer.request('document-review-decisions', { project: 'other', task_id: task.id, expected_revision: task.revision, decision: 'approve', note: 'Original and attachments checked' })).json()
  assert.equal(decision.data.artifact_digest, pack.package_sha256)
  writeFileSync(join(local, 'assets/流程 图.png'), Buffer.concat([png, Buffer.from('new image')]))
  await assert.rejects(client.uploadPackage('other', local, 'document.md', pack.package_sha256), /rerun local ingest/)
  const changed = collectLocalPackage(local, 'document.md')
  assert.notEqual(changed.package_sha256, pack.package_sha256)
  const next = await client.uploadPackage('other', local, 'document.md')
  await assert.rejects(call('document-submit', { ...input, content_uri: next.uri }), /attachments/)
  const version2 = await call('document-submit', { ...input, content_uri: next.uri, local_report: { ...report, package_sha256: next.package_sha256 } })
  assert.equal(version2.version, 2); assert.equal(version2.content_sha256, submitted.content_sha256); assert.notEqual(version2.id, submitted.id)
  assert.equal((await call(`document-result-preview?project=other&id=${submitted.id}`)).candidate_package.package_sha256, pack.package_sha256)
  const downloaded = join(root, 'downloaded')
  await client.downloadPackage('other', pack, downloaded)
  assert.deepEqual(readFileSync(join(downloaded, 'assets/流程 图.png')), png)
})
