import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, openSync, closeSync, fstatSync, readSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { captureSnapshot, gitIdentity, snapshotContext } from '../build-snapshot.mjs'
import { createBuildRuntime } from '../../wiki-service/build-runtime.mjs'
import { createSitePublisher } from '../../wiki-service/build-publication.mjs'
import { runBuildWorker } from '../../wiki-worker/server.mjs'
import { treeDigest } from '../build-snapshot.mjs'
import { atomicJson } from '../build-job-store.mjs'

const repo = fileURLToPath(new URL('../../../', import.meta.url))
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'wiki-runtime-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const projectRoot = join(root, 'state')
  execFileSync(process.execPath, [join(repo, 'scripts/ci-wiki-fixture.mjs'), projectRoot], { stdio: 'pipe' })
  const wikiRoot = join(projectRoot, 'data/wiki')
  const git = args => execFileSync('git', ['-C', wikiRoot, ...args], { stdio: 'pipe', encoding: 'utf8' }).trim()
  git(['init']); git(['config', 'user.email', 'test@example.invalid']); git(['config', 'user.name', 'Test'])
  git(['add', '.']); git(['commit', '-m', 'Fixture'])
  const buildsRoot = join(projectRoot, 'data/wiki-builds')
  return { root, projectRoot, wikiRoot, buildsRoot, git }
}

test('snapshot freezes sources and dependencies, rejects tampering and dirty Git input', t => {
  const f = fixture(t)
  const captures = join(f.buildsRoot, 'snapshots')
  chmodSync(join(f.projectRoot, 'data/raw/ci-source.md'), 0o600)
  const snapshot = captureSnapshot({ ...f, roots: {}, buildsRoot: captures })
  const context = snapshotContext(captures, snapshot.snapshot, snapshot.digest)
  const source = join(f.projectRoot, 'data/raw/ci-source.md')
  const snapshotFile = openSync(join(context.projectRoot, 'data/raw/ci-source.md'), 'r+')
  try {
    assert.equal(fstatSync(snapshotFile).mode & 0o777, 0o640)
    const snapshotText = readFileSync(snapshotFile, 'utf8')
    const fd = openSync(source, 'r+')
    try {
      assert.equal(fstatSync(fd).mode & 0o777, 0o600)
      writeFileSync(fd, 'changed source')
      const changed = Buffer.alloc(fstatSync(fd).size)
      assert.equal(readSync(fd, changed, 0, changed.length, 0), changed.length)
      assert.notEqual(changed.toString('utf8'), snapshotText)
    } finally { closeSync(fd) }
    assert.equal(snapshotContext(captures, snapshot.snapshot, snapshot.digest).wikiRoot, context.wikiRoot)
    writeFileSync(snapshotFile, 'tampered snapshot')
    assert.throws(() => snapshotContext(captures, snapshot.snapshot, snapshot.digest), /integrity/)
  } finally { closeSync(snapshotFile) }
  writeFileSync(join(f.wikiRoot, 'untracked.md'), 'unreviewed')
  assert.throws(() => gitIdentity(f.wikiRoot), /uncommitted/)
})

test('manual first build works without a Bundle and does not change Git or published inputs', t => {
  const f = fixture(t), runtime = createBuildRuntime({ ...f, roots: {} })
  t.after(() => runtime.close())
  assert.deepEqual(runtime.list('ci'), [])
  const commit = f.git(['rev-parse', 'HEAD'])
  const job = runtime.buildCurrent('ci')
  assert.equal(job.state, 'queued', JSON.stringify(job))
  assert.equal(job.gitCommit, commit)
  assert.equal(job.mode, 'formal')
  assert.equal(runtime.list('ci').length, 1)
  runtime.reconcile()
  assert.equal(runtime.list('ci').length, 1)
  assert.equal(f.git(['rev-parse', 'HEAD']), commit)
  assert.equal(f.git(['status', '--porcelain']), '')
  assert.throws(() => runtime.buildCurrent('missing'), /not found/)
})

test('manual build persists blocked diagnostics for dirty Git and invalid Wiki rather than disappearing', t => {
  const f = fixture(t), runtime = createBuildRuntime({ ...f, roots: {} })
  t.after(() => runtime.close())
  writeFileSync(join(f.wikiRoot, 'untracked.md'), '# Unreviewed')
  const before = f.git(['status', '--porcelain'])
  const job = runtime.buildCurrent('ci')
  assert.equal(job.state, 'blocked')
  assert.ok(job.diagnostics.some(d => d.code === 'git_baseline'))
  assert.ok(job.diagnostics.some(d => d.code === 'wiki_validation'))
  assert.equal(runtime.coordinator.claim('worker'), null)
  assert.equal(runtime.list('ci')[0].id, job.id)
  assert.deepEqual(runtime.list('other'), [])
  runtime.reconcile()
  assert.equal(runtime.list('ci')[0].state, 'blocked')
  assert.equal(f.git(['status', '--porcelain']), before)
})

test('manual build refuses unsettled publication even when source Wiki validates', t => {
  const f = fixture(t), runtime = createBuildRuntime({ ...f, roots: {} })
  t.after(() => runtime.close())
  mkdirSync(join(f.projectRoot, 'data/service/bundles'), { recursive: true })
  atomicJson(join(f.projectRoot, 'data/service/bundles/pending.json'), { publication_pending: { files: [] } })
  const job = runtime.buildCurrent('ci')
  assert.equal(job.state, 'blocked')
  assert.ok(job.diagnostics.some(d => d.code === 'publication_pending'))
  assert.equal(runtime.coordinator.claim('worker'), null)
})

