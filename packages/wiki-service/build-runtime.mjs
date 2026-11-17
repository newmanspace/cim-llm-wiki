import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createBuildCoordinator, publicJob } from './build-coordinator.mjs'
import { captureSnapshot, copySafe, gitIdentity, snapshotContext } from '../wiki-core/build-snapshot.mjs'
import { atomicJson } from '../wiki-core/build-job-store.mjs'
import { commitWiki, ensureRepo, gitopsEnabled, pushWiki } from '../wiki-core/wiki-gitops.mjs'
import { createSitePublisher } from './build-publication.mjs'
import { startBuildSocket } from './build-socket.mjs'
import { buildConfig } from './build-config.mjs'
import { hashFile } from '../wiki-core/sources.mjs'
import { validateWiki } from '../wiki-core/validate.mjs'

const read = path => JSON.parse(readFileSync(path, 'utf8'))
export function createBuildRuntime({ projectRoot, wikiRoot, roots, socketPath, previewTtlMs } = {}) {
  const config = { ...buildConfig(projectRoot), ...(socketPath ? { socketPath } : {}), ...(previewTtlMs ? { previewTtlMs } : {}) }
  const buildsRoot = join(projectRoot, 'data/wiki-builds'), jobsRoot = config.jobsRoot, intentsRoot = join(jobsRoot, 'intents'), previewsRoot = join(projectRoot, 'data/wiki-previews')
  for (const root of [buildsRoot, intentsRoot, previewsRoot]) mkdirSync(root, { recursive: true })
  const attemptsRoot = join(buildsRoot, 'attempts')
  mkdirSync(attemptsRoot, { recursive: true }); chmodSync(attemptsRoot, 0o2770)
  const coordinator = createBuildCoordinator({ root: jobsRoot, ...config })
  const publisher = createSitePublisher(join(projectRoot, 'data/wiki-site'))
  let socket, timer
  const snapshot = source => captureSnapshot({ projectRoot, wikiRoot: source, gitRoot: wikiRoot, roots, buildsRoot: join(buildsRoot, 'snapshots') })
  function begin(record) {
    const id = randomUUID()
    atomicJson(join(intentsRoot, id + '.json'), { id, bundleId: record.bundle.bundle_id, project: record.bundle.project, bundleDigest: record.digest, state: 'awaiting_publication', createdAt: Date.now() })
    return id
  }
  function captureFormal(id) {
    const path = join(intentsRoot, id + '.json'), intent = read(path)
    try {
      if (!gitopsEnabled()) throw new Error('Enable Wiki GitOps before building the formal site')
      ensureRepo(wikiRoot)
      const commit = commitWiki(wikiRoot, `chore(wiki): ${intent.project} ${intent.bundleId}`, { projectRoot, roots })
      intent.input = { ...snapshot(wikiRoot), project: intent.project, bundleId: intent.bundleId, mode: 'formal' }
      if (commit.committed) {
        try { intent.push = pushWiki(wikiRoot) } catch (error) { intent.pushError = error.message }
      }
      intent.state = 'captured'
    } catch (error) { intent.state = 'blocked'; intent.error = error.message }
    atomicJson(path, intent)
    return intent
  }
  function settled(record) {
    if (!record.site_build_intent) return null
    const path = join(intentsRoot, record.site_build_intent + '.json'), intent = read(path)
    if (record.state !== 'published' || record.publication_pending || intent.bundleDigest !== record.digest) return null
    if (!intent.input) return { state: 'blocked', error: intent.error, intentId: intent.id }
    if (intent.jobId) return publicJob(coordinator.get(intent.jobId))
    const job = coordinator.enqueue(intent.input)
    intent.jobId = job.id; intent.state = 'dispatched'; atomicJson(path, intent)
    return publicJob(job)
  }
  function preview(project, bundleId, source) {
    return publicJob(coordinator.enqueue({ ...snapshot(source), project, bundleId, mode: 'preview' }))
  }
  function dispatchManual(intent) {
    const job = coordinator.enqueue(intent.input)
    intent.jobId = job.id; intent.state = 'dispatched'
    atomicJson(join(intentsRoot, intent.id + '.json'), intent)
    return publicJob(job)
  }
  function checkCurrentInput() {
    const diagnostics = []
    try { gitIdentity(wikiRoot) }
    catch (error) { diagnostics.push({ code: 'git_baseline', message: 'Wiki Git 基线不可构建：' + error.message }) }
    const validation = validateWiki({ projectRoot, wikiRoot, roots })
    if (validation.errors.length) diagnostics.push({ code: 'wiki_validation', message: `全库严格校验未通过，共 ${validation.errors.length} 项错误`, issues: validation.errors })
    const folder = join(projectRoot, 'data/service/bundles')
    if (existsSync(folder) && readdirSync(folder).filter(name => name.endsWith('.json')).some(name => read(join(folder, name)).publication_pending)) diagnostics.push({ code: 'publication_pending', message: '存在未结算的发布，请先完成发布恢复' })
    return diagnostics
  }
  function buildCurrent(project) {
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(project) || !existsSync(join(wikiRoot, project))) throw Object.assign(new Error('Wiki project not found'), { status: 404 })
    const intent = { id: randomUUID(), project, kind: 'manual', state: 'awaiting_validation', createdAt: Date.now() }
    const path = join(intentsRoot, intent.id + '.json')
    atomicJson(path, intent)
    try {
      intent.diagnostics = checkCurrentInput()
      if (intent.diagnostics.length) throw new Error(intent.diagnostics.map(item => item.message).join('；'))
      intent.input = { ...snapshot(wikiRoot), project, mode: 'formal' }
      intent.state = 'captured'; atomicJson(path, intent)
    } catch (error) {
      intent.state = 'blocked'; intent.error = error.message; atomicJson(path, intent)
      return list(project).find(job => job.id === intent.id)
    }
    return dispatchManual(intent)
  }
  function output(job) { return join(buildsRoot, 'attempts', job.id, job.claimToken, 'dist') }
  function acceptOutput(job) {
    if (job.mode === 'formal') {
      if (coordinator.latestFormal()?.id !== job.id) return { gitCommit: job.gitCommit, updated: false, reason: 'Superseded by a newer requested commit' }
      return publisher.publish(output(job), job.gitCommit)
    }
    if (job.expiresAt <= Date.now()) throw new Error('Preview expired')
    const target = join(previewsRoot, job.id)
    if (existsSync(target)) rmSync(target, { recursive: true })
    copySafe(output(job), target)
    if (!existsSync(join(target, 'index.html'))) throw new Error('Preview output is incomplete')
    return { gitCommit: job.gitCommit, previewUrl: `/wiki-preview/${job.id}/` }
  }
  function reconcile() {
    coordinator.reconcile()
    for (const job of coordinator.list()) {
      if (['revoked', 'expired'].includes(job.state)) rmSync(join(previewsRoot, job.id), { recursive: true, force: true })
    }
    for (const file of readdirSync(intentsRoot).filter(name => name.endsWith('.json'))) {
      const intent = read(join(intentsRoot, file))
      if (intent.kind !== 'manual') continue
      if (intent.state === 'captured') dispatchManual(intent)
      else if (intent.state === 'awaiting_validation') {
        intent.state = 'blocked'; intent.error = '构建前检查被中断，请重新发起构建'
        atomicJson(join(intentsRoot, file), intent)
      }
    }
    const folder = join(projectRoot, 'data/service/bundles')
    if (!existsSync(folder)) return
    for (const file of readdirSync(folder).filter(n => n.endsWith('.json')).sort()) settled(read(join(folder, file)))
  }
  async function start() {
    reconcile()
    socket = await startBuildSocket({ socketPath: config.socketPath, waitMs: config.waitMs, coordinator, acceptOutput })
    timer = setInterval(() => {
      try { reconcile() } catch (error) { console.error('Wiki task reconciliation failed:', error.message) }
    }, config.reconcileMs)
    timer.unref()
  }
  function retry(id) {
    const job = coordinator.get(id)
    const context = snapshotContext(join(buildsRoot, 'snapshots'), job.snapshot, job.digest)
    const metadata = read(join(buildsRoot, 'snapshots', job.snapshot, 'snapshot.json'))
    if (gitIdentity(wikiRoot) !== job.gitCommit) throw Object.assign(new Error('Wiki Git baseline changed; create a new build'), { status: 409 })
    if (metadata.liveChecks.some(check => !existsSync(check.path) || hashFile(check.path) !== check.sha256)) throw Object.assign(new Error('Source evidence changed; revalidate before building'), { status: 409 })
    const rules = 'data/document-defaults/state.json'
    if (hashFile(join(projectRoot, rules)) !== hashFile(join(context.projectRoot, rules))) throw Object.assign(new Error('Document binding changed; create a new build'), { status: 409 })
    return coordinator.retry(id)
  }
  function list(project) {
    const blocked = readdirSync(intentsRoot).filter(file => file.endsWith('.json')).map(file => read(join(intentsRoot, file))).filter(i => i.project === project && i.state === 'blocked').map(i => ({ id: i.id, project, bundleId: i.bundleId, mode: 'formal', state: 'blocked', attempts: [], error: i.error, diagnostics: i.diagnostics, createdAt: i.createdAt, gitCommit: '' }))
    return [...coordinator.list(project), ...blocked].sort((a, b) => b.createdAt - a.createdAt)
  }
  return { coordinator, begin, captureFormal, settled, preview, buildCurrent, start, reconcile, retry, list,
    close() { clearInterval(timer); socket?.close(); socket?.closeAllConnections(); coordinator.close() },
  }
}
