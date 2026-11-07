import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createKnowledgeServer } from '../../wiki-service/server.mjs'
import { resolveShared, hashFile, writeSharedFile } from '../sources.mjs'
import { validateWiki } from '../validate.mjs'

const repo = fileURLToPath(new URL('../../../', import.meta.url))
function save(path, data) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, typeof data === 'string' ? data : JSON.stringify(data)) }
async function fixture(t, { autoPublish = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'shared-knowledge-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const projectRoot = join(root, 'state'), wikiRoot = join(projectRoot, 'data/wiki'), shared = join(root, 'external-share')
  const roots = { team: shared }
  const contract = { schema_version: '1.0', project: 'demo', documents: [{ id: 'requirements', type: 'requirement', scope: 'project', min: 1 }] }
  save(join(wikiRoot, 'demo/document-contract.json'), contract)
  save(join(shared, 'sources/original.xlsx'), 'original XLSX fixture bytes')
  const reviewToken = 'human-review-only-' + 'r'.repeat(32)
  const calls = []
  const server = createKnowledgeServer({ projectRoot, wikiRoot, roots, autoPublish, token: 'test-token', reviewerTokens: { 'Domain Reviewer': reviewToken }, parser: async (input, engine) => {
    calls.push({ input, engine }); return { md: '# Terms\n\nA source-backed definition.\n', images: [] }
  } })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const origin = `http://127.0.0.1:${server.address().port}`
  const api = async (path, data, token = 'test-token') => {
    const res = await fetch(`${origin}/api/v2/knowledge/${path}`, { method: data === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) })
    return { status: res.status, value: await res.json() }
  }
  const registration = { project: 'demo', source: 'shared://team/sources/original.xlsx', parsed: 'shared://team/demo/parsed/terms.md',
    system: 'CIM', version: 'V2.8', category: 'design', ingest_path: '/agent/shared/sources/original.xlsx' }
  const bundle = (id = 'CR-20261105-0001', level = 'L0_auto') => ({ schema_version: '1.0', bundle_id: id, project: 'demo', nodes: [{
    schema_version: '1.0', id: 'REQ-TERMS-001', type: 'requirement', plane: 'doc', product: 'CIM', version: 'V2.8', domain: 'cim', module: 'terms',
    source: registration.parsed, source_location: { sheet: '术语', cells: 'A2:D5' }, title: 'Term requirement', content: 'A concrete source-backed term definition.',
    status: 'published', confidence: .99, review_level: level, reviewer: 'auto', created_at: '2026-11-05T00:00:00Z', updated_at: '2026-11-05T00:00:00Z',
    qscore: { auth: 1, comp: 1, rel: 1, fresh: 1, struct: 1, reuse: 1, risk: .1, total: .99 },
  }] })
  const submit = async b => { save(join(shared, 'demo/work/nodes.json'), b); return api('bundles', { uri: 'shared://team/demo/work/nodes.json' }) }
  return { reviewToken, root, projectRoot, wikiRoot, shared, roots, calls, api, origin, registration, bundle, submit }
}
async function ready(f) {
  const converted = await f.api('convert', f.registration)
  assert.equal(converted.status, 200, JSON.stringify(converted.value))
  const frozen = await f.api('state', { source: f.registration.parsed, action: 'freeze', reviewer: 'Test Operator' })
  assert.equal(frozen.status, 200, JSON.stringify(frozen.value))
}

test('shared paths reject traversal, unknown mounts and symlink escapes', t => {
  const root = mkdtempSync(join(tmpdir(), 'shared-paths-')); t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'mount')); save(join(root, 'outside.txt'), 'private')
  symlinkSync(root, join(root, 'mount/escape'))
  const roots = { team: join(root, 'mount') }
  for (const uri of ['shared://team/../outside.txt', 'shared://other/source.md', 'shared://team/%2e%2e/outside.txt', 'shared://team/escape/outside.txt', 'shared://team/escape/new.md']) {
    assert.throws(() => resolveShared(uri, roots, { write: true }), uri)
  }
})

