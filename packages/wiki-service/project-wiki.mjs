import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { execFileSync } from 'node:child_process'
import { atomicJson } from '../wiki-core/build-job-store.mjs'
import { repositoryKind } from '../wiki-core/repository-docs.mjs'

const fail = (message, status = 409) => { throw Object.assign(new Error(message), { status }) }
export function checkProject(project) {
  if (typeof project !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/i.test(project) || ['templates', 'constructor', '__proto__', 'prototype'].includes(project)) fail('Invalid project', 422)
  return project
}
const inside = (root, path) => path !== root && !relative(root, path).startsWith('..' + sep) && relative(root, path) !== '..' && !isAbsolute(relative(root, path))

// Storage settings belong to the knowledge service, which owns the filesystem.
export function createProjectWiki({ projectRoot }) {
  const storage = resolve(projectRoot, 'data/projects'), settingsRoot = join(projectRoot, 'data/project-wiki')
  function safe(path) {
    path = resolve(path)
    if (!inside(storage, path)) fail('Wiki source must be inside the project storage root', 422)
    let cursor = path
    while (cursor !== dirname(cursor)) {
      if (lstatSync(cursor, { throwIfNoEntry: false })?.isSymbolicLink()) fail('Wiki paths must not contain symbolic links', 422)
      cursor = dirname(cursor)
    }
    return path
  }
  const file = project => join(settingsRoot, checkProject(project) + '.json')
  function save(project, value) { mkdirSync(settingsRoot, { recursive: true }); atomicJson(file(project), value) }
  function config(project) {
    const path = file(project)
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { sourceDirectory: join('data/projects', project, 'wiki') }
  }
  function projectSource(project, value) {
    const path = safe(value), base = join(storage, checkProject(project)), site = join(base, 'site')
    if (!inside(base, path) || inside(site, path) || path === site) fail('Source must be inside its project directory and outside site output', 422)
    return path
  }
  function kind(project) { return config(project).contentKind || 'strict_nodes' }
  function source(project) { return projectSource(project, resolve(projectRoot, config(project).sourceDirectory)) }
  function git(path, args) { return execFileSync('/usr/bin/git', ['-c', 'safe.directory=' + path, '-C', path, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 }).trim() }
  function initialized(path) {
    if (!existsSync(join(path, '.git'))) return false
    if (lstatSync(join(path, '.git')).isSymbolicLink() || !lstatSync(join(path, '.git')).isDirectory()) fail('Wiki requires an independent local Git repository')
    return realpathSync(git(path, ['rev-parse', '--show-toplevel'])) === realpathSync(path)
  }
  function status(project) {
    const path = source(project), ready = initialized(path), siteDirectory = join(storage, project, 'site/html')
    return { project, contentKind: kind(project), sourceDirectory: path, storageRoot: storage, siteDirectory, siteUrl: `/wiki/${project}/`, initialized: ready, published: existsSync(join(siteDirectory, 'index.html')), gitStatus: ready ? git(path, ['status', '--porcelain', '--untracked-files=all']) ? 'dirty' : 'clean' : 'uninitialized' }
  }
  function configure(project, data) {
    validateSettings(data)
    if (!isAbsolute(data.sourceDirectory) || data.sourceDirectory.includes('\0')) fail('Source directory must be an absolute path', 422)
    const next = projectSource(project, data.sourceDirectory), current = source(project)
    const contentKind = data.contentKind || kind(project)
    if (initialized(current) && contentKind !== kind(project)) fail('Initialized Wiki content kind cannot be changed')
    if (initialized(current) && current !== next) fail('Initialized Wiki source cannot be moved through settings')
    for (const other of existsSync(settingsRoot) ? readdirSync(settingsRoot) : []) {
      if (!other.endsWith('.json') || other === project + '.json') continue
      const used = safe(resolve(projectRoot, JSON.parse(readFileSync(join(settingsRoot, other), 'utf8')).sourceDirectory))
      if (used === next || inside(used, next) || inside(next, used)) fail('Wiki source overlaps another project')
    }
    save(project, { sourceDirectory: relative(projectRoot, next), contentKind })
    return status(project)
  }
  function initialize(project) {
    const path = source(project)
    if (initialized(path)) return status(project)
    if (existsSync(path) && readdirSync(path).length) fail('Source directory is not empty; choose an empty directory or configure an existing independent Git repository')
    mkdirSync(path, { recursive: true })
    try {
      git(path, ['init', '-b', 'main'])
      git(path, ['config', 'user.name', 'cim-wiki-pipeline'])
      git(path, ['config', 'user.email', 'pipeline@cim-wiki.local'])
      for (const plane of ['doc', 'code', 'assets']) mkdirSync(join(path, plane), { recursive: true })
      writeFileSync(join(path, '.gitignore'), '.vitepress/\nnode_modules/\n.cache/\n')
      // Only the generated ignore file is committed; no existing content is staged.
      git(path, ['add', '--', '.gitignore'])
      git(path, ['commit', '-m', 'chore: initialize project Wiki'])
      save(project, { sourceDirectory: relative(projectRoot, path), contentKind: kind(project) })
      return status(project)
    } catch (error) { rmSync(path, { recursive: true, force: true }); throw error }
  }
  const list = () => (existsSync(settingsRoot) ? readdirSync(settingsRoot).filter(name => name.endsWith('.json')).map(name => checkProject(name.slice(0, -5))) : [])
  return { source, kind, status, configure, initialize, list }
}

function validateSettings(data) {
  if (!data || Object.keys(data).some(k => !['sourceDirectory', 'contentKind'].includes(k)) || typeof data.sourceDirectory !== 'string') fail('Only sourceDirectory and contentKind may be configured', 422)
  if (data.contentKind !== undefined && !['strict_nodes', repositoryKind].includes(data.contentKind)) fail('Invalid Wiki content kind', 422)
}
