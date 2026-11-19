import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { randomUUID, createHash } from 'node:crypto'
import { createKnowledgeServer } from '../../wiki-service/server.mjs'
import { createDefaultsStore } from '../document-defaults.mjs'
import { checkCandidate } from '../local-ingest.mjs'

const ledgerURL = process.env.QUALITY_TEST_LEDGER_URL
const ledgerToken = process.env.QUALITY_TEST_LEDGER_TOKEN
const reviewerToken = process.env.QUALITY_TEST_REVIEW_TOKEN

test('submitted documents are immediately listed and previewable without freeze, scores or Wiki compilation', async t => {
  const root = mkdtempSync(join(tmpdir(), 'document-submit-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const defaults = createDefaultsStore(root)
  defaults.publish(0, 'Administrator'); defaults.bind('demo', [])
  const sha = text => createHash('sha256').update(text).digest('hex')
  const save = (path, text) => writeFileSync(join(root, path), text)
  save('source.md', '# Source\n\nSource facts.')
  save('info.xml', '<info><entry revision="42"><repository><uuid>repo</uuid></repository></entry></info>')
  const server = createKnowledgeServer({ projectRoot: root, projectWikis: null, roots: { team: root }, token: 'agent', ledgerURL, ledgerToken,
    reviewerTokens: { Reviewer: reviewerToken }, logWriter: () => {} })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close() })
  const base = `http://127.0.0.1:${server.address().port}`
  async function api(path, data, token = 'agent', key = randomUUID()) {
    const response = await fetch(base + '/api/v2/knowledge/' + path, {
      method: data === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: data === undefined ? undefined : JSON.stringify(data),
    })
    return { status: response.status, value: await response.json() }
  }
  async function ok(path, data, token, key) {
    const r = await api(path, data, token, key); assert.equal(r.status, 200, JSON.stringify(r.value)); return r.value.data ?? r.value
  }
  const setup = await fetch(ledgerURL + '/setup/projects/demo/data-sources', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ name: 'Docs', type: 'svn', url: 'https://example.test/repo', revision_selector: 'HEAD' }) })
  assert.equal(setup.status, 200)
  const source = (await setup.json()).data
  assert.equal((await api('ingest-runs', { project: 'demo', source_type: 'local_file', recipe_version: 'test-v1' })).status, 409, 'Local files cannot bypass configured repository evidence')
  const run = await ok('ingest-runs', { project: 'demo', source_id: source.id, source_config_id: source.config_id, operative_revision: '42', repository_uuid: 'repo', recipe_version: 'test-v1' })
  const original = await ok('source-observations', { project: 'demo', run_id: run.id, repository_path: 'source.md', original_uri: 'shared://team/source.md', original_sha256: sha('# Source\n\nSource facts.'), svn_info_uri: 'shared://team/info.xml' })
  await ok('convert', { project: 'demo', system: 'CIM', version: 'v1', category: 'design', source: 'shared://team/source.md', parsed: 'shared://team/parsed.md' })
  const rules = await ok('projects/demo/templates?template_id=sdd')
  const document = rules.templates[0].example
  save('candidate.md', document)
  const report = checkCandidate(rules, { project: 'demo', template_id: 'sdd', target_path: 'doc/50-designs/design.md', document, fidelity: 'checked' })
  assert.deepEqual(report.errors, [])
  assert.ok(report.warnings.some(w => w.rule_id === 'document_identity_pending'))
  assert.equal((await api('check-document', { project: 'demo', document })).status, 404)
  const input = { project: 'demo', run_id: run.id, logical_key: 'design', template_id: 'sdd', target_path: report.target_path,
    content_uri: 'shared://team/candidate.md', parsed_uri: 'shared://team/parsed.md', recipe_version: 'test-v1', local_report: report, source_links: [{ source_version_id: original.id }] }
  const key = randomUUID()
  const submitted = await ok('document-submit', input, undefined, key)
  assert.equal(submitted.workflow_state, 'submitted'); assert.equal(submitted.qscore, null)
  assert.equal((await ok('document-submit', input, undefined, key)).id, submitted.id)
  const management = await fetch(ledgerURL + '/management/projects/demo/document-quality/document-results')
  assert.equal(management.status, 200)
  assert.ok((await management.json()).data.items.some(row => row.id === submitted.id && row.workflow_state === 'submitted'))
  assert.equal((await ok(`document-result-preview?project=demo&id=${submitted.id}`)).markdown, document)
  const internalPreview = await fetch(base + `/internal/document-result-preview?project=demo&id=${submitted.id}`, { headers: { Authorization: 'Bearer ' + ledgerToken } })
  assert.equal(internalPreview.status, 200)
  assert.equal((await api(`document-result-preview?project=other&id=${submitted.id}`)).status, 404)
  assert.equal((await api('document-review-requests', { project: 'demo', artifact_id: submitted.id })).status, 409)
  save('parsed.md', '# Changed parser output')
  assert.equal((await api('document-freeze', { project: 'demo', artifact_id: submitted.id, expected_revision: submitted.revision })).status, 409)
  // Preview keeps the submitted snapshot even when an external file has drifted.
  assert.equal((await ok(`document-result-preview?project=demo&id=${submitted.id}`)).markdown, document)
  save('parsed.md', '# Source\n\nSource facts.')
  const frozen = await ok('document-freeze', { project: 'demo', artifact_id: submitted.id, expected_revision: submitted.revision })
  assert.equal(frozen.workflow_state, 'frozen')
  assert.equal((await ok('document-submit', input)).workflow_state, 'frozen', 'Identical resubmission returns the current durable state')
  const task = await ok('document-review-requests', { project: 'demo', artifact_id: submitted.id })
  assert.equal(task.approval_mode, 'manual'); assert.equal(task.evaluation_id, undefined)
  const decision = { project: 'demo', task_id: task.id, expected_revision: task.revision, decision: 'approve', note: 'Source and candidate compared' }
  assert.equal((await api('document-review-decisions', decision)).status, 403)
  await ok('document-review-decisions', decision, reviewerToken)
  const tasks = (await ok('document-review-tasks?project=demo')).items
  assert.equal(tasks.find(row => row.id === task.id).status, 'approved')
  assert.equal((await ok('publications?project=demo')).items.length, 0)

  // Structural content quality belongs to local ingest, not the server.
  save('invalid.md', '# Missing template sections')
  assert.ok(checkCandidate(rules, { project: 'demo', template_id: 'sdd', document: '# Missing template sections' }).errors.length)
  const structural = await ok('document-submit', { ...input, logical_key: 'local-errors', content_uri: 'shared://team/invalid.md', local_report: undefined })
  assert.equal(structural.workflow_state, 'submitted')
  assert.equal((await api('document-submit', { ...input, target_path: 'doc/../escape.md' })).status, 422)
  assert.equal((await api('document-submit', { ...input, qscore: { total: 1 } })).status, 422)
  assert.equal((await api('document-submit', { ...input, local_report: { ...report, content_sha256: '0'.repeat(64) } })).status, 409)
  const draft = await ok('document-drafts', { ...input, logical_key: 'preview-draft' })
  assert.equal(draft.workflow_state, 'draft')
  assert.equal((await ok(`document-result-preview?project=demo&id=${draft.id}`)).markdown, document)
})
