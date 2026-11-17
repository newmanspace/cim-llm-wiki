import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { createBuildJobStore } from '../wiki-core/build-job-store.mjs'
import { hashValue } from '../wiki-core/sources.mjs'

const terminal = new Set(['succeeded', 'failed', 'revoked', 'expired'])
const problem = message => { throw Object.assign(new Error(message), { status: 409 }) }
export function publicJob(job) {
  const { claimToken: _token, snapshot: _snapshot, digest: _digest, ...value } = job
  return { ...value, attempts: job.attempts.map(({ token: _secret, ...a }) => a) }
}

export function createBuildCoordinator({ root, clock = Date.now, leaseMs = 60000, retryDelays = [5000, 30000, 120000], previewTtlMs = 86400000 } = {}) {
  const store = createBuildJobStore(root), events = new EventEmitter()
  events.setMaxListeners(20)
  const jobs = new Map(store.list().map(j => [j.id, j]))
  let closed = false, retryTimer
  const save = job => { store.save(job); jobs.set(job.id, job); return structuredClone(job) }
  const get = id => structuredClone(jobs.get(id) || problem('Build job not found'))
  const notify = () => events.emit('ready')
  function arm() {
    clearTimeout(retryTimer)
    const future = [...jobs.values()].filter(j => j.state === 'retry_wait' && j.runAt > clock()).map(j => j.runAt)
    if (future.length) retryTimer = setTimeout(notify, Math.max(1, Math.min(...future) - clock()))
    retryTimer?.unref()
  }
  function enqueue(input) {
    if (!['formal', 'preview'].includes(input.mode) || !/^[a-f0-9]{40}$/.test(input.gitCommit) || !/^[a-z0-9_-]+$/i.test(input.project)) problem('Invalid build input')
    const key = hashValue(input)
    const existing = [...jobs.values()].find(j => j.key === key && j.mode === 'formal')
    if (existing) return structuredClone(existing)
    const job = { ...input, id: randomUUID(), schemaVersion: 1, key, state: 'queued', createdAt: clock(), runAt: clock(), attempts: [], sequence: Math.max(0, ...[...jobs.values()].map(j => j.sequence)) + 1 }
    if (job.mode === 'preview') job.expiresAt = clock() + previewTtlMs
    save(job); notify()
    return get(job.id)
  }
  function authorize(id, claimToken) {
    const job = get(id)
    if (job.state !== 'running' || job.claimToken !== claimToken || job.leaseUntil <= clock()) problem('Build claim or lease is no longer valid')
    if (job.expiresAt && job.expiresAt <= clock()) problem('Preview expired')
    return job
  }
  function claim(worker) {
    reconcile()
    if ([...jobs.values()].some(j => j.state === 'running')) return null
    const job = [...jobs.values()].filter(j => ['queued', 'retry_wait'].includes(j.state) && j.runAt <= clock()).sort((a, b) => a.attempts.length - b.attempts.length || a.sequence - b.sequence)[0]
    if (!job) return null
    const value = structuredClone(job)
    value.claimToken = randomUUID(); value.worker = worker; value.state = 'running'; value.leaseUntil = clock() + leaseMs
    value.attempts.push({ token: value.claimToken, startedAt: clock(), stage: 'claimed' })
    return save(value)
  }
  function waitClaim(worker, waitMs = 25000, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new Error('Worker connection closed')); return }
      let timer
      const cleanup = () => { clearTimeout(timer); events.off('ready', ready); signal?.removeEventListener('abort', abort) }
      const abort = () => { cleanup(); reject(new Error('Worker connection closed')) }
      const ready = () => {
        if (closed) { cleanup(); resolve(null); return }
        const job = claim(worker)
        if (job) { cleanup(); resolve(job) }
      }
      events.on('ready', ready)
      signal?.addEventListener('abort', abort, { once: true })
      timer = setTimeout(() => { cleanup(); resolve(null) }, waitMs)
      ready()
    })
  }
  function heartbeat(id, claimToken, stage) {
    const job = authorize(id, claimToken)
    job.leaseUntil = clock() + leaseMs
    job.attempts.at(-1).stage = String(stage || 'building').slice(0, 80)
    return save(job)
  }
  function finish(job, result) {
    job.state = 'succeeded'; job.result = result; job.finishedAt = clock(); job.attempts.at(-1).finishedAt = clock()
    save(job); notify(); return get(job.id)
  }
  function completeWith(id, claimToken, apply) {
    const previous = get(id)
    if (previous.state === 'succeeded' && previous.claimToken === claimToken) return previous
    const job = authorize(id, claimToken)
    return finish(job, apply(job))
  }
  function complete(id, claimToken, result) {
    const previous = get(id)
    if (previous.state === 'succeeded' && previous.claimToken === claimToken) return previous
    const job = authorize(id, claimToken)
    return finish(job, result)
  }
  function fail(id, claimToken, message, recoverable = false) {
    return recordFailure(authorize(id, claimToken), message, recoverable)
  }
  function recordFailure(job, message, recoverable) {
    job.error = String(message).slice(0, 2000); job.attempts.at(-1).error = job.error; job.attempts.at(-1).finishedAt = clock()
    const delay = retryDelays[job.attempts.length - 1]
    job.state = recoverable && delay !== undefined ? 'retry_wait' : 'failed'
    job.runAt = clock() + (delay || 0); delete job.claimToken
    save(job); arm(); notify(); return get(job.id)
  }
  function cancel(id) {
    const job = get(id)
    if (job.mode !== 'preview') problem('Only preview jobs can be revoked')
    job.state = 'revoked'; job.finishedAt = clock(); delete job.claimToken
    save(job); notify(); return job
  }
  function retry(id) {
    const job = get(id)
    if (job.state !== 'failed') problem('Build job cannot retry in this state')
    if (job.expiresAt && job.expiresAt <= clock()) problem('Preview expired')
    job.state = 'queued'; job.runAt = clock(); job.manualRetries = (job.manualRetries || 0) + 1
    save(job); notify(); return get(id)
  }
  function reconcile() {
    for (const original of jobs.values()) {
      const job = structuredClone(original)
      if (job.expiresAt && job.expiresAt <= clock() && !['revoked', 'expired'].includes(job.state)) {
        job.state = 'expired'; job.finishedAt = clock(); delete job.claimToken; save(job)
      } else if (job.state === 'running' && job.leaseUntil <= clock()) {
        recordFailure(job, 'Worker lease expired', true)
      }
    }
    arm()
  }
  return { enqueue, claim, waitClaim, heartbeat, authorize, complete, completeWith, fail, cancel, retry, reconcile, get,
    list: project => [...jobs.values()].filter(j => !project || j.project === project).sort((a, b) => b.sequence - a.sequence).map(publicJob),
    latestFormal: () => [...jobs.values()].filter(j => j.mode === 'formal').sort((a, b) => b.sequence - a.sequence)[0],
    accessible(id) { const job = get(id); return job.mode === 'preview' && job.state === 'succeeded' && job.expiresAt > clock() },
    close() { if (closed) return; closed = true; clearTimeout(retryTimer); notify(); store.close() },
    isTerminal: state => terminal.has(state),
  }
}
