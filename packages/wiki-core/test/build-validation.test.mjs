import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateBuildInput, assertBuildInput } from '../build-validation.mjs'

function fixture(t) {
  const wikiRoot = mkdtempSync(join(tmpdir(), 'build-validation-'))
  t.after(() => rmSync(wikiRoot, { recursive: true, force: true }))
  return { wikiRoot }
}

test('build accepts ordinary Markdown and outdated authoring metadata without a template binding', t => {
  const f = fixture(t)
  writeFileSync(join(f.wikiRoot, 'index.md'), '# Existing page\n\nContent with no document information table.')
  writeFileSync(join(f.wikiRoot, 'old.md'), '---\nschema_version: old\nreviewer: 待指定\n---\n# Existing design\n\nNo newly required sections.')
  assert.equal(assertBuildInput(f).scanned, 2)
})

test('build rejects active document code, malformed YAML and symbolic links', t => {
  const f = fixture(t), page = join(f.wikiRoot, 'index.md')
  for (const content of ['<script>alert(1)</script>', '# Unsafe\n\n{{ process.env.SECRET }}']) {
    writeFileSync(page, content)
    assert.throws(() => assertBuildInput(f), /active_content/)
  }
  writeFileSync(page, '---\ntitle: Unsafe footer\n---\n# Page\n\n---\n> **来源文档**: <script>alert(1)</script>\n> **置信度**: 1\n> **适用版本**: v1\n')
  assert.throws(() => assertBuildInput(f), /active_content/)
  writeFileSync(page, '---\nhead:\n  - [script, {src: "https://example.test/execute.js"}]\n---\n# Unsafe metadata')
  assert.throws(() => assertBuildInput(f), /active_content/)
  writeFileSync(page, '---\ntitle: [\n---\n# Invalid')
  assert.throws(() => assertBuildInput(f), /frontmatter_error/)
  writeFileSync(page, '# Valid\n\n```html\n<script>example</script>\n```')
  symlinkSync(page, join(f.wikiRoot, 'linked.md'))
  assert.throws(() => assertBuildInput(f), /unsafe_path/)
})

test('build validates only its selected project and reports missing inputs', t => {
  const f = fixture(t)
  for (const project of ['one', 'two']) mkdirSync(join(f.wikiRoot, project))
  writeFileSync(join(f.wikiRoot, 'one/index.md'), '# One')
  writeFileSync(join(f.wikiRoot, 'two/index.md'), '<script>unsafe</script>')
  assert.equal(assertBuildInput({ ...f, project: 'one' }).scanned, 1)
  assert.throws(() => assertBuildInput({ ...f, project: '../two' }), /Invalid build project/)
  assert.equal(validateBuildInput({ ...f, project: 'missing' }).errors[0].code, 'wiki_missing')
  assert.equal(assertBuildInput({ ...f, sourceRoot: join(f.wikiRoot, 'one'), project: 'one' }).scanned, 1)
})

test('VitePress includes cannot introduce unvalidated files, even through fenced examples', t => {
  const f = fixture(t)
  for (const content of [
    '# Page\n\n<!--@include: ../outside.md-->',
    '# Page\n\n<!-- @include: @/inside.md -->',
    '# Page\n\n<!-- @include: ../outside>secret.txt -->',
    '# Example\n\n```md\n<!-- @include: ../outside>secret.txt -->\n```',
    '# Example\n\n```md\n<!--@include: ../outside.md-->\n```',
  ]) {
    writeFileSync(join(f.wikiRoot, 'index.md'), content)
    assert.throws(() => assertBuildInput(f), /external_include/)
  }
})
