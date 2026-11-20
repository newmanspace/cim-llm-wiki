import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { atomicJson } from '../wiki-core/build-job-store.mjs'
import { readRegularFile } from '../wiki-core/safe-files.mjs'
import { packagePath, sha256 } from '../wiki-core/document-package.mjs'

const conflict = message => { throw Object.assign(new Error(message), { status: 409 }) }
const git = (root, args, options = {}) => execFileSync('/usr/bin/git', ['-c', 'safe.directory=' + root, '-C', root, ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options })
function file(root, path) {
  packagePath(path)
  if (path.split('/').some(p => ['.git', '.gitignore', '.gitattributes', '.vitepress', 'node_modules'].includes(p))) conflict('Reserved Wiki source path')
  const dest = resolve(root, path)
  for (let current = dest; current !== dirname(root); current = dirname(current)) {
    const stat = lstatSync(current, { throwIfNoEntry: false })
    if (stat?.isSymbolicLink() || (stat && current !== dest && !stat.isDirectory())) conflict('Unsafe Wiki source path')
    if (current === root) break
  }
  return dest
}
const currentHash = path => existsSync(path) ? sha256(readRegularFile(path)) : null
function identity(value, prefix) {
  const match = value.trim().match(/^(.*) <([^<>]+)> (\d+) ([+-]\d{4})$/)
  if (!match) conflict('Git identity is not configured')
  return { [prefix + '_NAME']: match[1], [prefix + '_EMAIL']: match[2], [prefix + '_DATE']: '@' + match[3] + ' ' + match[4] }
}
function assertCommittedCollision(root, item, current) {
  let committed
  try { committed = sha256(git(root, ['show', 'HEAD:' + item.path], { encoding: 'buffer' })) } catch { conflict('Untracked Wiki source collision: ' + item.path) }
  if (current !== committed) conflict('Uncommitted Wiki source collision: ' + item.path)
}
const sameDocument = (state, owner, artifact) => Boolean(artifact.logical_key && state.artifacts[owner.artifactId]?.logicalKey === artifact.logical_key)
function assertWritable(root, item, artifact, previous, receipt, state) {
  const current = currentHash(file(root, item.path)), own = state.files[item.path]
  const before = receipt.files.find(f => f.path === item.path)?.before
  if (own && own.artifactId !== artifact.id && current !== item.sha256 && !sameDocument(state, own, artifact)) conflict('Wiki source belongs to another reviewed document: ' + item.path)
  if (current !== item.sha256 && current !== before && current !== own?.sha256) conflict('Wiki source file changed: ' + item.path)
  // A first publication must not overwrite an unrelated local edit.
  if (!previous && current !== null && current !== item.sha256 && !own) assertCommittedCollision(root, item, current)
}

