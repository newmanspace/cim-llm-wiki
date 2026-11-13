import { builtinDefaults } from '../document-defaults.mjs'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initializeDirectory, readDirectory, updateDirectory, directorySidebar, validateDirectories, directoryPageKey } from '../product-directory.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'product-directory-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const options = { wikiRoot: join(root, 'wiki') }
  mkdirSync(options.wikiRoot)
  const input = { directories:builtinDefaults().directories.map(({node_types,...d})=>({...d,...(node_types.length?{match:{types:node_types}}:{})})), project: 'spc', name: 'SPC', version: '4.0', modules: ['control-chart'], delivery_contract: {
    schema_version: '1.0', project: 'spc', documents: [{ id: 'req', type: 'requirement', scope: 'project', min: 1 }],
  } }
  return { root, options, input }
}

test('initialization creates the standard tree and protects existing contracts and directory pages', t => {
  const f = fixture(t)
  const config = initializeDirectory(f.input, f.options)
  assert.equal(config.revision, 1)
  assert.ok(config.directories.some(d => d.path === 'doc/99-templates'))
  assert.ok(config.directories.some(d => d.path === 'doc/40-requirements'))
  assert.ok(config.directories.some(d => d.path === 'code/apis'))
  assert.ok(!config.directories.some(d => /(version|module|feature)-template/.test(d.path)))
  assert.deepEqual(validateDirectories(f.options.wikiRoot), [])
  const contract = readFileSync(join(f.options.wikiRoot, 'spc/document-contract.json'), 'utf8')
  assert.throws(() => initializeDirectory(f.input, f.options), /already initialized/)
  assert.equal(readFileSync(join(f.options.wikiRoot, 'spc/document-contract.json'), 'utf8'), contract)
  writeFileSync(join(f.options.wikiRoot, directoryPageKey('spc', 'doc/99-templates')), '# Unreviewed page')
  assert.ok(validateDirectories(f.options.wikiRoot).some(e => e.code === 'directory_page_drift'))
})

test('directory updates use revision checks and map actual nodes without moving their files', t => {
  const f = fixture(t); const config = initializeDirectory(f.input, f.options)
  const updated = updateDirectory({ project: 'spc', expected_revision: 1, directories: [...config.directories,
    { path: 'custom', title: 'Custom', description: 'Custom directory', match: { types: ['requirement'], version: '4.0' } },
  ] }, f.options)
  assert.equal(updated.revision, 2)
  assert.throws(() => updateDirectory({ project: 'spc', expected_revision: 1, directories: config.directories }, f.options), /revision/)
  mkdirSync(join(f.options.wikiRoot, 'spc/doc/requirements'), { recursive: true })
  writeFileSync(join(f.options.wikiRoot, 'spc/doc/requirements/req-001.md'), '---\nid: REQ-001\ntitle: Actual requirement\ntype: requirement\nversion: "4.0"\nmodule: control-chart\n---\n\n# Requirement\n')
  const sidebar = directorySidebar('spc', f.options.wikiRoot)
  assert.ok(JSON.stringify(sidebar).includes('/spc/doc/requirements/req-001'))
  assert.ok(JSON.stringify(sidebar).includes('Custom'))
  assert.equal(readDirectory('spc', f.options).revision, 2)
  assert.deepEqual(validateDirectories(f.options.wikiRoot), [])
})

test('unsafe paths, orphan directories, altered contracts and symlink targets are rejected', t => {
  const f = fixture(t)
  assert.throws(() => initializeDirectory({ ...f.input, project: '../escape' }, f.options), /identifier/)
  assert.throws(() => initializeDirectory({ ...f.input, delivery_contract: {} }, f.options), /contract/)
  initializeDirectory(f.input, f.options)
  for (const entry of [
    { path: '../escape', title: 'Bad', description: '' },
    { path: 'missing/child', title: 'Bad', description: '' },
    { path: 'new', title: '<script>bad</script>', description: '' },
    { path: 'new', title: 'Bad', description: '', match: { types: ['invented'] } },
  ]) assert.throws(() => updateDirectory({ project: 'spc', expected_revision: 1, directories: [entry] }, f.options))
  mkdirSync(join(f.options.wikiRoot, 'spc/catalog/unexpected'))
  writeFileSync(join(f.options.wikiRoot, 'spc/catalog/unexpected/index.md'), '# Unreviewed')
  assert.ok(validateDirectories(f.options.wikiRoot).some(e => e.code === 'directory_page_extra'))
  const external = join(f.root, 'outside'); mkdirSync(external)
  symlinkSync(external, join(f.options.wikiRoot, 'escape'))
  assert.throws(() => initializeDirectory({ ...f.input, project: 'escape', delivery_contract: { ...f.input.delivery_contract, project: 'escape' } }, f.options), /[Ss]ymbolic/)
})

test('a failed directory configuration replacement restores the previous tree and revision', t => {
  const f = fixture(t)
  const original = initializeDirectory(f.input, f.options)
  const rename = fs.renameSync
  let failed = false
  t.mock.method(fs, 'renameSync', (source, target) => {
    if (target.endsWith('/directory.json') && !failed) {
      failed = true
      throw new Error('Simulated configuration replacement failure')
    }
    return rename(source, target)
  })
  syncBuiltinESMExports()
  try {
    assert.throws(() => updateDirectory({ project: 'spc', expected_revision: 1, directories: original.directories.map(d => ({ ...d, title: 'Changed' })) }, f.options), /Simulated/)
    assert.equal(failed, true)
    assert.deepEqual(readDirectory('spc', f.options), original)
    assert.deepEqual(validateDirectories(f.options.wikiRoot), [])
  } finally {
    t.mock.restoreAll()
    syncBuiltinESMExports()
  }
})
