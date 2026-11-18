import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir, hostname } from 'node:os'
import { join } from 'node:path'
import { readRegularFile } from '../safe-files.mjs'
import { toolchainIdentity } from '../build-toolchain.mjs'
import { createBuildJobStore } from '../build-job-store.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'secure-files-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

test('regular-file reads reject symlinks and directories', t => {
  const root = fixture(t), file = join(root, 'content')
  writeFileSync(file, 'expected'); symlinkSync(file, join(root, 'link'))
  assert.equal(readRegularFile(file, 'utf8'), 'expected')
  assert.throws(() => readRegularFile(join(root, 'link')), { code: 'ELOOP' })
  assert.throws(() => readRegularFile(root), /Regular file/)
})

test('toolchain hashing is deterministic and rejects symbolic files and parent directories', t => {
  const root = fixture(t)
  for (const path of ['package-lock.json', 'contracts/schema.json', 'packages/wiki-core/file.mjs', 'packages/wiki-worker/file.mjs', 'wiki/package-lock.json', 'wiki/.vitepress/config.mjs', 'wiki/.vitepress/mermaid-markdown.mjs', 'wiki/.vitepress/theme/file.mjs', 'wiki/scripts/file.mjs']) {
    const target = join(root, path); mkdirSync(join(target, '..'), { recursive: true }); writeFileSync(target, '{}')
  }
  const digest = toolchainIdentity(root)
  assert.equal(toolchainIdentity(root), digest)
  symlinkSync(join(root, 'package-lock.json'), join(root, 'contracts/link'))
  assert.throws(() => toolchainIdentity(root), { code: 'ELOOP' })
  rmSync(join(root, 'contracts/link')); rmSync(join(root, 'contracts'), { recursive: true })
  symlinkSync(join(root, 'packages'), join(root, 'contracts'))
  assert.throws(() => toolchainIdentity(root), { code: 'ELOOP' })
})

test('coordinator stale-owner recovery preserves exclusive ownership and validates persisted job filenames', t => {
  const root = fixture(t)
  writeFileSync(join(root, '.coordinator.lock'), JSON.stringify({ host: hostname(), pid: 2147483647, start: 'dead' }))
  const store = createBuildJobStore(root)
  try {
    assert.throws(() => createBuildJobStore(root), { code: 'EEXIST' })
    assert.throws(() => store.save({ id: '../outside' }), /Invalid build job identity/)
    assert.deepEqual(store.list(), [])
  } finally { store.close() }
  const restarted = createBuildJobStore(root); restarted.close()
})

test('coordinator refuses a symbolic lock without reading or replacing its target', t => {
  const root = fixture(t), target = join(root, 'unrelated')
  writeFileSync(target, 'preserved'); symlinkSync(target, join(root, '.coordinator.lock'))
  assert.throws(() => createBuildJobStore(root), { code: 'ELOOP' })
  assert.equal(readRegularFile(target, 'utf8'), 'preserved')
})
