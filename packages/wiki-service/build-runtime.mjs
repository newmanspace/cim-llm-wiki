import { createWikiSource } from './wiki-source.mjs'
import { repositoryCommit, repositoryKind } from '../wiki-core/repository-docs.mjs'
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createBuildCoordinator, publicJob } from './build-coordinator.mjs'
import { captureSnapshot, copySafe, gitIdentity, snapshotContext, treeDigest } from '../wiki-core/build-snapshot.mjs'
import { atomicJson } from '../wiki-core/build-job-store.mjs'
import { ensureRepo, gitopsEnabled, pushWiki } from '../wiki-core/wiki-gitops.mjs'
import { createSitePublisher } from './build-publication.mjs'
import { startBuildSocket } from './build-socket.mjs'
import { buildConfig } from './build-config.mjs'

const read = path => JSON.parse(readFileSync(path, 'utf8'))
export function createBuildRuntime({ projectRoot, wikiRoot, roots, socketPath, previewTtlMs, projectWikis } = {}) {
  const config = { ...buildConfig(projectRoot), ...(socketPath ? { socketPath } : {}), ...(previewTtlMs ? { previewTtlMs } : {}) }
  const buildsRoot = join(projectRoot, 'data/wiki-builds'), jobsRoot = config.jobsRoot, intentsRoot = join(jobsRoot, 'intents'), previewsRoot = join(projectRoot, 'data/wiki-previews')
  for (const root of [buildsRoot, intentsRoot, previewsRoot]) mkdirSync(root, { recursive: true })
  const attemptsRoot = join(buildsRoot, 'attempts')
  mkdirSync(attemptsRoot, { recursive: true }); chmodSync(attemptsRoot, 0o2770)
  const coordinator = createBuildCoordinator({ root: jobsRoot, ...config })
  const publisher = createSitePublisher(join(projectRoot, 'data/wiki-site'))
  let socket, timer
  const sourceFor = project => projectWikis ? projectWikis.source(project) : wikiRoot
  const kindFor = project => projectWikis?.kind(project) || 'strict_nodes'
  const wikiSources = createWikiSource({ projectRoot, sourceFor, prefixFor: p => projectWikis ? '' : p })
  function snapshot(source, project, candidate = false, extraPaths = []) {
    const prepared = !candidate && kindFor(project) !== repositoryKind ? wikiSources.prepare(project, extraPaths) : null
    const input = prepared?.candidate || source
    try {
      return captureSnapshot({ projectRoot, wikiRoot: input, gitRoot: sourceFor(project), roots, commitPlan: prepared?.plan, allowDirtyBaseline: candidate, contentKind: kindFor(project), buildsRoot: join(buildsRoot, 'snapshots'), ...(projectWikis ? { project, ...(!candidate ? { sourceRoot: input } : {}) } : {}) })
    } finally { prepared?.cleanup() }
  }
  const projectPublishers = new Map()
  const publisherFor = project => {
    if (!projectWikis) return publisher
    if (!projectPublishers.has(project)) projectPublishers.set(project, createSitePublisher(join(projectRoot, 'data/projects', project, 'site')))
    return projectPublishers.get(project)
  }
  function begin(record) {
    if (kindFor(record.bundle.project) === repositoryKind) throw new Error('Documentation repositories do not accept strict-node publication')
    if (projectWikis) wikiSources.check(record.bundle.project)
    const id = randomUUID()
    atomicJson(join(intentsRoot, id + '.json'), { id, bundleId: record.bundle.bundle_id, project: record.bundle.project, bundleDigest: record.digest, state: 'awaiting_publication', createdAt: Date.now() })
    return id
  }
  function captureFormal(id, result, importError) {
    const path = join(intentsRoot, id + '.json'), intent = read(path)
    try {
      if (!gitopsEnabled()) throw new Error('Enable Wiki GitOps before building the formal site')
      const source = sourceFor(intent.project)
      ensureRepo(source)
      const paths = (result?.written || []).map(path => projectWikis ? path.slice(intent.project.length + 1) : path)
      if (paths.length) wikiSources.register(intent.project, paths)
      if (importError) throw importError
      intent.input = { ...snapshot(source, intent.project, false, paths), project: intent.project, bundleId: intent.bundleId, mode: 'formal' }
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
    if (kindFor(project) === repositoryKind) throw new Error('Documentation repositories do not accept Bundle previews')
    return publicJob(coordinator.enqueue({ ...snapshot(source, project, true), project, bundleId, mode: 'preview' }))
  }
  function dispatchManual(intent) {
    const job = coordinator.enqueue(intent.input)
    intent.jobId = job.id; intent.state = 'dispatched'
    atomicJson(join(intentsRoot, intent.id + '.json'), intent)
    return publicJob(job)
  }
  function checkCurrentInput(project) {
    if (kindFor(project) === repositoryKind) { repositoryCommit(sourceFor(project)); return [] }
    const diagnostics = []
    const folder = join(projectRoot, 'data/service/bundles')
    if (existsSync(folder) && readdirSync(folder).filter(name => name.endsWith('.json')).some(name => ((!projectWikis || read(join(folder, name)).bundle?.project === project) && read(join(folder, name)).publication_pending))) diagnostics.push({ code: 'publication_pending', message: '存在未结算的发布，请先完成发布恢复' })
    return diagnostics
  }
  function blockedImport(project, error) {
    const intent = { id: randomUUID(), project, kind: 'manual', state: 'blocked', createdAt: Date.now(), error: error.message, diagnostics: [{ code: error.code || 'wiki_source_import', message: error.message }] }
    atomicJson(join(intentsRoot, intent.id + '.json'), intent)
    return list(project).find(job => job.id === intent.id)
  }
  function buildCurrent(project) {
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(project) || !existsSync(projectWikis ? sourceFor(project) : join(wikiRoot, project))) throw Object.assign(new Error('Wiki project not found'), { status: 404 })
    const intent = { id: randomUUID(), project, kind: 'manual', state: 'awaiting_validation', createdAt: Date.now() }
    const path = join(intentsRoot, intent.id + '.json')
    atomicJson(path, intent)
    try {
      intent.diagnostics = checkCurrentInput(project)
      if (intent.diagnostics.length) throw new Error(intent.diagnostics.map(item => item.message).join('；'))
      intent.input = { ...snapshot(sourceFor(project), project), project, mode: 'formal' }
      intent.state = 'captured'; atomicJson(path, intent)
    } catch (error) {
      intent.state = 'blocked'; intent.error = error.message
      if (error.code === 'wiki_validation') intent.diagnostics.push({ code: error.code, message: error.message, issues: error.diagnostics })
      else if (/Wiki Git|git repository/.test(error.message)) intent.diagnostics.push({ code: 'git_baseline', message: error.message })
      atomicJson(path, intent)
      return list(project).find(job => job.id === intent.id)
    }
    return dispatchManual(intent)
  }
  function output(job) { return join(buildsRoot, 'attempts', job.id, job.claimToken, 'dist') }
  function acceptFormalOutput(job) {
    if (coordinator.latestFormal(projectWikis ? job.project : undefined)?.id !== job.id) return { gitCommit: job.gitCommit, updated: false, reason: 'Superseded by a newer requested commit' }
    snapshotContext(join(buildsRoot, 'snapshots'), job.snapshot, job.digest)
    const planPath = join(buildsRoot, 'snapshots', job.snapshot, 'source-plan.json')
    const plan = existsSync(planPath) ? read(planPath) : null
    // Validate the complete output before advancing the source branch.
    if (!existsSync(join(output(job), 'index.html'))) throw new Error('Static site has no home page')
    treeDigest(output(job))
    if (plan) wikiSources.commit(job.project, plan)
    const published = publisherFor(job.project).publish(output(job), job.gitCommit)
    wikiSources.published(job.project, job.gitCommit)
    let pushError
    if (plan) { try { pushWiki(sourceFor(job.project)) } catch (error) { pushError = error.message } }
    return { ...published, ...(pushError ? { pushError } : {}), siteUrl: `/wiki/${job.project}/` }
  }
  function acceptOutput(job) {
    if (projectWikis && read(join(buildsRoot, 'snapshots', job.snapshot, 'snapshot.json')).project !== job.project) throw new Error('Project storage changed; request a new isolated build')
    if (job.mode === 'formal') return acceptFormalOutput(job)
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
    if (projectWikis) for (const project of projectWikis.list()) publisherFor(project).recover()
    reconcile()
    socket = await startBuildSocket({ socketPath: config.socketPath, waitMs: config.waitMs, coordinator, acceptOutput })
    timer = setInterval(() => {
      try { reconcile() } catch (error) { console.error('Wiki task reconciliation failed:', error.message) }
    }, config.reconcileMs)
    timer.unref()
  }
  function retry(id) {
    const job = coordinator.get(id)
    snapshotContext(join(buildsRoot, 'snapshots'), job.snapshot, job.digest)
    const commit = kindFor(job.project) === repositoryKind ? repositoryCommit(sourceFor(job.project)) : gitIdentity(sourceFor(job.project), { allowDirty: Boolean(job.baseCommit) })
    if (commit !== job.gitCommit && commit !== job.baseCommit) throw Object.assign(new Error('Wiki Git baseline changed; create a new build'), { status: 409 })
    return coordinator.retry(id)
  }
  function list(project) {
    const blocked = readdirSync(intentsRoot).filter(file => file.endsWith('.json')).map(file => read(join(intentsRoot, file))).filter(i => i.project === project && i.state === 'blocked').map(i => ({ id: i.id, project, bundleId: i.bundleId, mode: 'formal', state: 'blocked', attempts: [], error: i.error, diagnostics: i.diagnostics, createdAt: i.createdAt, gitCommit: '' }))
    return [...coordinator.list(project), ...blocked].sort((a, b) => b.createdAt - a.createdAt)
  }
  return { coordinator, begin, captureFormal, settled, preview, buildCurrent, blockedImport, start, reconcile, retry, list,
    close() { clearInterval(timer); socket?.close(); socket?.closeAllConnections(); coordinator.close() },
  }
}
