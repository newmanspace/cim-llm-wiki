import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { stringify } from 'yaml'
import { validateWiki } from '../validate.mjs'
import { compileBundle } from '../compile.mjs'
import { PROJECT_ROOT } from '../contracts.mjs'
import { commitWiki } from '../wiki-gitops.mjs'

function fixture(t) {
  const projectRoot = mkdtempSync(join(tmpdir(), 'wiki-core-test-'))
  t.after(() => rmSync(projectRoot, { recursive: true, force: true }))
  const wikiRoot = join(projectRoot, 'data/wiki')
  mkdirSync(wikiRoot, { recursive: true })
  defaultDocumentContract(wikiRoot, 'a')
  return { projectRoot, wikiRoot }
}

function defaultDocumentContract(wikiRoot, project) {
  const path = join(wikiRoot, project, 'document-contract.json')
  mkdirSync(join(path, '..'), { recursive: true })
  try {
    writeFileSync(
      path,
      JSON.stringify({
        schema_version: '1.0',
        project,
        documents: [
          { id: 'requirements', type: 'requirement', scope: 'project', min: 0 },
        ],
      }),
      { flag: 'wx' },
    )
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
}

const metadata = () => ({
  schema_version: '1.0',
  id: 'REQ-TEST-001',
  type: 'requirement',
  plane: 'doc',
  product: 'Test',
  version: 'v1',
  domain: 'test',
  module: 'test',
  source: 'source.md',
  status: 'published',
  confidence: 0.96,
  review_level: 'L0_auto',
  reviewer: 'auto',
  created_at: '2026-10-28T00:00:00Z',
  updated_at: '2026-10-28T00:00:00Z',
})

function page(
  f,
  fm = metadata(),
  body = '# Requirement\n\nA concrete requirement.\n',
  path = 'a/doc/requirements/req-test-001.md',
) {
  if (path.includes('/'))
    defaultDocumentContract(f.wikiRoot, path.split('/')[0])
  const dest = join(f.wikiRoot, path)
  mkdirSync(join(dest, '..'), { recursive: true })
  writeFileSync(dest, `---\n${stringify(fm)}---\n\n${body}`)
  return dest
}

function manifest(f, value, project = '') {
  const dir = join(f.wikiRoot, project, 'templates')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'manifest.json'),
    typeof value === 'string' ? value : JSON.stringify(value),
  )
}

const codes = (r) => r.errors.map((e) => e.code)

test('a valid node passes; unknown types, malformed values and missing version fail', (t) => {
  const f = fixture(t)
  page(f)
  assert.deepEqual(validateWiki(f).errors, [])
  for (const change of [
    { type: 'unknown' },
    { status: 'invalid' },
    { confidence: 'NaN' },
    { confidence: 1.1 },
    { updated_at: 'yesterday' },
    { related_apis: 'wrong' },
    { schema_version: '9' },
  ]) {
    page(f, { ...metadata(), ...change })
    assert.ok(
      codes(validateWiki(f)).includes('schema_error'),
      JSON.stringify(change),
    )
  }
  const fm = metadata()
  delete fm.schema_version
  page(f, fm)
  assert.ok(codes(validateWiki(f)).includes('schema_error'))
})

test('duplicate YAML keys and invalid YAML fail closed', (t) => {
  const f = fixture(t)
  const dest = page(f)
  writeFileSync(
    dest,
    readFileSync(dest, 'utf8').replace(
      'type: requirement',
      'type: requirement\ntype: api',
    ),
  )
  assert.ok(codes(validateWiki(f)).includes('frontmatter_error'))
})

test('required sections cannot be faked with fenced code, comments or inline text', (t) => {
  const f = fixture(t)
  manifest(f, {
    version: 1,
    templates: { requirement: { requiredSections: ['## Acceptance'] } },
  })
  for (const body of [
    '# Test\n\n```md\n## Acceptance\ntext\n```',
    '# Test\n\n<!--\n## Acceptance\ntext\n-->',
    '# Test\n\nMention ## Acceptance here.',
  ]) {
    page(f, metadata(), body)
    assert.ok(codes(validateWiki(f)).includes('section_missing'))
  }
  page(f, metadata(), '# Test\n\n## Acceptance\n\nSpecific expected behavior.')
  assert.deepEqual(validateWiki(f).errors, [])
})

