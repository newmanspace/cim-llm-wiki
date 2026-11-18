import { builtinDefaults, createDefaultsStore } from '../document-defaults.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { createKnowledgeServer } from '../../wiki-service/server.mjs'
import { resolveShared, hashFile, writeSharedFile } from '../sources.mjs'
import { validateWiki } from '../validate.mjs'
import { createProjectWiki } from '../../wiki-service/project-wiki.mjs'
import { createBuildRuntime } from '../../wiki-service/build-runtime.mjs'

const repo = fileURLToPath(new URL('../../../', import.meta.url))
function save(path, data) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, typeof data === 'string' ? data : JSON.stringify(data)) }
async function fixture(t, { autoPublish = true, builds = false, projectStorage = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'shared-knowledge-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const projectRoot = join(root, 'state'), wikiRoot = join(projectRoot, 'data/wiki'), shared = join(root, 'external-share')
  const roots = { team: shared }
  const defaults = createDefaultsStore(projectRoot), definition = builtinDefaults()
  definition.delivery = [{id:'requirements',type:'requirement',scope:'project',min:1}]
  defaults.save(definition,0,'Test Administrator'); defaults.publish(1,'Test Administrator'); defaults.bind('demo',['terms'])
  const requirement = definition.templates.find(t=>t.id==='urd').example.replace(/^# [^\n]+\n/,'').replace('待指定','auto').replace('| 文档名称 | URD 用户需求定义 |','| 文档名称 | Term requirement |').replace('## 1. 背景与目标', '## 1. 背景与目标\n\nA concrete source-backed term definition.')
  mkdirSync(join(wikiRoot, 'demo'), { recursive: true })
  save(join(shared, 'sources/original.xlsx'), 'original XLSX fixture bytes')
  const reviewToken = 'human-review-only-' + 'r'.repeat(32)
  const calls = [], requestLogs = [], ledgerRequestIds = []
  const ledgerToken = 'private-build-service-' + 'l'.repeat(32)
  let ledgerURL
  if (builds) {
    const ledger = createServer((req, res) => { ledgerRequestIds.push(req.headers['x-request-id']); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: req.url.endsWith('/project') ? { id: 'demo', repos: [], modules: ['terms'], docs: [] } : { items: [], next_cursor: '' } })) })
    ledger.listen(0, '127.0.0.1'); await once(ledger, 'listening')
    ledgerURL = `http://127.0.0.1:${ledger.address().port}`
    t.after(() => { ledger.closeAllConnections(); ledger.close() })
  }
  const projectWikis = projectStorage ? createProjectWiki({ projectRoot }) : null
  if (projectWikis) {
    projectWikis.initialize('demo'); cpSync(join(wikiRoot, 'demo'), projectWikis.source('demo'), { recursive: true })
    execFileSync('git', ['-C', projectWikis.source('demo'), 'add', '.'])

  }
  const buildRuntime = builds ? createBuildRuntime({ projectRoot, wikiRoot, roots, projectWikis, socketPath: join(root, 'build.sock') }) : undefined
  if (buildRuntime) t.after(() => buildRuntime.close())
  const server = createKnowledgeServer({ logWriter: line => requestLogs.push(JSON.parse(line)), projectWikis, projectRoot, wikiRoot, roots, autoPublish, buildRuntime, ledgerURL, ledgerToken: builds ? ledgerToken : undefined, token: 'test-token', reviewerTokens: { 'Domain Reviewer': reviewToken }, parser: async (input, engine) => {
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
    source: registration.parsed, source_location: { sheet: '术语', cells: 'A2:D5' }, title: 'Term requirement', content: requirement,
    status: 'published', confidence: .99, review_level: level, reviewer: 'auto', created_at: '2026-11-05T00:00:00Z', updated_at: '2026-11-05T00:00:00Z',
    qscore: { auth: 1, comp: 1, rel: 1, fresh: 1, struct: 1, reuse: 1, risk: .1, total: .99 },
  }] })
  const submit = async b => { save(join(shared, 'demo/work/nodes.json'), b); return api('bundles', { uri: 'shared://team/demo/work/nodes.json' }) }
  return { ledgerRequestIds, requestLogs, projectWikis, reviewToken, ledgerToken, buildRuntime, root, projectRoot, wikiRoot, shared, roots, calls, api, origin, registration, bundle, submit }
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
  const critical = f.bundle('CR-20261105-0004'); critical.nodes[0].content += '\nHold state machine requirements.'
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
  b.nodes[0].content += '\n\nAnother proposed definition.'
  assert.equal((await f.submit(a)).value.state, 'auto')
  const secondSubmission=await f.submit(b); assert.equal(secondSubmission.value.state, 'auto',JSON.stringify(secondSubmission.value))
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
  assert.equal((await f.api('initialize', { project: 'demo' }, 'wrong')).status, 401)
  assert.equal((await f.api('initialize', { project: 'demo' }, f.reviewToken)).status, 403)
  const initialized = await f.api('initialize', { project: 'demo', name: 'CIM Product', product_version: 'V2.8', modules: ['terms'] })
  assert.equal(initialized.status, 200, JSON.stringify(initialized.value))
  assert.ok((await f.api('directories?project=demo')).value.digest)
  assert.ok((await f.api('context?project=demo')).value.directory.directories.length >= 17)
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
  assert.match(JSON.stringify(directorySidebar('demo', f.wikiRoot, f.projectRoot)), /Term requirement/)
  assert.equal((await f.api('directories', { project: 'demo', directories: [] })).status, 404)
  assert.deepEqual((await f.api('validate', {})).value.errors, [])
  const site = join(f.root, 'site')
  const configDir = join(site, '.vitepress')
  mkdirSync(configDir, { recursive: true })
  const sidebarPath = join(configDir, 'sidebar-data.mjs')
  const env = { ...process.env, WIKI_ROOT: f.wikiRoot, CIM_WIKI_WORKSPACE: f.projectRoot,
    CIM_WIKI_SHARED_ROOTS: JSON.stringify(f.roots), WIKI_SIDEBAR_OUT: sidebarPath }
  await runChild([join(repo, 'wiki/scripts/gen-sidebar.mjs')], env)
  const sidebarText = readFileSync(sidebarPath, 'utf8')
  assert.match(sidebarText, /产品文档/)
  assert.match(sidebarText, /Term requirement/)
  const navigation = await import(pathToFileURL(sidebarPath).href)
  assert.equal(navigation.nav.find(item => item.text === 'demo').link, '/demo/doc/requirements/req-terms-001')
  const baseConfigPath = join(repo, 'wiki/.vitepress/config.mjs')
  const baseConfigUrl = pathToFileURL(baseConfigPath).href
  const wikiRequire = createRequire(baseConfigUrl)
  const isolatedConfig = readFileSync(baseConfigPath, 'utf8')
    .replace("from 'vitepress'", `from ${JSON.stringify(pathToFileURL(wikiRequire.resolve('vitepress')).href)}`)
    .replace("from '../../packages/wiki-core/validate.mjs'", `from ${JSON.stringify(pathToFileURL(join(repo, 'packages/wiki-core/validate.mjs')).href)}`)
    .replace("from '../../packages/wiki-core/repository-docs.mjs'", `from ${JSON.stringify(pathToFileURL(join(repo, 'packages/wiki-core/repository-docs.mjs')).href)}`)
    .replace('createRequire(import.meta.url)', `createRequire(${JSON.stringify(baseConfigUrl)})`)
    .replace('export default defineConfig({', `export default defineConfig({\n  outDir: ${JSON.stringify(join(site, 'dist'))},\n  cacheDir: ${JSON.stringify(join(site, 'cache'))},`)
  cpSync(join(repo, 'wiki/.vitepress/mermaid-markdown.mjs'), join(configDir, 'mermaid-markdown.mjs'))
  writeFileSync(join(configDir, 'config.mjs'), isolatedConfig)
  await runChild([join(repo, 'wiki/node_modules/vitepress/bin/vitepress.js'), 'build', site], env)
  assert.equal(existsSync(join(site, 'dist/demo/catalog/_index.html')), false)
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

