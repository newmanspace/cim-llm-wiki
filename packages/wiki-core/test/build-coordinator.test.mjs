import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBuildCoordinator } from '../../wiki-service/build-coordinator.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'wiki-jobs-'))
  let clock = 100000
  const c = createBuildCoordinator({ root, clock: () => clock, leaseMs: 100, retryDelays: [20], previewTtlMs: 200 })
  t.after(() => { c.close(); rmSync(root, { recursive: true, force: true }) })
  return { root, c, advance: n => { clock += n } }
}
const input = { project: 'demo', mode: 'formal', gitCommit: 'a'.repeat(40), snapshot: 'snapshot-test', digest: 'b'.repeat(64) }

test('persisted jobs wake waiting consumers, duplicate notifications cannot double claim', async t => {
  const { c } = fixture(t)
  const waiting = c.waitClaim('worker', 1000)
  const job = c.enqueue(input)
  const claim = await waiting
  assert.equal(claim.id, job.id)
  assert.equal(c.claim('another'), null)
  assert.equal(c.enqueue(input).id, job.id)
  assert.equal(c.list('other').length, 0)
})

test('expired worker results are fenced; retry budget survives coordinator restart', t => {
  const { c, root, advance } = fixture(t)
  const job = c.enqueue(input)
  const old = c.claim('old')
  advance(101); c.reconcile()
  assert.throws(() => c.complete(old.id, old.claimToken, {}), /lease|claim/i)
  advance(21)
  const next = c.claim('new')
  assert.equal(next.id, job.id)
  assert.notEqual(next.claimToken, old.claimToken)
  c.fail(next.id, next.claimToken, 'worker stopped', true)
  assert.equal(c.get(job.id).state, 'failed')
  c.close()
  const restarted = createBuildCoordinator({ root })
  t.after(() => restarted.close())
  assert.equal(restarted.get(job.id).attempts.length, 2)
  assert.equal(restarted.claim('worker'), null)
})

test('preview revoke and expiry forbid both completion and automatic revival', t => {
  const { c, advance } = fixture(t)
  const job = c.enqueue({ ...input, mode: 'preview', bundleId: 'CR-1' })
  const claim = c.claim('worker')
  c.cancel(job.id)
  assert.throws(() => c.complete(job.id, claim.claimToken, {}), /lease|claim|revoked/i)
  advance(500); c.reconcile()
  assert.equal(c.get(job.id).state, 'revoked')
  assert.equal(c.claim('worker'), null)
  const another = c.enqueue({ ...input, mode: 'preview', bundleId: 'CR-2' })
  advance(201); c.reconcile()
  assert.equal(c.get(another.id).state, 'expired')
  assert.throws(() => c.retry(another.id), /expired|retry/i)
})

test('deterministic errors do not retry, manual retry is explicit and terminal success is idempotent', t => {
  const { c } = fixture(t)
  const job = c.enqueue(input)
  const first = c.claim('worker')
  c.fail(job.id, first.claimToken, 'invalid schema', false)
  assert.equal(c.claim('worker'), null)
  c.retry(job.id)
  const next = c.claim('worker')
  c.complete(job.id, next.claimToken, { gitCommit: input.gitCommit })
  assert.equal(c.complete(job.id, next.claimToken, { gitCommit: input.gitCommit }).state, 'succeeded')
  assert.throws(() => c.retry(job.id), /retry/i)
})

test('a cancelled wait never consumes a job and the coordinator permits only one writer', async t => {
  const { c, root } = fixture(t)
  assert.throws(() => createBuildCoordinator({ root }), /EEXIST/)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(c.waitClaim('cancelled', 100, controller.signal), /closed/)
  const job = c.enqueue(input)
  assert.equal(c.claim('active').id, job.id)
})

test('publication authorized before a synchronous update finishes once even across the lease deadline', t => {
  const { c, advance } = fixture(t)
  const job = c.enqueue(input), claim = c.claim('worker')
  let updates = 0
  const apply = () => { updates++; advance(101); return { updated: true } }
  assert.equal(c.completeWith(job.id, claim.claimToken, apply).state, 'succeeded')
  assert.equal(c.completeWith(job.id, claim.claimToken, apply).state, 'succeeded')
  assert.equal(updates, 1)
})

test('formal requests from another project do not supersede the current project request', t => {
  const { c } = fixture(t)
  const first = c.enqueue(input)
  const other = c.enqueue({ ...input, project: 'other' })
  assert.equal(c.latestFormal('demo').id, first.id)
  assert.equal(c.latestFormal('other').id, other.id)
  const next = c.enqueue({ ...input, gitCommit: 'c'.repeat(40) })
  assert.equal(c.latestFormal('demo').id, next.id)
  assert.equal(c.latestFormal('other').id, other.id)
})
