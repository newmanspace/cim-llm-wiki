import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { createProjectWiki } from '../../wiki-service/project-wiki.mjs'
import { createKnowledgeServer } from '../../wiki-service/server.mjs'
import { createBuildRuntime } from '../../wiki-service/build-runtime.mjs'
import { snapshotContext } from '../build-snapshot.mjs'
import { validateWiki } from '../validate.mjs'
import { compileBundle } from '../compile.mjs'
import { parsePage } from '../markdown.mjs'
const repo = fileURLToPath(new URL('../../../', import.meta.url))
function fixture(t, content = false) {
  const root = mkdtempSync(join(tmpdir(), 'project-wiki-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const projectRoot = join(root, 'state')
  if (content) execFileSync(process.execPath, [join(repo, 'scripts/ci-wiki-fixture.mjs'), projectRoot], { stdio: 'pipe' })
  const projects = createProjectWiki({ projectRoot })
  return { root, projectRoot, projects, wikiRoot: join(projectRoot, 'data/wiki') }
}
function populateProject(f) {
  f.projects.initialize('ci')
  cpSync(join(f.wikiRoot, 'ci'), f.projects.source('ci'), { recursive: true })
}
const git = (path, args) => execFileSync('git', ['-C', path, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim()

test('project storage validates boundaries and initializes independent Git without adopting existing files', t => {
  const { projects, projectRoot, root } = fixture(t)
  assert.equal(projects.status('one').initialized, false)
  assert.throws(() => projects.configure('one', { sourceDirectory: root }), /storage root/)
  assert.throws(() => projects.configure('one', { sourceDirectory: '../relative' }), /absolute path/)
  assert.throws(() => projects.configure('one', { sourceDirectory: join(projectRoot, 'data/projects/two/wiki') }), /its project/)
  assert.throws(() => projects.configure('one', { sourceDirectory: join(projectRoot, 'data/projects/one/site/nested') }), /outside site/)
  const custom = join(projectRoot, 'data/projects/one/markdown')
  projects.configure('one', { sourceDirectory: custom })
  const status = projects.initialize('one')
  assert.equal(status.gitStatus, 'clean')
  assert.equal(status.sourceDirectory, custom)
  assert.equal(status.siteUrl, '/wiki/one/')
  assert.equal(status.siteDirectory, join(projectRoot, 'data/projects/one/site/html'))
  assert.equal(git(custom, ['ls-files']), '.gitignore')
  assert.equal(projects.initialize('one').gitStatus, 'clean')
  assert.throws(() => projects.configure('one', { sourceDirectory: custom + '-new' }), /cannot be moved/)
  projects.configure('two', { sourceDirectory: join(projectRoot, 'data/projects/two/wiki') })
  const other = projects.source('two'); mkdirSync(other, { recursive: true }); writeFileSync(join(other, 'unreviewed.md'), '# Existing')
  assert.throws(() => projects.initialize('two'), /not empty/)
  assert.equal(existsSync(join(other, '.git')), false)
  const linked = join(projectRoot, 'data/projects/three'); symlinkSync(root, linked)
  assert.throws(() => projects.initialize('three'), /symbolic links/)
})

test('project snapshots isolate validation and dependencies from unrelated projects', t => {
  const f = fixture(t, true), source = f.projects.source('ci')
  populateProject(f)
  assert.deepEqual(validateWiki({ ...f, roots: {}, project: 'ci', sourceRoot: source }).errors, [])
  // Broken records belonging to other projects must not be resolved or frozen.
  const manifestPath = join(f.projectRoot, 'data/documents/manifest.json'), manifest = JSON.parse(readFileSync(manifestPath))
  manifest.docs.push({ project: 'broken', path: 'missing-other-source.md', state: 'active' }); writeFileSync(manifestPath, JSON.stringify(manifest))
  git(source, ['add', '.']); git(source, ['commit', '-m', 'Reviewed project sources'])
  const runtime = createBuildRuntime({ ...f, roots: {}, projectWikis: f.projects })
  t.after(() => runtime.close())
  const job = runtime.buildCurrent('ci')
  assert.equal(job.state, 'queued', JSON.stringify(job))
  const input = runtime.coordinator.get(job.id)
  const context = snapshotContext(join(f.projectRoot, 'data/wiki-builds/snapshots'), input.snapshot, input.digest)
  assert.equal(context.project, 'ci')
  assert.equal(existsSync(join(context.wikiRoot, 'broken')), false)
  assert.equal(JSON.parse(readFileSync(join(context.projectRoot, 'data/documents/manifest.json'))).docs.length, 1)
  assert.deepEqual(validateWiki(context).errors, [])
})

test('isolated compiler writes approved nodes to the configured checkout and keeps unrelated Wiki unchanged', async t => {
  const f = fixture(t, true), source = f.projects.source('ci')
  populateProject(f)
  const path = 'doc/requirements/req-ci-001.md', old = readFileSync(join(source, path), 'utf8'), page = parsePage(old)
  const result = await compileBundle({ schema_version: '1.0', bundle_id: 'isolated-update', project: 'ci', nodes: [{ ...page.fm, title: 'CI build requirement', content: page.body.replace(/^\s*# [^\n]+\n/, '') }] }, { projectRoot: f.projectRoot, wikiRoot: f.wikiRoot, sourceRoot: source, roots: {} })
  assert.equal(result.wikiEntries[0].path, 'data/projects/ci/wiki/' + path)
  assert.equal(readFileSync(join(f.wikiRoot, 'ci', path), 'utf8'), old)
  assert.deepEqual(validateWiki({ ...f, roots: {}, sourceRoot: source, project: 'ci' }).errors, [])
})

test('project Wiki HTTP operations require internal service authentication and ignore body project overrides', async t => {
  const f = fixture(t), token = 'private-service-' + 'x'.repeat(40)
  const server = createKnowledgeServer({ projectRoot: f.projectRoot, roots: {}, token: 'agent', ledgerToken: token, ledgerURL: 'http://127.0.0.1:1' })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close() })
  const url = `http://127.0.0.1:${server.address().port}/internal/project-wiki`
  assert.equal((await fetch(url + '?project=one', { headers: { Authorization: 'Bearer agent' } })).status, 403)
  const response = await fetch(url + '/initialize?project=one', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ project: 'two' }) })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).data.project, 'one')
  assert.equal(existsSync(join(f.projects.source('two'), '.git')), false)
  for (const [action, method] of [['inventory', 'GET'], ['migrate', 'POST'], ['archive', 'POST']]) {
    const removed = await fetch(url + '/' + action + '?project=one', { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: '{}' } : {}) })
    assert.equal(removed.status, 404, action)
  }
})