test('conversion, freezing and publishing preserve original paths outside the project', async t => {
  const f = await fixture(t)
  assert.equal((await f.api('context?project=demo', undefined, 'wrong')).status, 401)
  assert.ok((await f.api('context?project=demo')).value.templates.frd)
  const converted = await f.api('convert', f.registration)
  assert.equal(converted.status, 200, JSON.stringify(converted.value))
  assert.equal(f.calls[0].input, join(f.shared, 'sources/original.xlsx'))
  assert.equal(converted.value.document.original_path, join(f.shared, 'sources/original.xlsx'))
  assert.equal(converted.value.document.original_sha256, hashFile(join(f.shared, 'sources/original.xlsx')))
  assert.equal(existsSync(join(f.projectRoot, 'data/raw')), false)
  assert.equal((await f.submit(f.bundle())).status, 409, 'Draft sources must not be extracted/submitted')
  assert.equal((await f.api('state', { source: f.registration.parsed, action: 'freeze', reviewer: 'Test Operator' })).status, 200)
  const submitted = await f.submit(f.bundle())
  assert.equal(submitted.status, 200, JSON.stringify(submitted.value))
  assert.equal(submitted.value.state, 'auto')
  const page = join(f.wikiRoot, 'demo/doc/requirements/req-terms-001.md')
  const preview = await f.api('compile', { bundle_id: f.bundle().bundle_id, preview: true })
  assert.equal(preview.status, 200, JSON.stringify(preview.value)); assert.equal(existsSync(page), false)
  const compiled = await f.api('compile', { bundle_id: f.bundle().bundle_id })
  assert.equal(compiled.status, 200, JSON.stringify(compiled.value))
  const text = readFileSync(page, 'utf8')
  assert.ok(text.includes(join(f.shared, 'sources/original.xlsx')))
  assert.match(text, /shared:\/\/team\/sources\/original.xlsx/)
  assert.match(text, /A2:D5/)
  assert.match(text, /ingest_path: \/agent\/shared\/sources\/original.xlsx/)
  assert.equal((await f.api('document?source=' + encodeURIComponent(f.registration.parsed))).value.document.state, 'active')
  assert.deepEqual((await f.api('validate', {})).value.errors, [])
  const moved = join(f.root, 'new-server-mount'); cpSync(f.shared, moved, { recursive: true })
  assert.deepEqual(validateWiki({ projectRoot: f.projectRoot, wikiRoot: f.wikiRoot, roots: { team: moved } }).errors, [], 'Mount paths can change while provenance retains the original ingest path')
  save(join(f.shared, 'sources/original.xlsx'), 'modified original')
  assert.ok((await f.api('validate', {})).value.errors.some(e => e.code === 'original_drift'))
  assert.equal((await f.api('compile', { bundle_id: f.bundle().bundle_id })).status, 422)
  rmSync(join(f.shared, 'sources/original.xlsx'))
  assert.ok((await f.api('validate', {})).value.errors.some(e => e.code === 'original_unavailable'))
})

test('existing converted folders register without copying or rerunning the parser', async t => {
  const f = await fixture(t)
  save(join(f.shared, 'demo/parsed/terms.md'), '# Existing conversion\n\nTerm definition.')
  const response = await f.api('register', f.registration)
  assert.equal(response.status, 200, JSON.stringify(response.value)); assert.equal(f.calls.length, 0)
  assert.equal(response.value.document.original_uri, f.registration.source)
  assert.equal((await f.api('register', f.registration)).status, 409)
  assert.equal(existsSync(join(f.projectRoot, 'data/raw')), false)
})

