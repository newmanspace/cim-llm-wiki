import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertBuildInput } from '../build-validation.mjs'
import { collectLocalPackage } from '../local-package.mjs'
import { createDocumentUploads } from '../../wiki-service/document-uploads.mjs'

function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'file-read-races-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

// Swap the final path after a successful inspection but before its caller reads it.
function replaceAfterStat(t, target, replacement, occurrence = 1) {
  const original = fs.lstatSync
  let visits = 0
  const mock = t.mock.method(fs, 'lstatSync', (path, ...args) => {
    const result = original(path, ...args)
    if (path === target && ++visits === occurrence) {
      fs.unlinkSync(target)
      fs.symlinkSync(replacement, target)
    }
    return result
  })
  syncBuiltinESMExports()
  t.after(() => {
    mock.mock.restore()
    syncBuiltinESMExports()
  })
}

test('build validation rejects a file replaced by a symlink after inspection', (t) => {
  const root = fixture(t),
    wikiRoot = join(root, 'wiki')
  fs.mkdirSync(wikiRoot)
  const page = join(wikiRoot, 'index.md'),
    outside = join(root, 'outside.md')
  fs.writeFileSync(page, '# Accepted')
  fs.writeFileSync(outside, '# Outside')
  replaceAfterStat(t, page, outside)
  assert.throws(() => assertBuildInput({ wikiRoot }), /ELOOP/)
})

test('local collection rejects a file replaced after its final path inspection', (t) => {
  const root = fixture(t),
    packageRoot = join(root, 'package')
  fs.mkdirSync(packageRoot)
  const page = join(packageRoot, 'document.md'),
    outside = join(root, 'outside.md')
  fs.writeFileSync(page, '# Accepted')
  fs.writeFileSync(outside, '# Outside')
  replaceAfterStat(t, page, outside, 2)
  assert.throws(() => collectLocalPackage(packageRoot, 'document.md'), /ELOOP/)
})

test('upload reads reject symbolic metadata and content without changing their targets', (t) => {
  const root = fixture(t),
    store = createDocumentUploads({ projectRoot: root, roots: {} })
  const bytes = Buffer.from('# Original'),
    uploaded = store.put('demo', 'document.md', bytes)
  const content = store.file('demo', uploaded.uri).path
  const outside = join(root, 'outside.md')
  fs.writeFileSync(outside, bytes)
  fs.unlinkSync(content)
  fs.symlinkSync(outside, content)
  assert.throws(() => store.file('demo', uploaded.uri), /missing or changed/)
  assert.throws(() => store.put('demo', 'document.md', bytes), /missing or changed/)
  assert.deepEqual(fs.readFileSync(outside), bytes)

  const metadata = join(root, 'data/document-uploads/demo', uploaded.uri.slice(11) + '.file.json')
  const outsideMetadata = join(root, 'outside.json'),
    metadataBytes = fs.readFileSync(metadata)
  fs.writeFileSync(outsideMetadata, metadataBytes)
  fs.unlinkSync(metadata)
  fs.symlinkSync(outsideMetadata, metadata)
  assert.throws(() => store.file('demo', uploaded.uri), /not found/)
  assert.deepEqual(fs.readFileSync(outsideMetadata), metadataBytes)
})
