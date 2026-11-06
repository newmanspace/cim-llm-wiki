import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const html = readFileSync(
  new URL('../../../deploy/gateway/login.html', import.meta.url),
  'utf8',
)
const source = html.match(/function safeNext\(\) \{([\s\S]+?)\n {4}\}/)?.[0]
if (!source) throw new Error('Login redirect validator is missing')
const redirect = (next) =>
  runInNewContext(`(${source})()`, {
    URL,
    URLSearchParams,
    location: {
      origin: 'https://wiki.example',
      search: '?next=' + encodeURIComponent(next),
    },
  })

test('gateway only redirects to canonical URLs under the protected browsing surfaces', () => {
  assert.equal(
    redirect('/wiki/project/page?version=v1#source'),
    'https://wiki.example/wiki/project/page?version=v1#source',
  )
  assert.equal(
    redirect('/admin/projects'),
    'https://wiki.example/admin/projects',
  )
  for (const next of [
    '//evil.example/wiki/',
    '/\\evil.example/wiki/',
    'javascript:alert(1)',
    'https://evil.example/wiki/',
    '/api/v1/auth/logout',
    '/wiki/../../login',
    'http://wiki.example/wiki/',
    'https://wiki.example.evil/wiki/',
    '',
  ]) {
    assert.equal(redirect(next), '/wiki/', next)
  }
})