test('empty and duplicated sections and malformed heading levels fail', (t) => {
  const f = fixture(t)
  manifest(f, {
    version: 1,
    templates: { requirement: { requiredSections: ['## Acceptance'] } },
  })
  page(f, metadata(), '# Test\n\n## Acceptance\n')
  assert.ok(codes(validateWiki(f)).includes('section_empty'))
  page(f, metadata(), '# Test\n\n## Acceptance\nA\n\n## Acceptance\nB')
  assert.ok(codes(validateWiki(f)).includes('section_duplicate'))
  page(f, metadata(), '# Test\n\n#### Jump\ntext')
  assert.ok(codes(validateWiki(f)).includes('heading_level'))
})

test('a document containing only its title cannot publish', (t) => {
  const f = fixture(t)
  page(f, metadata(), '# Title only\n')
  assert.ok(codes(validateWiki(f)).includes('document_empty'))
})

test('corrupt template manifests fail; project overrides cannot relax global or builtin rules', (t) => {
  const f = fixture(t)
  page(f)
  manifest(f, '{broken JSON')
  assert.ok(codes(validateWiki(f)).includes('template_contract_error'))
  manifest(f, {
    version: 1,
    templates: { requirement: { requiredSections: ['## Acceptance'] } },
  })
  manifest(
    f,
    { version: 1, templates: { requirement: { requiredSections: [] } } },
    'a',
  )
  assert.ok(codes(validateWiki(f)).includes('section_missing'))
  manifest(
    f,
    {
      version: 1,
      templates: { requirement: { plane: 'code', dir: 'code/apis' } },
    },
    'a',
  )
  assert.ok(codes(validateWiki(f)).includes('template_contract_error'))
})

test('builtin API structure is mandatory without a custom manifest', (t) => {
  const f = fixture(t)
  page(
    f,
    {
      ...metadata(),
      id: 'API-TEST-001',
      type: 'api',
      plane: 'code',
      api_type: 'ui_api',
    },
    '# API\n\nNo sections.',
    'a/code/apis/api-test-001.md',
  )
  assert.ok(codes(validateWiki(f)).includes('section_missing'))
})

test('required table columns are checked structurally', (t) => {
  const f = fixture(t)
  manifest(f, {
    version: 1,
    templates: {
      requirement: {
        requiredSections: ['## Acceptance'],
        tables: [{ section: '## Acceptance', columns: ['Case', 'Expected'] }],
      },
    },
  })
  page(
    f,
    metadata(),
    '# Test\n\n## Acceptance\n\n| Case | Wrong |\n|---|---|\n| 1 | pass |',
  )
  assert.ok(codes(validateWiki(f)).includes('table_columns'))
  page(
    f,
    metadata(),
    '# Test\n\n## Acceptance\n\n| Case | Expected |\n|---|---|',
  )
  assert.ok(codes(validateWiki(f)).includes('table_columns'))
  page(
    f,
    metadata(),
    '# Test\n\n## Acceptance\n\n| Case | Expected |\n|---|---|\n| 1 | pass |',
  )
  assert.deepEqual(validateWiki(f).errors, [])
})

test('duplicate IDs, wrong paths, broken Markdown and wiki links fail', (t) => {
  const f = fixture(t)
  page(
    f,
    metadata(),
    '# Test\n\n[[doc/requirements/missing.md]]\n\n[Broken](missing.md)',
  )
  assert.ok(codes(validateWiki(f)).includes('broken_link'))
  page(f)
  page(f, metadata(), '# Duplicate\n\nText.', 'a/doc/requirements/other.md')
  const errors = codes(validateWiki(f))
  assert.ok(errors.includes('duplicate_id'))
  assert.ok(errors.includes('filename_mismatch'))
})