test('human review binds to an immutable submitted bundle and low scores cannot claim automatic approval', async t => {
  const f = await fixture(t); await ready(f)
  const b = f.bundle('CR-20261105-0002', 'L1_expert')
  assert.equal((await f.submit(b)).value.state, 'pending')
  assert.equal((await f.api('compile', { bundle_id: b.bundle_id })).status, 409)
  assert.equal((await f.api('review', { bundle_id: b.bundle_id, decision: 'approve', reviewer: 'auto' })).status, 403)
  assert.equal((await f.api('review', { bundle_id: b.bundle_id, decision: 'approve', reviewer: 'Domain Reviewer', note: 'Approved after source check' }, f.reviewToken)).status, 200)
  assert.equal((await f.api('compile', { bundle_id: b.bundle_id })).status, 200)
  assert.match(readFileSync(join(f.wikiRoot, 'demo/doc/requirements/req-terms-001.md'), 'utf8'), /reviewer: Domain Reviewer/)
  const revised = f.bundle('CR-20261105-0003'); revised.nodes[0].qscore.fresh = 0; revised.nodes[0].qscore.total = .84
  const bad = await f.submit(revised)
  assert.equal(bad.status, 400); assert.match(bad.value.error, /Review level/)
  const critical = f.bundle('CR-20261105-0004'); critical.nodes[0].content = 'Hold state machine requirements.'
  assert.equal((await f.submit(critical)).status, 400)
  const replacement = f.bundle('CR-20261105-0005')
  assert.equal((await f.submit(replacement)).value.state, 'pending', 'Existing pages always require approval')
  assert.equal((await f.api('review', { bundle_id: replacement.bundle_id, decision: 'reject', reviewer: 'Domain Reviewer' }, f.reviewToken)).status, 200)
  assert.equal((await f.api('compile', { bundle_id: replacement.bundle_id })).status, 409)
})

test('missing provenance and parsed-source drift block publication', async t => {
  const f = await fixture(t); await ready(f)
  const b = f.bundle()
  assert.equal((await f.submit(b)).status, 200)
  save(join(f.shared, 'demo/parsed/terms.md'), '# Changed parsed document\n\nChanged content.')
  assert.equal((await f.api('compile', { bundle_id: b.bundle_id })).status, 422)
  assert.equal(existsSync(join(f.wikiRoot, 'demo/doc/requirements/req-terms-001.md')), false)
  const response = await f.api('convert', { ...f.registration, source: 'shared://team/../secret', parsed: 'shared://team/new.md' })
  assert.notEqual(response.status, 200)
})