test('a reviewed bundle cannot publish after its bound document contract is upgraded',async t=>{
  const f=await fixture(t,{autoPublish:false});await ready(f)
  const bundle=f.bundle('CR-20261113-0001','L1_expert')
  assert.equal((await f.submit(bundle)).status,200)
  assert.equal((await f.api('review',{bundle_id:bundle.bundle_id,decision:'approve'},f.reviewToken)).status,200)
  const store=createDefaultsStore(f.projectRoot),state=store.state()
  state.draft.name='New system contract'
  store.save(state.draft,state.revision,'Test Administrator');store.publish(state.revision+1,'Test Administrator')
  store.bind('demo',['terms'],{},store.state().published_version,true)
  const result=await f.api('compile',{bundle_id:bundle.bundle_id})
  assert.equal(result.status,409);assert.match(result.value.error,/contract changed/)
  assert.equal(existsSync(join(f.wikiRoot,'demo/doc/requirements/req-terms-001.md')),false)
})


test('compile preview never runs formal publication recovery', async t => {
  const f = await fixture(t)
  await ready(f)
  const b = f.bundle('CR-PENDING-RECOVERY')
  assert.equal((await f.submit(b)).status, 200)
  const path = join(f.projectRoot, 'data/service/bundles', b.bundle_id + '.json')
  const record = JSON.parse(readFileSync(path, 'utf8'))
  record.publication_pending = { key: 'pending', publications: [], files: [], result: {} }
  save(path, record)
  const before = readFileSync(path, 'utf8')
  const preview = await f.api('compile', { bundle_id: b.bundle_id, preview: true })
  assert.equal(preview.status, 409)
  assert.match(preview.value.error, /recovery.*preview/)
  assert.equal(readFileSync(path, 'utf8'), before)
})