test('template and manual directories cannot hide malformed knowledge nodes', (t) => {
  const f = fixture(t)
  page(f, metadata(), '# Hidden\n\nText.', 'a/doc/manuals/req-test-001.md')
  assert.ok(validateWiki(f).errors.length > 0)
})

const bundle = () => ({
  schema_version: '1.0',
  bundle_id: 'test-bundle',
  project: 'a',
  nodes: [
    { ...metadata(), title: 'Requirement', content: 'A concrete requirement.' },
  ],
})

test('compilation validates the entire candidate tree before any published data changes', async (t) => {
  const f = fixture(t)
  const dest = page(f)
  const before = readFileSync(dest, 'utf8')
  const b = bundle()
  b.nodes[0].content = '[[doc/requirements/missing.md]]'
  await assert.rejects(compileBundle(b, f), /broken_link/)
  assert.equal(readFileSync(dest, 'utf8'), before)
  assert.equal(
    existsSync(join(f.projectRoot, 'data/documents/api-registry.json')),
    false,
  )
})

test('valid compilation writes schema version and updates only its project', async (t) => {
  const f = fixture(t)
  const reg = join(f.projectRoot, 'data/documents/project-registry.json')
  mkdirSync(join(reg, '..'), { recursive: true })
  writeFileSync(reg, JSON.stringify({ projects: { a: {}, b: {} } }))
  defaultDocumentContract(f.wikiRoot, 'b')
  await compileBundle(bundle(), f)
  assert.deepEqual(validateWiki(f).errors, [])
  assert.match(
    readFileSync(
      join(f.wikiRoot, 'a/doc/requirements/req-test-001.md'),
      'utf8',
    ),
    /schema_version: ['"]?1\.0/,
  )
  const projects = JSON.parse(readFileSync(reg, 'utf8')).projects
  assert.equal(projects.a.wiki_nodes.doc.length, 1)
  assert.equal(projects.b.wiki_nodes, undefined)
})

test('invalid nodes, ambiguous or escaping projects and duplicate bundle IDs are rejected', async (t) => {
  const f = fixture(t)
  for (const modify of [
    (b) => {
      b.project = '../outside'
    },
    (b) => {
      b.project = ''
    },
    (b) => {
      b.nodes.push({ ...b.nodes[0] })
    },
    (b) => {
      b.nodes[0].content = ''
    },
    (b) => {
      b.nodes[0].type = 'unregistered'
    },
    (b) => {
      b.nodes[0].confidence = 2
    },
  ]) {
    const b = bundle()
    modify(b)
    await assert.rejects(compileBundle(b, f))
  }
  assert.deepEqual(validateWiki(f).errors, [])
})

test('preview validates but changes no pages or registries', async (t) => {
  const f = fixture(t)
  const result = await compileBundle(bundle(), { ...f, preview: true })
  assert.equal(result.preview, true)
  assert.equal(existsSync(join(f.wikiRoot, 'a/doc')), false)
  assert.equal(existsSync(join(f.projectRoot, 'data/documents')), false)
})

test('unrelated invalid existing documents also block a new publication', async (t) => {
  const f = fixture(t)
  page(
    f,
    { ...metadata(), schema_version: 'old' },
    '# Test\n\nText.',
    'b/doc/requirements/req-test-001.md',
  )
  await assert.rejects(compileBundle(bundle(), f), /schema_error/)
  assert.equal(existsSync(join(f.wikiRoot, 'a/doc')), false)
})

test('draft, expert nodes with automatic reviewers and source drift cannot publish', async (t) => {
  const f = fixture(t)
  for (const change of [
    { status: 'draft' },
    { status: 'pending' },
    { review_level: 'L1_expert', reviewer: 'auto' },
  ]) {
    const b = bundle()
    Object.assign(b.nodes[0], change)
    await assert.rejects(compileBundle(b, f))
  }
  const path = join(f.projectRoot, 'data/raw/source.md')
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, 'Original source')
  const manifestPath = join(f.projectRoot, 'data/documents/manifest.json')
  mkdirSync(join(manifestPath, '..'), { recursive: true })
  const manifest = {
    docs: [
      {
        path: 'data/raw/source.md',
        doc_id: 'source',
        state: 'frozen',
        sha256: createHash('sha256').update('Original source').digest('hex'),
        history: [],
        bundles: [],
      },
    ],
  }
  writeFileSync(manifestPath, JSON.stringify(manifest))
  writeFileSync(path, 'Drifted source')
  const b = bundle()
  b.nodes[0].source = 'data/raw/source.md'
  await assert.rejects(compileBundle(b, f), /doc_drift/)
  assert.equal(JSON.parse(readFileSync(manifestPath)).docs[0].state, 'frozen')
  writeFileSync(path, 'Original source')
  await compileBundle(b, f)
  assert.equal(JSON.parse(readFileSync(manifestPath)).docs[0].state, 'active')
})

