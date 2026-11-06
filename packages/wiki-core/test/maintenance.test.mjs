import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
} from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'

const envFor = (root) => ({
  ...process.env,
  CIM_WIKI_WORKSPACE: root,
  WIKI_ROOT: join(root, 'data/wiki'),
  CIM_WIKI_ROOT: join(root, 'data/wiki'),
  ADMIN_URL: '',
  ADMIN_PROJECT_TOKEN: '',
  WIKI_GITOPS_ENABLED: 'false',
  WIKI_GIT_REMOTE: '',
  DOCLING_ENDPOINT: '',
  MARKITDOWN_ENDPOINT: '',
  MINERU_ENDPOINT: '',
  GIT_AUTHOR_NAME: 'Quality Test',
  GIT_AUTHOR_EMAIL: 'quality@example.test',
  GIT_COMMITTER_NAME: 'Quality Test',
  GIT_COMMITTER_EMAIL: 'quality@example.test',
})
const json = (path) => JSON.parse(readFileSync(path, 'utf8'))
function write(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value))
}
function cli(script, args, env, stdin) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      env,
      timeout: 15000,
    })
    let stdout = '',
      stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr }))
    child.stdin.end(stdin)
  })
}
async function ok(script, args, env, stdin) {
  const result = await cli(script, args, env, stdin)
  assert.equal(result.code, 0, result.stderr)
  return result
}
function workspace(t) {
  const root = mkdtempSync(join(tmpdir(), 'maintenance-regression-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}
async function endpoint(t, handler) {
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => {
    server.closeAllConnections()
    return new Promise((resolve) => server.close(resolve))
  })
  return `http://127.0.0.1:${server.address().port}`
}

test('maintenance conversion and source lifecycle enforce frozen hashes and compiled references', async (t) => {
  const root = workspace(t),
    env = envFor(root)
  await ok('scripts/ci-wiki-fixture.mjs', [root], env)
  for (const script of [
    'packages/wiki-core/cli.mjs',
    'packages/wiki-tools/validate.mjs',
  ]) {
    const result = await ok(
      script,
      [
        'validate',
        join(root, 'data/wiki'),
        '--project-root',
        root,
        '--json',
      ].slice(script.includes('wiki-tools') ? 1 : 0),
      env,
    )
    assert.equal(JSON.parse(result.stdout).errors.length, 0)
  }
  await ok(
    'packages/wiki-core/cli.mjs',
    ['validate', '--project-root', root],
    env,
  )
  const input = join(root, 'source.txt')
  write(input, '# Source\nOriginal requirement')
  await ok('packages/wiki-tools/parse.mjs', [input, '--module', 'wip'], env)
  const path = 'data/raw/wip/source.md',
    manifestPath = join(root, 'data/documents/manifest.json')
  let record = json(manifestPath).docs.find((record) => record.path === path)
  assert.equal(record.state, 'draft')
  await ok('packages/wiki-tools/doc-state.mjs', ['list'], env)
  await ok('packages/wiki-tools/doc-state.mjs', ['show', record.doc_id], env)
  await ok(
    'packages/wiki-tools/doc-state.mjs',
    ['freeze', path, '--note', 'reviewed'],
    env,
  )
  await ok('packages/wiki-tools/doc-state.mjs', ['verify'], env)
  write(join(root, path), '# Changed source')
  assert.equal(
    (await cli('packages/wiki-tools/doc-state.mjs', ['verify'], env)).code,
    1,
  )
  await ok('packages/wiki-tools/doc-state.mjs', ['unfreeze', path], env)
  await ok('packages/wiki-tools/doc-state.mjs', ['freeze', path], env)
  assert.equal(
    (await cli('packages/wiki-tools/doc-state.mjs', ['activate', path], env))
      .code,
    1,
  )
  const bundlePath = join(root, 'data/work/CR-LIFECYCLE/nodes.json')
  write(bundlePath, {
    bundle_id: 'CR-LIFECYCLE',
    source_doc: path,
    nodes: [{ source: path }, { source: 'untracked' }],
  })
  assert.equal(
    (await cli('packages/wiki-tools/doc-state.mjs', ['activate', path], env))
      .code,
    1,
  )
  write(bundlePath, {
    bundle_id: 'CR-LIFECYCLE',
    source_doc: path,
    compiled_at: new Date().toISOString(),
    nodes: [],
  })
  await ok('packages/wiki-tools/doc-state.mjs', ['activate', path], env)
  await ok('packages/wiki-tools/doc-state.mjs', ['supersede', path], env)
  record = json(manifestPath).docs.find((record) => record.path === path)
  assert.equal(record.state, 'superseded')
  await ok(
    'packages/wiki-tools/parse.mjs',
    [
      input,
      '--system',
      'MES',
      '--version',
      'V1',
      '--category',
      'design',
      '--subcategory',
      'wip',
      '--name',
      'User manual',
    ],
    env,
  )
  assert.ok(existsSync(join(root, 'data/raw/MES/V1/design/wip/user-manual.md')))
  for (const args of [
    [],
    [input, '--engine', 'unknown'],
    [input, '--name', 'orphan'],
  ])
    assert.equal(
      (await cli('packages/wiki-tools/parse.mjs', args, env)).code,
      1,
    )
  write(input, '')
  assert.equal(
    (await cli('packages/wiki-tools/parse.mjs', [input], env)).code,
    1,
  )
  for (const args of [['show', 'missing'], ['unknown']])
    assert.equal(
      (await cli('packages/wiki-tools/doc-state.mjs', args, env)).code,
      1,
    )
  await ok('packages/wiki-tools/doc-state.mjs', [], env)
})

test('conversion CLI delegates Office parsing to HTTP and preserves returned images', async (t) => {
  const root = workspace(t),
    env = envFor(root)
  const base = await endpoint(t, async (req, res) => {
    let bytes = ''
    for await (const chunk of req) bytes += chunk
    assert.ok(bytes.includes('source-office-bytes'))
    res.setHeader('Content-Type', 'application/json')
    res.end(
      JSON.stringify({
        document: {
          md_content: '# Converted\n\n<!-- image -->',
          images: [
            { ext: 'png', data: Buffer.from('image-bytes').toString('base64') },
          ],
        },
      }),
    )
  })
  const input = join(root, 'manual.xlsx')
  write(input, 'source-office-bytes')
  await ok('packages/wiki-tools/parse.mjs', [input, '--module', 'wip'], {
    ...env,
    DOCLING_ENDPOINT: base,
  })
  assert.match(
    readFileSync(join(root, 'data/raw/wip/manual.md'), 'utf8'),
    /manual_assets\/img-001.png/,
  )
  assert.equal(
    readFileSync(join(root, 'data/raw/wip/manual_assets/img-001.png'), 'utf8'),
    'image-bytes',
  )
  assert.equal(
    readFileSync(join(root, 'data/raw/wip/manual.xlsx'), 'utf8'),
    'source-office-bytes',
  )
})

test('portable skill client uses independent reviewer credentials and rejects invalid origins', async (t) => {
  const root = workspace(t),
    script = '.agents/skills/cim-wiki/scripts/client.mjs',
    requests = []
  let status = 200,
    response = { errors: [] }
  const base = await endpoint(t, async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    requests.push({ path: req.url, auth: req.headers.authorization, body })
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(response))
  })
  const env = {
    ...envFor(root),
    CIM_WIKI_URL: base,
    CIM_WIKI_TOKEN: 'agent-unit-token',
    CIM_WIKI_REVIEW_TOKEN: 'reviewer-unit-token',
  }
  await ok(script, ['context', '--project', 'mes'], env)
  assert.equal(requests.at(-1).path, '/api/v2/knowledge/context?project=mes')
  await ok(
    script,
    ['review', '--json-file', '-'],
    env,
    '{"decision":"approve"}',
  )
  assert.equal(requests.at(-1).auth, 'Bearer reviewer-unit-token')
  await ok(script, ['validate'], env)
  response = { errors: [{ code: 'invalid' }] }
  assert.equal((await cli(script, ['validate'], env)).code, 1)
  status = 403
  response = { error: 'forbidden' }
  assert.match(
    (await cli(script, ['bundle', '--id', 'CR-TEST'], env)).stderr,
    /403: forbidden/,
  )
  for (const args of [
    [],
    ['unknown'],
    ['context', '--unknown', 'x'],
    ['context', '--project'],
    ['submit'],
    ['submit', '--json-file', '-'],
  ]) {
    assert.equal((await cli(script, args, env, 'invalid JSON')).code, 1)
  }
  for (const origin of [
    '',
    base + '/api',
    'ftp://example.test',
    'http://user:pass@example.test',
    base + '?query=1',
  ])
    assert.equal(
      (await cli(script, ['context'], { ...env, CIM_WIKI_URL: origin })).code,
      1,
    )
  assert.equal(
    (
      await cli(
        script,
        ['review', '--json-file', '-'],
        { ...env, CIM_WIKI_REVIEW_TOKEN: '' },
        '{}',
      )
    ).code,
    1,
  )
})

