import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

function check(t, profile) {
  const directory = mkdtempSync(join(tmpdir(), 'go-coverage-gate-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const path = join(directory, 'coverage')
  writeFileSync(path, profile)
  return spawnSync(process.execPath, ['scripts/check-go-coverage.mjs', path], { encoding: 'utf8' })
}

test('Go coverage combines blocks across test binaries without diluting coverage', t => {
  const result = check(t, 'mode: atomic\na.go:1.1,2.1 80 1\na.go:3.1,4.1 20 0\na.go:1.1,2.1 80 0\na.go:3.1,4.1 20 0\n')
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /80.00%/)
})

test('Go coverage rejects a value below the threshold even when display rounds up', t => {
  const result = check(t, 'mode: atomic\na.go:1.1,2.1 79999 1\na.go:3.1,4.1 20001 0\n')
  assert.equal(result.status, 1)
  assert.match(result.stdout, /80.00%/)
})

test('Go coverage refuses empty or malformed reports', t => {
  for (const profile of ['mode: atomic\n', 'mode: atomic\ngarbage\n', 'invalid\n']) {
    const result = check(t, profile)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Invalid|Malformed|No statements/)
  }
})

function vulnerabilities(t, events) {
  const directory = mkdtempSync(join(tmpdir(), 'go-vulnerability-gate-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const path = join(directory, 'scan.json')
  writeFileSync(path, events.map(event => JSON.stringify(event, null, 2)).join('\n'))
  return spawnSync('python3', ['scripts/check-go-vulnerabilities.py', path], { encoding: 'utf8' })
}
const scan = [
  { config: { scanner_name: 'govulncheck' } },
  { SBOM: { modules: [{ path: 'cim-llm-wiki' }] } },
]

test('Go vulnerability gate blocks called symbols even when JSON scan exits successfully', t => {
  const result = vulnerabilities(t, [...scan, { finding: { osv: 'GO-TEST', trace: [{ function: 'Login' }] } }])
  assert.equal(result.status, 1)
  assert.match(result.stdout, /GO-TEST/)
})

test('Go vulnerability gate permits non-reachable module findings but rejects empty scans', t => {
  const result = vulnerabilities(t, [...scan, { finding: { osv: 'GO-TEST', trace: [{ module: 'unused' }] } }])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(vulnerabilities(t, []).status, 1)
  assert.equal(vulnerabilities(t, [scan[0]]).status, 1)
})
