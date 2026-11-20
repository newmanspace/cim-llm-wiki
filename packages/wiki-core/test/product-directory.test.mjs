import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { directorySidebar } from '../product-directory.mjs'
import { bindFixture } from './support/document-fixture.mjs'
import { createDefaultsStore } from '../document-defaults.mjs'

function fixture(t) {
  const projectRoot = mkdtempSync(join(tmpdir(), 'project-navigation-'))
  t.after(() => rmSync(projectRoot, { recursive: true, force: true }))
  const wikiRoot = join(projectRoot, 'wiki')
  bindFixture(projectRoot, 'demo')
  mkdirSync(join(wikiRoot, 'demo/doc/requirements'), { recursive: true })
  writeFileSync(join(wikiRoot, 'demo/doc/requirements/req.md'), '---\nid: REQ-001\ntitle: Actual requirement\ntype: requirement\n---\n# Requirement\n')
  return { projectRoot, wikiRoot }
}

test('navigation uses Project directories without generated configuration or catalog pages', t => {
  const f = fixture(t)
  const tree = JSON.stringify(directorySidebar('demo', f.wikiRoot, f.projectRoot))
  assert.match(tree, /Actual requirement/)
  assert.match(tree, /\/demo\/doc\/requirements\/req/)
  assert.doesNotMatch(tree, /catalog/)
  writeFileSync(join(f.wikiRoot, 'demo/directory.json'), '{')
  assert.equal(JSON.stringify(directorySidebar('demo', f.wikiRoot, f.projectRoot)), tree)
})

test('navigation uses configured labels and supports unbound Markdown without applying authoring rules', t => {
  const f = fixture(t), store = createDefaultsStore(f.projectRoot)
  const directories = store.effective('demo').definition.directories.map(d => d.path === 'doc/40-requirements' ? { ...d, title: 'Project requirements' } : d)
  store.bind('demo', [], { directories }, undefined, true)
  assert.match(JSON.stringify(directorySidebar('demo', f.wikiRoot, f.projectRoot)), /Project requirements/)
  assert.deepEqual(directorySidebar('unbound', f.wikiRoot, f.projectRoot), [])
  mkdirSync(join(f.wikiRoot, 'unbound/doc/50-designs'), { recursive: true })
  writeFileSync(join(f.wikiRoot, 'unbound/doc/50-designs/design.md'), '# Existing design\n\nRenderable content.')
  const navigation = JSON.stringify(directorySidebar('unbound', f.wikiRoot, f.projectRoot))
  assert.match(navigation, /Existing design/)
  assert.match(navigation, /unbound\/doc\/50-designs\/design/)
})

test('navigation refuses symbolic links in content', t => {
  const f = fixture(t)
  symlinkSync(f.projectRoot, join(f.wikiRoot, 'demo/doc/linked'))
  assert.throws(() => directorySidebar('demo', f.wikiRoot, f.projectRoot), /Symbolic/)
})

test('bound projects include generic Markdown in its physical configured directory', t => {
  const f = fixture(t)
  mkdirSync(join(f.wikiRoot, 'demo/doc/40-requirements'), { recursive: true })
  writeFileSync(join(f.wikiRoot, 'demo/doc/40-requirements/functions.md'), '# SPC functions\n\nReviewed list.')
  const tree = JSON.stringify(directorySidebar('demo', f.wikiRoot, f.projectRoot))
  assert.match(tree, /SPC functions/)
  assert.match(tree, /demo\/doc\/40-requirements\/functions/)
  assert.equal((tree.match(/demo\/doc\/40-requirements\/functions/g) || []).length, 1)
})