test('Admin client refreshes a configured project without leaking another project token', async (t) => {
  const root = workspace(t),
    registryPath = join(root, 'data/documents/project-registry.json')
  write(registryPath, { projects: { mes: { id: 'mes' } } })
  let status = 200
  const base = await endpoint(t, (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer unit-token')
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify(
        status === 200
          ? { id: 'mes', name: 'MES', modules: ['wip'] }
          : { error: 'denied' },
      ),
    )
  })
  const env = {
    ...envFor(root),
    ADMIN_URL: base,
    ADMIN_PROJECT_TOKEN: 'unit-token',
  }
  await ok('packages/wiki-tools/admin-pull.mjs', ['--all'], env)
  assert.equal(json(registryPath).projects.mes.name, 'MES')
  status = 401
  await ok('packages/wiki-tools/admin-pull.mjs', ['mes'], env)
  assert.equal(json(registryPath).projects.mes.name, 'MES')
  await ok('packages/wiki-tools/admin-pull.mjs', ['mes'], envFor(root))
  assert.equal(
    (await cli('packages/wiki-tools/admin-pull.mjs', [], env)).code,
    1,
  )
})

function git(root, ...args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: envFor(root),
  })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

test('repository synchronization maps changed files by longest module prefix and honors dry-run', async (t) => {
  const root = workspace(t),
    env = envFor(root),
    repo = join(root, 'repos/service'),
    registryPath = join(root, 'data/documents/project-registry.json')
  mkdirSync(repo, { recursive: true })
  git(repo, 'init', '-b', 'main')
  write(join(repo, 'src/wip/a.txt'), 'first')
  git(repo, 'add', '.')
  git(repo, 'commit', '-m', 'initial')
  const first = git(repo, 'rev-parse', 'HEAD')
  write(registryPath, {
    projects: {
      mes: {
        id: 'mes',
        name: 'MES',
        modules: ['general'],
        repos: [
          {
            name: 'service',
            submodule: 'repos/service',
            branch: 'main',
            last_sync_sha: first,
            module_mapping: { 'src/': 'general', 'src/wip/': 'wip' },
          },
        ],
        docs: [{ doc_id: 'source', path: 'source.md', sha256: 'old' }],
      },
    },
  })
  write(join(root, 'source.md'), '# Changed source')
  write(join(repo, 'src/wip/a.txt'), 'second')
  git(repo, 'add', '.')
  git(repo, 'commit', '-m', 'change')
  await ok('packages/wiki-tools/sync-repo.mjs', ['mes', '--dry-run'], env)
  assert.equal(json(registryPath).projects.mes.repos[0].last_sync_sha, first)
  await ok('packages/wiki-tools/sync-repo.mjs', ['--all'], env)
  assert.equal(
    json(registryPath).projects.mes.repos[0].last_sync_sha,
    git(repo, 'rev-parse', 'HEAD'),
  )
  const snapshot = json(join(root, 'data/sync/mes-diff-snapshot.json'))
  assert.ok(snapshot.affected_modules.includes('wip'))
  assert.ok(
    snapshot.changed_files.some((file) => file.path === 'src/wip/a.txt'),
  )
  await ok('packages/wiki-tools/sync-repo.mjs', ['mes'], env)
  await ok('packages/wiki-tools/sync-repo.mjs', ['missing'], env)
  assert.equal(
    (await cli('packages/wiki-tools/sync-repo.mjs', [], env)).code,
    1,
  )
})
