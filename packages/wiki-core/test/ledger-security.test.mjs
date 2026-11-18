import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createDocumentQuality } from '../../wiki-service/document-quality.mjs'

async function server(t, handle) {
  const service = createServer(handle); service.listen(0, '127.0.0.1')
  await once(service, 'listening')
  t.after(() => { service.closeAllConnections(); service.close() })
  return `http://127.0.0.1:${service.address().port}`
}

test('ledger targets stay on the configured origin and reject URL/path injection before making a request', async t => {
  const requests = []
  const origin = await server(t, (req, res) => { requests.push(req.url); res.setHeader('Content-Type', 'application/json'); res.end('{"data":{}}') })
  const quality = createDocumentQuality({ ledgerURL: origin, ledgerToken: 'private' })
  for (const resource of ['//evil.invalid', '../project', 'project?x=1', 'project#fragment', 'https://evil.invalid', 'project/../../other'])
    await assert.rejects(quality.call('demo', resource), /Invalid ledger resource/)
  for (const project of ['../other', '//evil.invalid', 'demo?x=1'])
    await assert.rejects(quality.call(project, 'project'), /Explicit project binding required/)
  assert.equal(requests.length, 0)
  await quality.call('demo', 'project', { query: { topic: 'a?b#c/../x' } })
  const url = new URL(requests[0], origin)
  assert.equal(url.pathname, '/internal/v1/projects/demo/document-quality/project')
  assert.equal(url.searchParams.get('topic'), 'a?b#c/../x')
})

test('ledger never follows redirects with service credentials', async t => {
  let leaked = false
  const trap = await server(t, (_req, res) => { leaked = true; res.end('{}') })
  const origin = await server(t, (_req, res) => { res.writeHead(302, { Location: trap }); res.end() })
  const quality = createDocumentQuality({ ledgerURL: origin, ledgerToken: 'private' })
  await assert.rejects(quality.call('demo', 'project'), /unavailable/)
  assert.equal(leaked, false)
})