// Synchronous source receipts, not a queue. Each receipt identifies exact reviewed
// bytes; only these files may be included in an uncommitted build snapshot.
export function createWikiSource({ projectRoot, sourceFor, prefixFor = () => '' }) {
  const receiptPath = project => join(projectRoot, 'data/wiki-source', packagePath(project) + '.json')
  const load = project => existsSync(receiptPath(project)) ? JSON.parse(readFileSync(receiptPath(project), 'utf8')) : { artifacts: {}, files: {} }
  const save = (project, state) => { mkdirSync(dirname(receiptPath(project)), { recursive: true }); atomicJson(receiptPath(project), state) }
  function materialize(project, artifact, task, resources) {
    const root = sourceFor(project), state = load(project), digest = artifact.package_sha256 || artifact.content_sha256
    const previous = state.artifacts[artifact.id]
    if (previous && previous.digest !== digest) conflict('Reviewed artifact changed')
    const files = resources.map(resource => ({ path: packagePath(join(prefixFor(project), resource.path)), sha256: sha256(resource.bytes), bytes: resource.bytes }))
    const receipt = previous || { artifactId: artifact.id, version: artifact.version, logicalKey: artifact.logical_key, digest, taskId: task.id, files: files.map(({ path, sha256: hash }) => ({ path, sha256: hash, before: currentHash(file(root, path)) })) }
    if (previous?.state === 'published' && files.every(item => currentHash(file(root, item.path)) === item.sha256)) return previous
    state.artifacts[artifact.id] = receipt
    try {
      for (const item of files) assertWritable(root, item, artifact, previous, receipt, state)
      receipt.state = 'writing'; delete receipt.error; save(project, state)
      for (const item of files) {
        const dest = file(root, item.path)
        mkdirSync(dirname(dest), { recursive: true })
        const folder = join(projectRoot, 'data/wiki-source/tmp')
        mkdirSync(folder, { recursive: true })
        const temporary = join(folder, randomUUID())
        try { writeFileSync(temporary, item.bytes, { flag: 'wx', mode: 0o644 }); renameSync(temporary, dest) }
        finally { rmSync(temporary, { force: true }) }
        state.files[item.path] = { sha256: item.sha256, artifactId: artifact.id }
      }
      receipt.state = 'written'; save(project, state)
      return receipt
    } catch (error) {
      receipt.state = 'failed'; receipt.error = error.message; save(project, state)
      throw Object.assign(new Error('Review approved, but Wiki source write failed: ' + error.message), { status: error.status || 503, code: 'WIKI_SOURCE_WRITE_FAILED' })
    }
  }
  function assertEligible(project, artifactIDs) {
    const state = load(project), root = sourceFor(project)
    for (const receipt of Object.values(state.artifacts)) {
      if (artifactIDs.has(receipt.artifactId) || receipt.state === 'published' || receipt.state === 'superseded') continue
      const owned = receipt.files.filter(f => state.files[f.path]?.artifactId === receipt.artifactId)
      if (!owned.length) { receipt.state = 'superseded'; continue }
      for (const entry of owned) {
        let baseline = null
        try { baseline = sha256(git(root, ['show', 'HEAD:' + entry.path], { encoding: 'buffer' })) } catch { /* A pending new document has no committed baseline. */ }
        if (currentHash(file(root, entry.path)) !== baseline) conflict('Pending Wiki source approval is no longer current: ' + entry.path)
      }
    }
    save(project, state)
  }
  function register(project, paths) {
    const state = load(project), root = sourceFor(project)
    for (const path of paths) state.files[path] = { sha256: currentHash(file(root, path)), bundle: true }
    save(project, state)
  }
  function check(project, extraPaths = []) {
    const root = sourceFor(project), state = load(project)
    if (Object.values(state.artifacts).some(r => ['writing', 'failed'].includes(r.state))) conflict('Wiki source import is incomplete; retry the approved review')
    const allowed = new Map(Object.entries(state.files).map(([path, value]) => [path, value.sha256]))
    for (const path of extraPaths) allowed.set(path, currentHash(file(root, path)))
    const changes = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).split('\0').filter(Boolean)
    const paths = []
    for (const entry of changes) {
      const path = entry.slice(3)
      if (/[DRCU]/.test(entry.slice(0, 2)) || !allowed.has(path) || currentHash(file(root, path)) !== allowed.get(path)) conflict('Wiki Git checkout has uncommitted changes outside approved files: ' + path)
      paths.push(path)
    }
    // Git status omits ignored files; explicitly approved files must still be
    // captured and hashed, while unrelated ignored files stay outside the view.
    for (const [path, hash] of allowed) {
      let baseline = null
      try { baseline = sha256(git(root, ['show', 'HEAD:' + path], { encoding: 'buffer' })) } catch { /* New reviewed file. */ }
      const current = currentHash(file(root, path))
      if (current !== baseline && !paths.includes(path)) {
        if (current !== hash) conflict('Wiki Git checkout has uncommitted changes outside approved bytes: ' + path)
        paths.push(path)
      }
    }
    if (extraPaths.length) {
      for (const path of extraPaths) state.files[path] = { sha256: allowed.get(path), bundle: true }
      save(project, state)
    }
    return { root, paths, allowed }
  }
  function prepare(project, extraPaths = []) {
    const { root, paths, allowed } = check(project, extraPaths)
    const baseCommit = git(root, ['rev-parse', 'HEAD']).trim(), branch = paths.length ? git(root, ['symbolic-ref', 'HEAD']).trim() : null
    const temporary = mkdtempSync(join(tmpdir(), 'wiki-source-build-')), candidate = join(temporary, 'source'), index = join(temporary, 'index')
    const env = { ...process.env, GIT_INDEX_FILE: index }
    try {
      git(root, ['read-tree', baseCommit], { env })
      for (const path of paths) {
        const bytes = readRegularFile(file(root, path)), oid = git(root, ['hash-object', '-w', '--stdin'], { input: bytes }).trim()
        const mode = lstatSync(file(root, path)).mode & 0o111 ? '100755' : '100644'
        git(root, ['update-index', '--add', '--cacheinfo', mode + ',' + oid + ',' + path], { env })
      }
      const tree = git(root, ['write-tree'], { env }).trim(), author = git(root, ['var', 'GIT_AUTHOR_IDENT']).trim(), committer = git(root, ['var', 'GIT_COMMITTER_IDENT']).trim()
      const message = 'docs(wiki): publish reviewed sources for ' + project
      const content = `tree ${tree}\nparent ${baseCommit}\nauthor ${author}\ncommitter ${committer}\n\n${message}\n`
      // Calculate the eventual commit ID without creating a commit or moving HEAD.
      const gitCommit = git(root, ['hash-object', '-t', 'commit', '--stdin'], { input: content }).trim()
      mkdirSync(candidate)
      git(root, ['checkout-index', '--all', '--prefix=' + candidate + '/'], { env })
      return { candidate, cleanup: () => rmSync(temporary, { recursive: true, force: true }), plan: paths.length ? { baseCommit, branch, gitCommit, tree, message, identity: { ...identity(author, 'GIT_AUTHOR'), ...identity(committer, 'GIT_COMMITTER') }, files: paths.map(path => ({ path, sha256: allowed.get(path) })) } : null }
    } catch (error) { rmSync(temporary, { recursive: true, force: true }); throw error }
  }
  function commit(project, plan) {
    const root = sourceFor(project)
    if (git(root, ['symbolic-ref', 'HEAD']).trim() !== plan.branch) conflict('Wiki Git branch changed during build')
    const head = git(root, ['rev-parse', 'HEAD']).trim()
    if (head === plan.gitCommit) return head // Commit succeeded before an interrupted site update.
    if (head !== plan.baseCommit) conflict('Wiki Git baseline changed during build')
    for (const entry of plan.files) if (currentHash(file(root, entry.path)) !== entry.sha256) conflict('Reviewed Wiki source changed during build: ' + entry.path)
    for (const entry of plan.files) {
      const staged = git(root, ['ls-files', '--stage', '--', entry.path]).trim()
      if (!staged) git(root, ['add', '--force', '--intent-to-add', '--', entry.path])
      else {
        const oid = staged.split(/\s+/)[1]
        const desired = git(root, ['hash-object', '--stdin'], { input: readRegularFile(file(root, entry.path)) }).trim()
        let baseline = null
        try { baseline = git(root, ['rev-parse', plan.baseCommit + ':' + entry.path]).trim() } catch { /* New reviewed file. */ }
        if (oid !== desired && oid !== baseline && oid !== 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391') conflict('Staged Wiki file changed during build: ' + entry.path)
      }
    }
    // --only keeps other approved files and unrelated staged changes out of this commit.
    git(root, ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', 'commit', '--only', '--cleanup=verbatim', '-m', plan.message, '--', ...plan.files.map(f => f.path)], { env: { ...process.env, ...plan.identity } })
    const committed = git(root, ['rev-parse', 'HEAD']).trim()
    if (committed !== plan.gitCommit) conflict('Committed Wiki tree differs from the successful build')
    return committed
  }
  function published(project, commit) {
    const state = load(project), root = sourceFor(project)
    const included = entry => {
      try { return sha256(git(root, ['show', commit + ':' + entry.path], { encoding: 'buffer' })) === entry.sha256 }
      catch { return false }
    }
    for (const receipt of Object.values(state.artifacts)) if (receipt.state === 'written' && receipt.files.every(included)) { receipt.state = 'published'; receipt.gitCommit = commit }
    save(project, state)
  }
  return { materialize, assertEligible, register, check, prepare, commit, published, status: project => Object.values(load(project).artifacts) }
}