test('the copied skill client runs without the repository or npm dependencies', async t => {
  const f = await fixture(t)
  const installed = join(f.root, 'copied-skill')
  cpSync(join(repo, '.agents/skills/cim-wiki'), installed, { recursive: true })
  assert.equal(existsSync(join(installed, 'lib')), false)
  assert.equal(existsSync(join(installed, 'node_modules')), false)
  const child = spawn(process.execPath, [join(installed, 'scripts/client.mjs'), 'context', '--project', 'demo'], {
    cwd: tmpdir(), env: { ...process.env, CIM_WIKI_URL: f.origin, CIM_WIKI_TOKEN: 'test-token' }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = '', error = ''
  child.stdout.on('data', chunk => { output += chunk }); child.stderr.on('data', chunk => { error += chunk })
  const [code] = await once(child, 'close')
  assert.equal(code, 0, error)
  assert.equal(JSON.parse(output).project, 'demo')
})


test('losing source records or altering node provenance is a blocking validation error', async t => {
  const f = await fixture(t); await ready(f)
  assert.equal((await f.submit(f.bundle())).status, 200)
  assert.equal((await f.api('compile', { bundle_id: f.bundle().bundle_id })).status, 200)
  const page = join(f.wikiRoot, 'demo/doc/requirements/req-terms-001.md')
  const original = readFileSync(page, 'utf8')
  writeFileSync(page, original.replace('original_path: ' + join(f.shared, 'sources/original.xlsx'), 'original_path: /invented/original.xlsx'))
  assert.ok((await f.api('validate', {})).value.errors.some(e => e.code === 'provenance_mismatch'))
  writeFileSync(page, original)
  rmSync(join(f.projectRoot, 'data/documents/manifest.json'))
  assert.ok((await f.api('validate', {})).value.errors.some(e => e.code === 'provenance_missing'))
})

test('two automatic submissions cannot bypass review by racing to replace the same page', async t => {
  const f = await fixture(t); await ready(f)
  const a = f.bundle('CR-20261105-0101'), b = f.bundle('CR-20261105-0102')
  b.nodes[0].content = 'Another proposed definition.'
  assert.equal((await f.submit(a)).value.state, 'auto')
  assert.equal((await f.submit(b)).value.state, 'auto')
  assert.equal((await f.api('compile', { bundle_id: a.bundle_id })).status, 200)
  const stale = await f.api('compile', { bundle_id: b.bundle_id })
  assert.equal(stale.status, 409); assert.match(stale.value.error, /baseline changed/)
  assert.match(readFileSync(join(f.wikiRoot, 'demo/doc/requirements/req-terms-001.md'), 'utf8'), /A concrete source-backed term definition/)
})


test('shared writes reject symlinked parents and never overwrite an existing file', t => {
  const root = mkdtempSync(join(tmpdir(), 'shared-write-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const mount = join(root, 'mount'), outside = join(root, 'outside')
  mkdirSync(mount); mkdirSync(outside)
  const roots = { team: mount }
  writeSharedFile('shared://team/project/parsed/source.md', 'Converted content', roots)
  assert.equal(readFileSync(join(mount, 'project/parsed/source.md'), 'utf8'), 'Converted content')
  assert.throws(() => writeSharedFile('shared://team/project/parsed/source.md', 'Overwrite', roots))
  mkdirSync(join(mount, 'safe'))
  symlinkSync(join(mount, 'safe'), join(mount, 'link'))
  assert.throws(() => writeSharedFile('shared://team/link/blocked.md', 'Do not write through a link', roots))
  symlinkSync(outside, join(mount, 'escape'))
  assert.throws(() => writeSharedFile('shared://team/escape/blocked.md', 'Do not escape', roots))
  assert.equal(existsSync(join(outside, 'blocked.md')), false)
  assert.equal(existsSync(join(mount, 'safe/blocked.md')), false)
})


test('automation cannot assert a human identity or use reviewer tokens for publication', async t => {
  const f = await fixture(t); await ready(f)
  const b = f.bundle('CR-20261105-0201', 'L1_expert')
  assert.equal((await f.submit(b)).status, 200)
  assert.equal((await f.api('review', { bundle_id: b.bundle_id, decision: 'approve', reviewer: 'Domain Reviewer' })).status, 403)
  assert.equal((await f.api('review', { bundle_id: b.bundle_id, decision: 'approve', reviewer: 'Someone Else' }, f.reviewToken)).status, 403)
  assert.equal((await f.api('review', { bundle_id: b.bundle_id, decision: 'approve' }, f.reviewToken)).value.review.reviewer, 'Domain Reviewer')
  assert.equal((await f.api('compile', { bundle_id: b.bundle_id }, f.reviewToken)).status, 403)
  assert.equal((await f.api('compile', { bundle_id: b.bundle_id })).status, 200)
})


test('model scores cannot enable automatic publication without server policy opt-in', async t => {
  const f = await fixture(t, { autoPublish: false }); await ready(f)
  const b = f.bundle('CR-20261105-0301')
  const result = await f.submit(b)
  assert.equal(result.value.state, 'pending')
  assert.equal((await f.api('compile', { bundle_id: b.bundle_id })).status, 409)
  assert.equal((await f.api('review', { bundle_id: b.bundle_id, decision: 'approve' }, f.reviewToken)).status, 200)
  assert.equal((await f.api('compile', { bundle_id: b.bundle_id })).status, 200)
})

test('product directory initialization runs through human review, strict compilation and navigation', async t => {
  const f = await fixture(t, { autoPublish: false })
  const contract = (await f.api('context?project=demo')).value.delivery_contract
  assert.equal((await f.api('initialize', { project: 'demo' }, 'wrong')).status, 401)
  assert.equal((await f.api('initialize', { project: 'demo' }, f.reviewToken)).status, 403)
  const initialized = await f.api('initialize', { project: 'demo', name: 'CIM Product', version: 'V2.8', modules: ['terms'], delivery_contract: contract })
  assert.equal(initialized.status, 200, JSON.stringify(initialized.value))
  assert.equal((await f.api('directories?project=demo')).value.revision, 1)
  assert.ok((await f.api('context?project=demo')).value.directory.directories.length > 50)
  assert.ok((await f.api('validate', {})).value.errors.some(e => e.code === 'document_count'), 'Empty directory pages must not satisfy required documents')
  await ready(f)
  const bundle = f.bundle('CR-20261107-0001', 'L1_expert')
  assert.equal((await f.submit(bundle)).value.state, 'pending')
  assert.equal((await f.api('compile', { bundle_id: bundle.bundle_id })).status, 409)
  assert.equal((await f.api('review', { bundle_id: bundle.bundle_id, decision: 'approve', reviewer: 'Domain Reviewer', note: 'Verified fixture source' }, f.reviewToken)).status, 200)
  const compiled = await f.api('compile', { bundle_id: bundle.bundle_id })
  assert.equal(compiled.status, 200, JSON.stringify(compiled.value))
  assert.deepEqual((await f.api('validate', {})).value.errors, [])
  const { directorySidebar } = await import('../product-directory.mjs')
  assert.match(JSON.stringify(directorySidebar('demo', f.wikiRoot)), /Term requirement/)
  const directory = (await f.api('directories?project=demo')).value
  const updated = await f.api('directories', { project: 'demo', expected_revision: directory.revision, directories: directory.directories.map(d => d.path === 'overview' ? { ...d, title: 'Product Overview' } : d) })
  assert.equal(updated.status, 200)
  assert.equal((await f.api('directories', { project: 'demo', expected_revision: 1, directories: directory.directories })).status, 409)
  assert.deepEqual((await f.api('validate', {})).value.errors, [])
  const site = join(f.root, 'site')
  const configDir = join(site, '.vitepress')
  mkdirSync(configDir, { recursive: true })
  const sidebarPath = join(configDir, 'sidebar-data.mjs')
  const env = { ...process.env, WIKI_ROOT: f.wikiRoot, CIM_WIKI_WORKSPACE: f.projectRoot,
    CIM_WIKI_SHARED_ROOTS: JSON.stringify(f.roots), WIKI_SIDEBAR_OUT: sidebarPath }
  await runChild([join(repo, 'wiki/scripts/gen-sidebar.mjs')], env)
  const sidebarText = readFileSync(sidebarPath, 'utf8')
  assert.match(sidebarText, /Product Versions/)
  assert.match(sidebarText, /Term requirement/)
  const baseConfig = pathToFileURL(join(repo, 'wiki/.vitepress/config.mjs')).href
  writeFileSync(join(configDir, 'config.mjs'), `import base from ${JSON.stringify(baseConfig)}\nimport { sidebar, nav } from './sidebar-data.mjs'\nexport default { ...base, srcDir: ${JSON.stringify(f.wikiRoot)}, outDir: ${JSON.stringify(join(site, 'dist'))}, cacheDir: ${JSON.stringify(join(site, 'cache'))}, themeConfig: { ...base.themeConfig, sidebar, nav } }\n`)
  await runChild([join(repo, 'wiki/node_modules/vitepress/bin/vitepress.js'), 'build', site], env)
  assert.ok(existsSync(join(site, 'dist/demo/catalog/_index.html')))
  assert.ok(existsSync(join(site, 'dist/demo/doc/requirements/req-terms-001.html')))
})

async function runChild(args, env) {
  const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { output += chunk })
  const [code] = await once(child, 'close')
  assert.equal(code, 0, output)
}