test('approved preview is isolated and publication durably triggers a Git-based formal build', async t => {
  const f = await fixture(t, { autoPublish: false, builds: true })
  await ready(f)
  const git = args => execFileSync('git', ['-C', f.wikiRoot, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim()
  git(['init']); git(['config', 'user.name', 'Test']); git(['config', 'user.email', 'test@example.invalid'])
  git(['add', '.']); git(['commit', '--allow-empty', '-m', 'Baseline Project'])
  const baseline = git(['rev-parse', 'HEAD']), b = f.bundle('CR-BUILD-001', 'L1_expert')
  assert.equal((await f.submit(b)).status, 200)
  const internal = async (action, data, project = 'demo', credential = f.ledgerToken) => {
    const res = await fetch(`${f.origin}/internal/wiki-builds${action}?project=${project}`, {
      method: data === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
    })
    return { status: res.status, value: await res.json() }
  }
  assert.equal((await internal('', undefined, 'demo', 'test-token')).status, 403)
  assert.equal((await internal('/preview', { bundle_id: b.bundle_id })).status, 409)
  assert.equal((await f.api('review', { bundle_id: b.bundle_id, decision: 'approve' }, f.reviewToken)).status, 200)
  const before = readFileSync(join(f.projectRoot, 'data/documents/manifest.json'), 'utf8')
  const preview = await internal('/preview', { bundle_id: b.bundle_id })
  assert.equal(preview.status, 200, JSON.stringify(preview.value))
  assert.equal(preview.value.site_build.state, 'queued')
  assert.equal(git(['rev-parse', 'HEAD']), baseline)
  assert.equal(git(['status', '--porcelain']), '')
  assert.equal(readFileSync(join(f.projectRoot, 'data/documents/manifest.json'), 'utf8'), before)
  assert.equal((await internal('/revoke', { id: preview.value.site_build.id }, 'other')).status, 404)
  assert.equal((await internal('/revoke', { id: preview.value.site_build.id })).status, 200)
  assert.equal((await internal('/preview', { bundle_id: b.bundle_id }, 'other')).status, 404)
  const previous = process.env.WIKI_GITOPS_ENABLED
  process.env.WIKI_GITOPS_ENABLED = 'true'
  t.after(() => { if (previous === undefined) delete process.env.WIKI_GITOPS_ENABLED; else process.env.WIKI_GITOPS_ENABLED = previous })
  const formal = await f.api('compile', { bundle_id: b.bundle_id })
  assert.equal(formal.status, 200, JSON.stringify(formal.value))
  assert.equal(formal.value.site_build.mode, 'formal')
  assert.equal(formal.value.site_build.state, 'queued', JSON.stringify(formal.value.site_build))
  assert.equal(formal.value.site_build.gitCommit, git(['rev-parse', 'HEAD']))
  assert.notEqual(formal.value.site_build.gitCommit, baseline)
  assert.equal(git(['status', '--porcelain']), '')
  f.buildRuntime.reconcile()
  const jobs = (await internal('')).value.data
  assert.equal(jobs.filter(job => job.mode === 'formal').length, 1)
  assert.equal('claimToken' in jobs[0], false)
  assert.equal('snapshot' in jobs[0], false)
})

test('administrators can request the first build without a Bundle and receive durable blocked diagnostics', async t => {
  const f = await fixture(t, { autoPublish: false, builds: true })
  const before = readFileSync(join(f.projectRoot, 'data/document-defaults/state.json'), 'utf8')
  const request = (project, credential = f.ledgerToken) => fetch(`${f.origin}/internal/wiki-builds/build?project=${project}`, { method: 'POST', headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' }, body: '{}' })
  assert.equal((await request('demo', 'test-token')).status, 403)
  assert.equal((await request('other')).status, 404)
  const response = await request('demo')
  assert.equal(response.status, 200)
  const { data } = await response.json()
  assert.equal(data.state, 'blocked')
  assert.ok(data.diagnostics.length)
  const listed = await fetch(`${f.origin}/internal/wiki-builds?project=demo`, { headers: { Authorization: `Bearer ${f.ledgerToken}` } })
  assert.equal((await listed.json()).data[0].id, data.id)
  assert.equal(readFileSync(join(f.projectRoot, 'data/document-defaults/state.json'), 'utf8'), before)
  assert.equal(existsSync(join(f.wikiRoot, '.git')), false)
})

test('project storage API preserves review gates, previews candidates and commits only an initially clean project', async t => {
  const f = await fixture(t, { autoPublish: false, builds: true, projectStorage: true })
  await ready(f)
  const b = f.bundle('CR-PROJECT-STORAGE', 'L1_expert')
  assert.equal((await f.submit(b)).status, 200)
  assert.equal((await f.api('compile', { bundle_id: b.bundle_id, preview: true, site: true })).status, 409)
  assert.equal((await f.api('review', { bundle_id: b.bundle_id, decision: 'approve' }, f.reviewToken)).status, 200)
  const preview = await f.api('compile', { bundle_id: b.bundle_id, preview: true, site: true })
  assert.equal(preview.status, 200, JSON.stringify(preview.value))
  assert.equal(preview.value.site_build.mode, 'preview')
  const source = f.projectWikis.source('demo'), dirty = join(source, 'unreviewed.md')
  writeFileSync(dirty, '# Unreviewed content')
  const previous = process.env.WIKI_GITOPS_ENABLED
  process.env.WIKI_GITOPS_ENABLED = 'true'
  t.after(() => { if (previous === undefined) delete process.env.WIKI_GITOPS_ENABLED; else process.env.WIKI_GITOPS_ENABLED = previous })
  const blocked = await f.api('compile', { bundle_id: b.bundle_id })
  assert.equal(blocked.status, 422)
  assert.match(blocked.value.error, /uncommitted/)
  assert.equal(existsSync(join(source, 'doc/requirements/req-terms-001.md')), false)
  rmSync(dirty)
  const published = await f.api('compile', { bundle_id: b.bundle_id })
  assert.equal(published.status, 200, JSON.stringify(published.value))
  assert.equal(published.value.site_build.state, 'queued', JSON.stringify(published.value))
  assert.equal(f.projectWikis.status('demo').gitStatus, 'clean')
  assert.equal(existsSync(join(source, 'doc/requirements/req-terms-001.md')), true)
  assert.equal(existsSync(join(f.wikiRoot, 'demo/doc/requirements/req-terms-001.md')), false)
})

test('submission reports indexed schema diagnostics before template, identity or source checks', async t => {
  const f = await fixture(t)
  const bundle = f.bundle('CR-SCHEMA-001')
  delete bundle.nodes[0].type
  bundle.nodes[0].node_type = 'sdd'
  bundle.nodes[0].template_id = 'sdd-alarm'
  bundle.nodes[0].document_id = bundle.nodes[0].id
  bundle.nodes[0].metadata = { product: 'Example' }
  bundle.nodes.push(null)
  const result = await f.submit(bundle)
  assert.equal(result.status, 422)
  assert.equal(result.value.code, 'BUNDLE_SCHEMA_INVALID')
  const paths = result.value.diagnostics.map(d => d.path)
  for (const path of ['/nodes/0/type', '/nodes/0/node_type', '/nodes/0/metadata', '/nodes/0/document_id', '/nodes/1']) assert.ok(paths.includes(path), path)
  assert.ok(result.value.diagnostics.every(d => !['/nodes/0/api_type', '/nodes/0/rule_type', '/nodes/0/pattern'].includes(d.path)))
  assert.doesNotMatch(result.value.error, /undefined|Source must be frozen/)
  assert.equal((await f.api('bundle?id=' + bundle.bundle_id)).status, 404)
})

test('submission continues to fill server-owned fields after early schema validation', async t => {
  const f = await fixture(t); await ready(f)
  const bundle = f.bundle('CR-SCHEMA-002')
  for (const field of ['schema_version', 'reviewer', 'status', 'created_at', 'updated_at', 'confidence']) delete bundle.nodes[0][field]
  const result = await f.submit(bundle)
  assert.equal(result.status, 200, JSON.stringify(result.value))
  const node = result.value.bundle.nodes[0]
  assert.equal(node.reviewer, 'auto')
  assert.equal(node.confidence, .99)
  assert.equal(node.status, 'published')
  assert.equal(node.schema_version, '1.0')
  assert.ok(Number.isFinite(Date.parse(node.created_at)))
})


test('registered sources are immediately visible to administrators with current lifecycle and project isolation', async t => {
  const f = await fixture(t, { builds: true })
  const list = async (project = 'demo', credential = f.ledgerToken) => {
    const response = await fetch(`${f.origin}/internal/source-documents?project=${project}`, { headers: { Authorization: `Bearer ${credential}` } })
    return { status: response.status, value: await response.json() }
  }
  assert.deepEqual((await list()).value.documents, [])
  save(join(f.shared, 'demo/parsed/terms.md'), '# Registered source\n\nText')
  assert.equal((await f.api('register', f.registration)).status, 200)
  let result = await list()
  assert.equal(result.status, 200)
  assert.equal(result.value.documents.length, 1)
  assert.equal(result.value.documents[0].path, f.registration.parsed)
  assert.equal(result.value.documents[0].state, 'draft')
  assert.equal(result.value.documents[0].original_uri, f.registration.source)
  assert.equal('original_path' in result.value.documents[0], false)
  assert.equal('markdown' in result.value.documents[0], false)
  assert.equal((await f.api('register', f.registration)).status, 409)
  assert.equal((await list()).value.documents.length, 1)
  assert.equal((await f.api('state', { source: f.registration.parsed, action: 'freeze', reviewer: 'Test Operator' })).status, 200)
  result = await list()
  assert.equal(result.value.documents[0].state, 'frozen')
  assert.equal(result.value.documents[0].history.at(-1).to, 'frozen')
  assert.equal((await f.api('state', { source: f.registration.parsed, action: 'unfreeze' })).status, 200)
  assert.equal((await list()).value.documents[0].state, 'draft')
  assert.deepEqual((await list('another-project')).value.documents, [])
  assert.equal((await list('demo', 'test-token')).status, 403)
})


test('HTTP logs correlate failed submissions without recording secrets or document bodies', async t => {
  const f = await fixture(t)
  const response = await fetch(`${f.origin}/api/v2/knowledge/bundles?token=query-secret`, {
    method: 'POST', headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json', 'X-Request-ID': 'submit-correlation-001' },
    body: JSON.stringify({ project: 'demo', uri: 'shared://team/missing.json', content: 'private-document-marker', password: 'private-password-marker' }),
  })
  assert.equal(response.headers.get('x-request-id'), 'submit-correlation-001')
  assert.equal(response.status, 422)
  await response.json()
  const records = f.requestLogs.filter(r => r.http.request.id === 'submit-correlation-001')
  assert.equal(records[0].event.action, 'request.started')
  assert.equal(records.at(-1).event.action, 'request.completed')
  assert.equal(records.at(-1).event.outcome, 'failure')
  assert.equal(records.at(-1).operation.step, 'bundle.read')
  assert.equal(records.at(-1).cim.project, 'demo')
  assert.equal(records.at(-1).http.response.status_code, 422)
  assert.ok(records.at(-1).event.duration > 0)
  assert.equal(records.filter(r => r.event.action === 'request.failed').length, 1)
  const text = JSON.stringify(records)
  for (const secret of ['test-token', 'query-secret', 'private-document-marker', 'private-password-marker']) assert.equal(text.includes(secret), false)
  const malformed = await fetch(`${f.origin}/api/v2/knowledge/bundles`, {
    method: 'POST', headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json', 'X-Request-ID': 'invalid request id' }, body: '{"content":"secret-json-marker",',
  })
  assert.equal(malformed.status, 400)
  assert.match(malformed.headers.get('x-request-id'), /^[a-zA-Z0-9._-]+$/)
  await malformed.json()
  assert.equal(JSON.stringify(f.requestLogs).includes('secret-json-marker'), false)
})


test('successful registration logs persistence while concurrent requests keep separate context', async t => {
  const f = await fixture(t)
  save(join(f.shared, 'demo/parsed/terms.md'), '# Private converted body marker')
  assert.equal((await f.api('register', f.registration)).status, 200)
  assert.equal((await f.api('register', f.registration)).status, 409)
  assert.equal(f.requestLogs.filter(r => r.operation?.step === 'source.persisted' && r.event.action === 'operation.step').length, 1)
  assert.equal(JSON.stringify(f.requestLogs).includes('Private converted body marker'), false)
  await Promise.all(['demo', 'other-project'].map(async project => {
    const res = await fetch(`${f.origin}/api/v2/knowledge/bundles`, {
      method: 'POST', headers: { Authorization: 'Bearer test-token', 'X-Request-ID': `parallel-${project}` },
      body: JSON.stringify({ project, uri: 'shared://team/missing.json' }),
    })
    await res.json()
  }))
  for (const project of ['demo', 'other-project']) {
    const records = f.requestLogs.filter(r => r.http.request.id === `parallel-${project}` && r.cim.project)
    assert.ok(records.length > 1)
    assert.ok(records.every(r => r.cim.project === project))
  }
})


test('knowledge forwards the request ID to the document ledger', async t => {
  const f = await fixture(t, { builds: true })
  const response = await fetch(`${f.origin}/api/v2/knowledge/document-results?project=demo`, { headers: { Authorization: 'Bearer test-token', 'X-Request-ID': 'ledger-correlation-001' } })
  assert.equal(response.status, 200)
  await response.json()
  assert.ok(f.ledgerRequestIds.includes('ledger-correlation-001'))
})
