import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { createWikiSource } from '../../wiki-service/wiki-source.mjs'
const run = (root, args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim()
function fixture(t) {
  const projectRoot = mkdtempSync(join(tmpdir(), 'reviewed-source-')), root = join(projectRoot, 'wiki')
  mkdirSync(root); t.after(() => rmSync(projectRoot, { recursive: true, force: true }))
  run(root, ['init', '-b', 'main']); run(root, ['config', 'user.name', 'Reviewer']); run(root, ['config', 'user.email', 'reviewer@example.test'])
  writeFileSync(join(root, 'README.md'), '# Existing'); run(root, ['add', '.']); run(root, ['commit', '-m', 'Baseline'])
  const sources = createWikiSource({ projectRoot, sourceFor: () => root })
  const artifact = { id: '3', version: 1, content_sha256: 'a'.repeat(64) }, task = { id: '5' }
  const add = (id, path, text) => sources.materialize('demo', { ...artifact, id }, task, [{ path, bytes: Buffer.from(text) }])
  return { root, sources, add }
}
test('reviewed files remain uncommitted until the exact successful build is finalized on its current branch', t => {
  const f = fixture(t), baseline = run(f.root, ['rev-parse', 'HEAD'])
  f.add('3', 'doc/list.md', '# Function list')
  assert.equal(run(f.root, ['rev-parse', 'HEAD']), baseline)
  const build = f.sources.prepare('demo'); t.after(build.cleanup)
  assert.equal(readFileSync(join(build.candidate, 'doc/list.md'), 'utf8'), '# Function list')
  assert.equal(run(f.root, ['rev-parse', 'HEAD']), baseline)
  // Another approval and an unrelated staged edit arrive after the snapshot.
  f.add('4', 'doc/later.md', '# Next build')
  writeFileSync(join(f.root, 'README.md'), '# Local change'); run(f.root, ['add', 'README.md'])
  const sha = f.sources.commit('demo', build.plan)
  assert.equal(sha, build.plan.gitCommit)
  assert.equal(run(f.root, ['symbolic-ref', '--short', 'HEAD']), 'main')
  assert.equal(run(f.root, ['show', 'HEAD:README.md']), '# Existing')
  assert.equal(run(f.root, ['diff', '--cached', '--name-only']), 'README.md')
  assert.match(run(f.root, ['status', '--porcelain']), /doc\/later.md/)
  assert.equal(f.sources.commit('demo', build.plan), sha)
  f.sources.published('demo', sha)
  assert.equal(f.sources.status('demo').find(r => r.artifactId === '3').state, 'published')
  assert.equal(f.sources.status('demo').find(r => r.artifactId === '4').state, 'written')
})
test('failed or abandoned builds leave the branch untouched and can reuse reviewed input', t => {
  const f = fixture(t), before = run(f.root, ['rev-parse', 'HEAD'])
  f.add('3', 'doc/list.md', '# Function list')
  const build = f.sources.prepare('demo'); build.cleanup()
  assert.equal(run(f.root, ['rev-parse', 'HEAD']), before)
  assert.equal(readFileSync(join(f.root, 'doc/list.md'), 'utf8'), '# Function list')
  const retry = f.sources.prepare('demo'); t.after(retry.cleanup)
  assert.equal(f.sources.commit('demo', retry.plan), retry.plan.gitCommit)
})
test('publication updates receipts even when their reviewed bytes are already committed', t => {
  const f = fixture(t)
  f.add('3', 'README.md', '# Existing')
  const build = f.sources.prepare('demo'); t.after(build.cleanup)
  assert.equal(build.plan, null)
  assert.equal(f.sources.status('demo')[0].state, 'written')
  const sha = run(f.root, ['rev-parse', 'HEAD'])
  f.sources.published('demo', sha)
  assert.equal(f.sources.status('demo')[0].state, 'published')
  assert.equal(f.sources.status('demo')[0].gitCommit, sha)
})
test('source drift and branch changes prevent committing output from an older snapshot', t => {
  const f = fixture(t); f.add('3', 'doc/list.md', '# Function list')
  const build = f.sources.prepare('demo'); t.after(build.cleanup)
  writeFileSync(join(f.root, 'doc/list.md'), '# Changed by editor')
  assert.throws(() => f.sources.commit('demo', build.plan), /source changed during build/)
  assert.throws(() => f.sources.prepare('demo'), /uncommitted changes outside approved/)
  writeFileSync(join(f.root, 'doc/list.md'), '# Function list'); run(f.root, ['switch', '-c', 'other'])
  assert.throws(() => f.sources.commit('demo', build.plan), /branch changed/)
})
test('imports preserve bytes and attachments, reject collisions and symlink escapes, and allow idempotent retries', t => {
  const f = fixture(t)
  f.sources.materialize('demo', { id: '3', version: 1, content_sha256: 'a'.repeat(64) }, { id: '5' }, [{ path: 'doc/list.md', bytes: Buffer.from('# List\n\n![Image](img/a.png)') }, { path: 'doc/img/a.png', bytes: Buffer.from([0, 1, 2]) }])
  assert.deepEqual(readFileSync(join(f.root, 'doc/img/a.png')), Buffer.from([0, 1, 2]))
  f.add('3', 'doc/list.md', '# List\n\n![Image](img/a.png)')
  writeFileSync(join(f.root, 'README.md'), '# Local edit')
  assert.throws(() => f.add('8', 'README.md', '# Replacement'), /Uncommitted|source write failed/)
  mkdirSync(join(f.root, 'links')); symlinkSync(dirname(f.root), join(f.root, 'links/out'))
  assert.throws(() => f.add('9', 'links/out/escape.md', 'escape'), /Unsafe Wiki source/)
})

test('an older pending approval cannot be built after a newer document version supersedes it', t => {
  const f = fixture(t)
  f.sources.materialize('demo', { id: '3', version: 1, logical_key: 'document', content_sha256: 'a'.repeat(64) }, { id: '5' }, [{ path: 'doc/list.md', bytes: Buffer.from('# Version one') }])
  assert.throws(() => f.sources.assertEligible('demo', new Set()), /approval is no longer current/)
  f.sources.materialize('demo', { id: '4', version: 2, logical_key: 'document', content_sha256: 'b'.repeat(64) }, { id: '6' }, [{ path: 'doc/list.md', bytes: Buffer.from('# Version two') }])
  f.sources.assertEligible('demo', new Set(['4']))
  const build = f.sources.prepare('demo'); t.after(build.cleanup)
  assert.equal(readFileSync(join(build.candidate, 'doc/list.md'), 'utf8'), '# Version two')
})

test('the build view excludes unrelated ignored files and includes explicitly reviewed ignored paths', t => {
  const f = fixture(t)
  writeFileSync(join(f.root, '.gitignore'), '*.secret\nignored/\n')
  run(f.root, ['add', '.gitignore']); run(f.root, ['commit', '-m', 'Ignore local files'])
  writeFileSync(join(f.root, 'local.secret'), 'private data')
  f.add('3', 'ignored/list.md', '# Approved ignored path')
  const build = f.sources.prepare('demo'); t.after(build.cleanup)
  assert.equal(readFileSync(join(build.candidate, 'ignored/list.md'), 'utf8'), '# Approved ignored path')
  assert.throws(() => readFileSync(join(build.candidate, 'local.secret')), /ENOENT/)
  assert.equal(f.sources.commit('demo', build.plan), build.plan.gitCommit)
  const unchanged = f.sources.prepare('demo'); t.after(unchanged.cleanup)
  assert.equal(unchanged.plan, null)
  assert.throws(() => readFileSync(join(unchanged.candidate, 'local.secret')), /ENOENT/)
})
