import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'skill-output-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const installed = join(root, 'skill')
  cpSync(fileURLToPath(new URL('../../../.agents/skills/cim-wiki', import.meta.url)), installed, { recursive: true })
  const calls = []
  let status = 200
  let response = { project: 'example', content_kind: 'strict_nodes', configuration_status: { delivery_contract: 'ready' }, capabilities: { submit: true }, diagnostics: [], template_binding: { version: 'v2' }, modules: ['example'], document_defaults: { definition: { templates: [{ id: 'sdd', name: 'SDD', node_type: 'design', body: 'large-response-sentinel'.repeat(30000) }] } } }
  const server = createServer((req, res) => { calls.push(req.url); res.writeHead(status, { 'Content-Type': 'application/json', 'X-Request-ID': 'test-request-001' }); res.end(JSON.stringify(response)) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close() })
  async function run(args) {
    const child = spawn(process.execPath, [join(installed, 'scripts/client.mjs'), ...args], { cwd: root, env: { ...process.env, CIM_WIKI_URL: `http://127.0.0.1:${server.address().port}`, CIM_WIKI_TOKEN: 'test-token' } })
    let stdout = '', stderr = ''
    child.stdout.on('data', data => { stdout += data }); child.stderr.on('data', data => { stderr += data })
    const [code] = await once(child, 'close'); return { code, stdout, stderr }
  }
  return { root, run, calls, get response() { return response }, setResponse(value, code) { response = value; status = code } }
}

test('portable context summary retains configuration and template identifiers without large bodies', async t => {
  const f = await fixture(t)
  const result = await f.run(['context', '--project', 'example', '--summary'])
  assert.equal(result.code, 0, result.stderr)
  const summary = JSON.parse(result.stdout)
  assert.equal(summary.capabilities.submit, true)
  assert.equal(summary.template_binding.version, 'v2')
  assert.deepEqual(summary.templates, [{ id: 'sdd', node_type: 'design', name: 'SDD' }])
  assert.doesNotMatch(result.stdout, /large-response-sentinel/)
  assert.ok(result.stdout.length < 4000)
  assert.equal(f.calls[0], '/api/v2/knowledge/context?project=example')
})

test('output saves a complete response with private permissions while stdout stays small', async t => {
  const f = await fixture(t), output = join(f.root, 'context.json')
  const result = await f.run(['context', '--project', 'example', '--output', output, '--summary'])
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), f.response)
  assert.equal(statSync(output).mode & 0o777, 0o600)
  assert.doesNotMatch(result.stdout, /large-response-sentinel/)
  const repeat = await f.run(['context', '--project', 'example', '--output', output])
  assert.equal(repeat.code, 1)
  assert.match(repeat.stderr, /already exists/)
  assert.equal(f.calls.length, 1, 'Refuse existing output before any HTTP request')
})

test('failed responses preserve full diagnostics on disk and show indexed paths in stderr', async t => {
  const f = await fixture(t), output = join(f.root, 'error.json')
  f.setResponse({ error: 'Bundle schema validation failed', code: 'BUNDLE_SCHEMA_INVALID', diagnostics: [{ path: '/nodes/0/type', keyword: 'required', message: "must have required property 'type'" }] }, 422)
  const input = join(f.root, 'submit.json'); writeFileSync(input, JSON.stringify({ project: 'example', target_path: 'doc/50-designs/example.md', local_report: { project: 'example', target_path: 'doc/50-designs/example.md', document_id: null, errors: [] } }))
  const result = await f.run(['submit', '--json-file', input, '--output', output])
  assert.equal(result.code, 1)
  assert.match(result.stderr, /HTTP 422/)
  assert.match(result.stderr, /BUNDLE_SCHEMA_INVALID/)
  assert.match(result.stderr, /request_id=test-request-001/)
  assert.match(result.stderr, /\/nodes\/0\/type/)
  assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), { ...f.response, request_id: 'test-request-001' })
  assert.equal(result.stdout, '')
})

test('plain output remains complete and summary is restricted to context', async t => {
  const f = await fixture(t)
  assert.equal((await f.run(['document', '--summary'])).code, 1)
  assert.equal(f.calls.length, 0)
  const result = await f.run(['context', '--project', 'example'])
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), f.response)
})

test('project and templates commands use separate project paths and require an explicit project', async t => {
  const f = await fixture(t)
  const project = await f.run(['project', '--project', 'example'])
  assert.equal(project.code, 0, project.stderr)
  assert.equal(f.calls[0], '/api/v2/knowledge/projects/example')
  const templates = await f.run(['templates', '--project', 'example', '--template-id', 'sdd'])
  assert.equal(templates.code, 0, templates.stderr)
  assert.equal(f.calls[1], '/api/v2/knowledge/projects/example/templates?template_id=sdd')
  const output = join(f.root, 'templates.json')
  assert.equal((await f.run(['templates', '--project', 'example', '--output', output])).code, 0)
  assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), f.response)
  const count = f.calls.length
  assert.equal((await f.run(['templates'])).code, 1)
  assert.equal((await f.run(['project', '--project', '../other'])).code, 1)
  assert.equal(f.calls.length, count, 'Missing or unsafe project never sends a request')
})

test('document commands submit, freeze and request review without exposing Wiki build commands', async t => {
  const f = await fixture(t)
  const input = join(f.root, 'document.json')
  writeFileSync(input, JSON.stringify({ project: 'example', target_path: 'doc/50-designs/example.md', local_report: { project: 'example', target_path: 'doc/50-designs/example.md', document_id: null, errors: [] } }))
  for (const [command, endpoint] of [['submit', 'document-submit'], ['freeze', 'document-freeze'], ['review', 'document-review-requests']]) {
    const result = await f.run([command, '--json-file', input])
    assert.equal(result.code, 0, result.stderr)
    assert.equal(f.calls.at(-1), '/api/v2/knowledge/' + endpoint)
  }
  const count = f.calls.length
  for (const command of ['compile', 'validate', 'publish-document', 'check-document'])
    assert.equal((await f.run([command, '--json-file', input])).code, 1)
  assert.equal(f.calls.length, count)
})