test('project worker builds a site with project base URLs and publishes only its project output', async t => {
  const f = fixture(t, true), source = f.projects.source('ci')
  populateProject(f)
  git(source, ['add', '.']); git(source, ['commit', '-m', 'Reviewed sources'])
  const { runBuildWorker } = await import('../../wiki-worker/server.mjs')
  const { setTimeout: delay } = await import('node:timers/promises')
  const runtime = createBuildRuntime({ ...f, roots: {}, projectWikis: f.projects, socketPath: join(f.root, 'worker.sock') })
  const controller = new AbortController()
  let worker
  try {
    await runtime.start()
    const job = runtime.buildCurrent('ci')
    assert.equal(job.state, 'queued', JSON.stringify(job))
    worker = runBuildWorker({ socketPath: join(f.root, 'worker.sock'), buildsRoot: join(f.projectRoot, 'data/wiki-builds'), sourceRoot: repo, signal: controller.signal, heartbeatMs: 100 })
    const deadline = Date.now() + 120000
    let result
    do {
      result = runtime.coordinator.get(job.id)
      if (['succeeded', 'failed'].includes(result.state)) break
      await delay(50)
    } while (Date.now() < deadline)
    assert.equal(result.state, 'succeeded', result.error || JSON.stringify(result))
    assert.equal(result.result.siteUrl, '/wiki/ci/')
    const output = f.projects.status('ci').siteDirectory
    assert.ok(existsSync(join(output, 'doc/requirements/req-ci-001.html')))
    const home = readFileSync(join(output, 'index.html'), 'utf8')
    assert.match(home, /\/wiki\/ci\/assets\//)
    assert.doesNotMatch(home, /\/wiki\/ci\/ci\//)
    assert.equal(f.projects.status('ci').gitStatus, 'clean')
    assert.equal(existsSync(join(f.projectRoot, 'data/wiki-site/html')), false)
  } finally { controller.abort(); if (worker) await worker; runtime.close() }
})

test('new project binding applies a custom source directory before initializing its Git repository', async t => {
  const f = fixture(t, true), token = 'service-' + 'z'.repeat(40)
  const source = join(f.projectRoot, 'data/projects/new-project/markdown')
  const server = createKnowledgeServer({ projectRoot: f.projectRoot, roots: {}, token: 'agent', ledgerToken: token, ledgerURL: 'http://127.0.0.1:1' })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close() })
  const response = await fetch(`http://127.0.0.1:${server.address().port}/internal/document-defaults/bind`, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'X-Settings-Actor': 'Administrator', 'Content-Type': 'application/json' }, body: JSON.stringify({ project: 'new-project', name: 'New project', product_version: 'V1', modules: [], wiki_source_directory: source }) })
  assert.equal(response.status, 200, JSON.stringify(await response.json()))
  assert.equal(existsSync(join(source, '.git')), true)
  assert.equal(existsSync(join(source, 'document-contract.json')), true)
  assert.equal(existsSync(join(source, 'directory.json')), true)
  assert.equal(existsSync(join(f.projectRoot, 'data/projects/new-project/wiki')), false)
  assert.equal(f.projects.status('new-project').sourceDirectory, source)
})