test('wrong reference types and cross-project links fail', (t) => {
  const f = fixture(t)
  page(f, {
    ...metadata(),
    applies_to: ['[[doc/requirements/req-test-001.md]]'],
  })
  assert.ok(codes(validateWiki(f)).includes('reference_type'))
  page(
    f,
    metadata(),
    '# Test\n\n[Other project](../../../b/doc/requirements/req-test-001.md)',
  )
  page(f, metadata(), '# Other\n\nText.', 'b/doc/requirements/req-test-001.md')
  assert.ok(codes(validateWiki(f)).includes('broken_link'))
})

test('symlinks, corrupt unused project templates and knowledge hidden in root index fail', (t) => {
  const f = fixture(t)
  const dest = page(f)
  symlinkSync(dest, join(f.wikiRoot, 'hidden.md'))
  assert.ok(codes(validateWiki(f)).includes('unsafe_path'))
  rmSync(join(f.wikiRoot, 'hidden.md'))
  manifest(f, '{bad', 'unused')
  assert.ok(codes(validateWiki(f)).includes('template_contract_error'))
  rmSync(join(f.wikiRoot, 'unused'), { recursive: true })
  page(f, metadata(), '# Hidden\n\nText.', 'index.md')
  assert.ok(codes(validateWiki(f)).includes('homepage_schema'))
})

test('a second publisher is rejected while publication and its hooks hold the lock', async (t) => {
  const f = fixture(t)
  await compileBundle(bundle(), {
    ...f,
    afterPublish: async () => {
      await assert.rejects(
        compileBundle(bundle(), f),
        /Another wiki publication/,
      )
    },
  })
  assert.equal(
    existsSync(join(f.projectRoot, 'data/.wiki-publish.lock')),
    false,
  )
})

test('GitOps refuses invalid content before invoking git or staging changes', (t) => {
  const f = fixture(t)
  page(f, { ...metadata(), confidence: 2 })
  assert.throws(
    () =>
      commitWiki(f.wikiRoot, 'Should never commit', {
        projectRoot: f.projectRoot,
      }),
    /schema_error/,
  )
  assert.equal(existsSync(join(f.wikiRoot, '.git')), false)
})

test('legacy CLI delegates to strict core and returns machine-readable failures', (t) => {
  const f = fixture(t)
  page(f, { ...metadata(), status: 'invalid' })
  const result = spawnSync(
    process.execPath,
    [
      join(PROJECT_ROOT, 'packages/wiki-tools/validate.mjs'),
      f.wikiRoot,
      '--project-root',
      f.projectRoot,
      '--json',
    ],
    { encoding: 'utf8' },
  )
  assert.equal(result.status, 1)
  assert.ok(codes(JSON.parse(result.stdout)).includes('schema_error'))
})

test('numbered scenario headings satisfy structural selectors without artificial level changes', (t) => {
  const f = fixture(t)
  page(
    f,
    { ...metadata(), type: 'frd', id: 'FRD-TEST-001', pattern: 'linear' },
    '# FRD\n\n## 1. Overview\nText\n\n## 2. Requirements\nText\n\n### 2.1 Feature\nText\n\n#### 2.1.1 执行步骤 (Steps)\n\n| Step | Actor | Action | Target / Transaction | Hint |\n|---|---|---|---|---|\n| 1 | User | Submit | Output | Check |\n\n## 3. Constraints\nText',
    'a/doc/business/frd-test-001.md',
  )
  assert.deepEqual(validateWiki(f).errors, [])
})