test('site publication keeps a single serving directory and refuses unsafe outputs', t => {
  const root = mkdtempSync(join(tmpdir(), 'wiki-publish-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const output = join(root, 'output'); mkdirSync(output)
  writeFileSync(join(output, 'index.html'), '<h1>first</h1>')
  const publisher = createSitePublisher(join(root, 'site'))
  publisher.publish(output, 'a'.repeat(40))
  writeFileSync(join(output, 'index.html'), '<h1>second</h1>')
  publisher.publish(output, 'b'.repeat(40))
  assert.match(readFileSync(join(root, 'site/html/index.html'), 'utf8'), /second/)
  assert.equal(existsSync(join(root, 'site/.publish-backup')), false)
  assert.equal(existsSync(join(root, 'site/.maintenance')), false)
  symlinkSync('/etc/passwd', join(output, 'leak'))
  assert.throws(() => publisher.publish(output, 'c'.repeat(40)), /Symbolic links/)
  assert.match(readFileSync(join(root, 'site/html/index.html'), 'utf8'), /second/)
})

test('interrupted site replacement restores the previous site or finalizes the matching Git source', t => {
  const root = mkdtempSync(join(tmpdir(), 'wiki-publish-recovery-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const html = join(root, 'html'), backup = join(root, '.publish-backup')
  mkdirSync(html); mkdirSync(backup)
  writeFileSync(join(html, 'index.html'), 'incomplete replacement')
  writeFileSync(join(backup, 'index.html'), 'previous complete site')
  atomicJson(join(root, '.publish-intent.json'), { gitCommit: 'a'.repeat(40), digest: 'invalid', hadHtml: true })
  writeFileSync(join(root, '.maintenance'), 'updating')
  createSitePublisher(root)
  assert.equal(readFileSync(join(html, 'index.html'), 'utf8'), 'previous complete site')
  assert.equal(existsSync(backup), false)
  writeFileSync(join(html, 'index.html'), 'new complete site')
  atomicJson(join(root, '.publish-intent.json'), { gitCommit: 'b'.repeat(40), digest: treeDigest(html), hadHtml: true })
  createSitePublisher(root)
  assert.equal(JSON.parse(readFileSync(join(root, 'source.json'), 'utf8')).gitCommit, 'b'.repeat(40))
  assert.equal(existsSync(join(root, '.maintenance')), false)
  atomicJson(join(root, '.publish-intent.json'), { gitCommit: 'c'.repeat(40), digest: 'invalid', hadHtml: false })
  createSitePublisher(root)
  assert.equal(existsSync(html), false)
  writeFileSync(join(root, '.maintenance'), 'cleanup interrupted after finalizing intent')
  createSitePublisher(root)
  assert.equal(existsSync(join(root, '.maintenance')), false)
})

test('independent socket worker builds real VitePress formal and isolated preview sites', async t => {
  const f = fixture(t), runtime = createBuildRuntime({ ...f, roots: {}, socketPath: join(f.root, 'worker.sock') })
  const snapshot = captureSnapshot({ ...f, roots: {}, buildsRoot: join(f.buildsRoot, 'snapshots') })
  const job = runtime.coordinator.enqueue({ ...snapshot, project: 'ci', mode: 'formal' })
  const controller = new AbortController()
  let worker
  try {
    await runtime.start()
    worker = runBuildWorker({ socketPath: join(f.root, 'worker.sock'), buildsRoot: f.buildsRoot, sourceRoot: repo, signal: controller.signal, heartbeatMs: 100 })
    async function finished(id) {
      const deadline = Date.now() + 120000
      while (Date.now() < deadline) {
        const state = runtime.coordinator.get(id)
        if (['succeeded', 'failed'].includes(state.state)) return state
        await delay(30)
      }
      const current = runtime.coordinator.get(id)
      const log = join(f.buildsRoot, 'attempts', id, current.claimToken, 'build.log')
      assert.fail('Build worker did not settle in time: ' + JSON.stringify(current) + (existsSync(log) ? readFileSync(log, 'utf8') : ''))
    }
    const result = await finished(job.id)
    assert.equal(result.state, 'succeeded', result.error)
    const page = join(f.projectRoot, 'data/wiki-site/html/ci/doc/requirements/req-ci-001.html')
    assert.ok(existsSync(page))
    assert.match(readFileSync(page, 'utf8'), new RegExp(job.gitCommit))
    const preview = runtime.preview('ci', 'CR-PREVIEW', f.wikiRoot)
    const built = await finished(preview.id)
    assert.equal(built.state, 'succeeded', built.error)
    const html = readFileSync(join(f.projectRoot, 'data/wiki-previews', preview.id, 'index.html'), 'utf8')
    assert.match(html, /预览，未发布/)
    assert.match(html, new RegExp('/wiki-preview/' + preview.id + '/'))
    assert.ok(runtime.coordinator.accessible(preview.id))
    runtime.coordinator.cancel(preview.id)
    assert.equal(runtime.coordinator.accessible(preview.id), false)
    assert.equal(f.git(['rev-parse', 'HEAD']), job.gitCommit)
    assert.equal(f.git(['status', '--porcelain']), '')
    assert.equal(readFileSync(page, 'utf8').includes('/wiki-preview/'), false)
  } finally { controller.abort(); if (worker) await worker; runtime.close() }
})
