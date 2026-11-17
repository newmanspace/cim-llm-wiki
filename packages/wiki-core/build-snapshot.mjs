import { exportCommittedDocs, repositoryCommit, repositoryKind } from './repository-docs.mjs'
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { hashFile, hashValue, resolveSource } from './sources.mjs'
import { assertValidWiki } from './validate.mjs'
import { atomicJson } from './build-job-store.mjs'
import { toolchainIdentity } from './build-toolchain.mjs'
import { parsePage } from './markdown.mjs'
import { PROJECT_ROOT } from './contracts.mjs'

export function copySafe(source, target) {
  const stat = lstatSync(source)
  if (stat.isSymbolicLink()) throw new Error('Symbolic links are not allowed in build inputs or outputs')
  if (stat.isDirectory()) {
    mkdirSync(target, { recursive: true })
    for (const name of readdirSync(source)) if (!['.git', '.vitepress'].includes(name)) copySafe(join(source, name), join(target, name))
  } else if (stat.isFile()) {
    mkdirSync(dirname(target), { recursive: true }); cpSync(source, target)
  } else throw new Error('Only regular build files are supported')
}
export function treeDigest(root, exclude = []) {
  const entries = []
  function walk(path) {
    for (const name of readdirSync(path).sort()) {
      const file = join(path, name), stat = lstatSync(file)
      if (exclude.includes(relative(root, file))) continue
      if (stat.isSymbolicLink()) throw new Error('Symbolic links are not allowed in a build snapshot')
      if (stat.isDirectory()) walk(file)
      else if (stat.isFile()) entries.push([relative(root, file), hashFile(file)])
      else throw new Error('Invalid build file')
    }
  }
  walk(root)
  return hashValue(entries)
}
export function gitIdentity(wikiRoot) {
  const git = args => execFileSync('git', ['-c', 'safe.directory=' + wikiRoot, '-C', wikiRoot, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  if (!existsSync(join(wikiRoot, '.git')) || realpathSync(git(['rev-parse', '--show-toplevel'])) !== realpathSync(wikiRoot)) throw new Error('Wiki requires an independent Git checkout')
  if (git(['status', '--porcelain', '--untracked-files=all'])) throw new Error('Wiki Git checkout has uncommitted changes')
  return git(['rev-parse', 'HEAD'])
}
function copySource(source, projectRoot, roots, snapshotRoot) {
  const original = resolveSource(source, projectRoot, roots)
  const match = source.match(/^shared:\/\/([^/]+)\/(.+)$/)
  const destination = match ? join(snapshotRoot, 'shared', match[1], match[2]) : join(snapshotRoot, 'state', relative(projectRoot, original))
  copySafe(original, destination)
  return { path: original, sha256: hashFile(destination) }
}
function snapshotPermissions(path) {
  const stat = lstatSync(path)
  chmodSync(path, stat.isDirectory() ? 0o750 : 0o640)
  if (stat.isDirectory()) for (const name of readdirSync(path)) snapshotPermissions(join(path, name))
}
export function captureSnapshot({ projectRoot, wikiRoot, gitRoot = wikiRoot, roots, buildsRoot, project, sourceRoot, contentKind = 'strict_nodes' }) {
  if (contentKind === repositoryKind) return captureRepository({ gitRoot, project, buildsRoot })
  const gitCommit = gitIdentity(gitRoot), toolchainDigest = toolchainIdentity(PROJECT_ROOT), id = randomUUID(), target = join(buildsRoot, id)
  mkdirSync(target, { recursive: true })
  try {
    assertValidWiki({ projectRoot, wikiRoot, roots, project, sourceRoot })
    copyWikiInput({ wikiRoot, sourceRoot, project, target })
    for (const folder of ['documents', 'document-defaults']) {
      const path = join(projectRoot, 'data', folder)
      if (existsSync(path)) copySafe(path, join(target, 'state/data', folder))
    }
    const frozenRoots = Object.fromEntries(Object.keys(roots).map(key => [key, join(target, 'shared', key)]))
    for (const root of Object.values(frozenRoots)) mkdirSync(root, { recursive: true })
    const manifestPath = join(projectRoot, 'data/documents/manifest.json')
    const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { docs: [] }
    scopeSnapshotManifest(target, project, manifest)
    const checks = []
    for (const record of manifest.docs) {
      checks.push(copySource(record.path, projectRoot, roots, target))
      if (record.original_uri?.startsWith('shared://')) checks.push(copySource(record.original_uri, projectRoot, roots, target))
    }
    if (checks.some(check => hashFile(check.path) !== check.sha256)) throw new Error('Source changed while capturing build snapshot')
    if (gitIdentity(gitRoot) !== gitCommit) throw new Error('Wiki Git commit changed during snapshot capture')
    const context = { projectRoot: join(target, 'state'), wikiRoot: join(target, 'state/data/wiki'), roots: frozenRoots, project }
    assertValidWiki(context)
    const digest = treeDigest(target)
    atomicJson(join(target, 'snapshot.json'), { schemaVersion: 1, gitCommit, digest, rootIds: Object.keys(roots), liveChecks: checks, project })
    snapshotPermissions(target)
    return { snapshot: id, digest, gitCommit, toolchainDigest }
  } catch (error) { rmSync(target, { recursive: true, force: true }); throw error }
}
export function snapshotContext(buildsRoot, id, digest) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid snapshot ID')
  const root = resolve(buildsRoot, id)
  const metadata = JSON.parse(readFileSync(join(root, 'snapshot.json'), 'utf8'))
  if (metadata.schemaVersion !== 1 || metadata.digest !== digest || treeDigest(root, ['snapshot.json']) !== digest) throw new Error('Build snapshot integrity check failed')
  return { contentKind: metadata.contentKind, project: metadata.project, projectRoot: join(root, 'state'), wikiRoot: join(root, 'state/data/wiki'), roots: Object.fromEntries(metadata.rootIds.map(key => [key, join(root, 'shared', key)])) }
}

function copyWikiInput({ wikiRoot, sourceRoot, project, target }) {
  copySafe(sourceRoot || wikiRoot, join(target, 'state/data/wiki', sourceRoot ? project : ''))
}
function scopeSnapshotManifest(target, project, manifest) {
    if (project) {
      const references = new Set()
      function collect(path) {
        for (const item of readdirSync(path, { withFileTypes: true })) {
          const file = join(path, item.name)
          if (item.isDirectory()) collect(file)
          else if (item.name.endsWith('.md')) {
            const { fm } = parsePage(readFileSync(file, 'utf8'))
            for (const source of Array.isArray(fm.source) ? fm.source : [fm.source]) if (source) references.add(source)
          }
        }
      }
      collect(join(target, 'state/data/wiki', project))
      manifest.docs = manifest.docs.filter(record => record.project === project || references.has(record.path))
      atomicJson(join(target, 'state/data/documents/manifest.json'), manifest)
      const registryPath = join(target, 'state/data/documents/project-registry.json')
      if (existsSync(registryPath)) {
        const registry = JSON.parse(readFileSync(registryPath, 'utf8'))
        registry.projects = Object.fromEntries(Object.entries(registry.projects || {}).filter(([id]) => id === project))
        atomicJson(registryPath, registry)
      }
    }
}

function captureRepository({ gitRoot, project, buildsRoot }) {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(project || '')) throw new Error('Invalid repository project')
  const gitCommit = repositoryCommit(gitRoot), toolchainDigest = toolchainIdentity(PROJECT_ROOT), id = randomUUID(), target = join(buildsRoot, id)
  mkdirSync(target, { recursive: true })
  try {
    exportCommittedDocs(gitRoot, gitCommit, join(target, 'state/data/wiki', project))
    if (repositoryCommit(gitRoot) !== gitCommit) throw new Error('Repository Git baseline changed during snapshot capture')
    const digest = treeDigest(target)
    atomicJson(join(target, 'snapshot.json'), { schemaVersion: 1, contentKind: repositoryKind, gitCommit, project, digest, rootIds: [], liveChecks: [] })
    snapshotPermissions(target)
    return { snapshot: id, digest, gitCommit, toolchainDigest, contentKind: repositoryKind }
  } catch (error) { rmSync(target, { recursive: true, force: true }); throw error }
}