test('a symlink in the existing tree cannot redirect candidate writes outside staging', async (t) => {
  const f = fixture(t)
  const outside = join(f.projectRoot, 'outside')
  mkdirSync(outside)
  rmSync(join(f.wikiRoot, 'a'), { recursive: true })
  symlinkSync(outside, join(f.wikiRoot, 'a'))
  await assert.rejects(compileBundle(bundle(), f), /Symbolic links/)
  assert.equal(existsSync(join(outside, 'doc')), false)
})

test('an ordinary write failure restores previously replaced published files', async (t) => {
  const f = fixture(t)
  const dest = page(f)
  const before = readFileSync(dest, 'utf8')
  const b = bundle()
  b.nodes[0].content = 'A changed requirement.'
  b.nodes.push({
    ...b.nodes[0],
    id: 'REQ-ARCHIVE-001',
    review_level: 'archive',
  })
  mkdirSync(
    join(
      f.projectRoot,
      'data/review/archived/test-bundle/req-archive-001.json',
    ),
    { recursive: true },
  )
  await assert.rejects(compileBundle(b, f))
  assert.equal(readFileSync(dest, 'utf8'), before)
  assert.equal(
    existsSync(join(f.projectRoot, 'data/documents/project-registry.json')),
    false,
  )
})

test('a source footer marker cannot hide subsequent malformed content', (t) => {
  const f = fixture(t)
  page(
    f,
    metadata(),
    '# Test\n\nText\n\n---\n> **来源文档**: source\n\n[[doc/requirements/missing.md]]',
  )
  assert.ok(codes(validateWiki(f)).includes('broken_link'))
})

test('builtin template lookup and checks work without a wiki manifest', (t) => {
  const f = fixture(t)
  const script = join(PROJECT_ROOT, 'packages/wiki-tools/templates.mjs')
  const env = { ...process.env, CIM_WIKI_ROOT: f.wikiRoot }
  const get = spawnSync(process.execPath, [script, 'get', 'frd'], {
    env,
    encoding: 'utf8',
  })
  assert.equal(get.status, 0, get.stderr)
  assert.match(get.stdout, /Functional Requirement Definition/)
  const check = spawnSync(process.execPath, [script, 'check'], {
    env,
    encoding: 'utf8',
  })
  assert.equal(check.status, 0, check.stdout + check.stderr)
  assert.match(check.stdout, /OK\s+frd/)
})

test('the old unvalidated manual rebuild fails without deleting published manuals', (t) => {
  const f = fixture(t)
  const dest = page(
    f,
    metadata(),
    '# Existing\n\nText.',
    'a/doc/manuals/existing.md',
  )
  const before = readFileSync(dest, 'utf8')
  const result = spawnSync(
    process.execPath,
    [join(PROJECT_ROOT, 'packages/wiki-tools/gen-manuals.mjs')],
    {
      env: { ...process.env, WIKI_ROOT: f.wikiRoot, ADMIN_PROJECT_ID: 'a' },
      encoding: 'utf8',
    },
  )
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Unvalidated raw-document rebuilds are disabled/)
  assert.equal(readFileSync(dest, 'utf8'), before)
})

test('published Markdown rejects executable HTML and Vue while preserving code examples', (t) => {
  const f = fixture(t)
  for (const body of [
    '# Test\n\n<script>alert(1)</script>',
    '# Test\n\n<div v-html="unsafe">content</div>',
    '# Test\n\n{{ dangerousExpression() }}',
    '# Test\n\n<!--<!--hidden-->-->',
  ]) {
    page(f, metadata(), body)
    assert.ok(codes(validateWiki(f)).includes('active_content'))
  }
  page(
    f,
    metadata(),
    '# Test\n\nA safe definition.<br>\n\n```html\n<script>example()</script>\n```\n\nUse `{{ value }}` as a code example.',
  )
  assert.deepEqual(validateWiki(f).errors, [])
})
