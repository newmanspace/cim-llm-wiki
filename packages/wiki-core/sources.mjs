import { existsSync, realpathSync, readFileSync, statSync, openSync, closeSync, mkdirSync, writeFileSync, constants } from 'node:fs'
import { resolve, relative, sep, dirname } from 'node:path'
import { createHash } from 'node:crypto'

export function sharedRoots() {
  const roots = JSON.parse(process.env.CIM_WIKI_SHARED_ROOTS || '{}')
  if (!roots || typeof roots !== 'object' || Array.isArray(roots)) throw new Error('CIM_WIKI_SHARED_ROOTS must be a JSON object')
  for (const [id, path] of Object.entries(roots)) {
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || typeof path !== 'string' || !path.startsWith('/')) throw new Error('Shared roots require a valid ID and absolute directory')
  }
  return roots
}
const within = (root, path) => { const rel = relative(root, path); return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !rel.startsWith(sep)) }

export function resolveShared(uri, roots = sharedRoots(), { write = false } = {}) {
  const match = typeof uri === 'string' && uri.match(/^shared:\/\/([a-zA-Z0-9_-]+)\/(.+)$/)
  if (!match || !Object.hasOwn(roots, match[1])) throw new Error('Unknown shared source or root')
  const parts = match[2].split('/')
  if (parts.some(p => !p || p === '.' || p === '..' || /[\\\0?#%]/.test(p))) throw new Error('Invalid shared relative path')
  const root = realpathSync(roots[match[1]])
  const path = resolve(root, ...parts)
  if (!within(root, path)) throw new Error('Shared path escapes its root')
  let ancestor = path
  while (!existsSync(ancestor)) {
    if (!write) throw new Error(`Shared source missing: ${uri}`)
    const parent = dirname(ancestor)
    if (parent === ancestor) throw new Error('Shared root does not exist')
    ancestor = parent
  }
  if (!within(root, realpathSync(ancestor))) throw new Error('Shared path escapes its root through a symbolic link')
  if (!write && !statSync(path).isFile()) throw new Error('Shared source must be a file')
  return path
}

export function resolveSource(source, projectRoot, roots = sharedRoots()) {
  if (typeof source !== 'string') throw new Error('Source must be a path or shared URI')
  if (source.startsWith('shared://')) return resolveShared(source, roots)
  const path = resolve(projectRoot, source)
  if (!within(resolve(projectRoot), path) || path === resolve(projectRoot)) throw new Error('Source escapes project root')
  if (existsSync(path) && !within(realpathSync(projectRoot), realpathSync(path))) throw new Error('Source escapes project root through a symbolic link')
  return path
}

export const hashFile = path => createHash('sha256').update(readFileSync(path)).digest('hex')
export const hashValue = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')

export function nodeProvenance(node, manifest) {
  return (Array.isArray(node.source) ? node.source : [node.source]).filter(s => typeof s === 'string' && s.startsWith('shared://')).map(source => {
    const rec = manifest.docs.find(d => d.path === source)
    if (!rec?.original_uri || !rec.original_path || !rec.original_sha256 || !rec.version) throw new Error(`Original document provenance is missing: ${source}`)
    return { source, original_uri: rec.original_uri, original_path: rec.original_path,
      original_sha256: rec.original_sha256, version: rec.version,
      ...(rec.ingest_path ? { ingest_path: rec.ingest_path } : {}) }
  })
}


// Anchor each path component to an open directory. O_NOFOLLOW alone on the
// final filename would still allow a shared parent to be swapped for a symlink.
export function writeSharedFile(uri, content, roots = sharedRoots()) {
  resolveShared(uri, roots, { write: true })
  const [, rootId, relativePath] = uri.match(/^shared:\/\/([^/]+)\/(.+)$/)
  const parts = relativePath.split('/')
  const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
  const descriptors = []
  try {
    let directory = openSync(realpathSync(roots[rootId]), directoryFlags)
    descriptors.push(directory)
    for (const part of parts.slice(0, -1)) {
      const path = `/proc/self/fd/${directory}/${part}`
      try { mkdirSync(path) } catch (e) { if (e.code !== 'EEXIST') throw e }
      directory = openSync(path, directoryFlags)
      descriptors.push(directory)
    }
    const file = openSync(`/proc/self/fd/${directory}/${parts.at(-1)}`,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o640)
    descriptors.push(file)
    writeFileSync(file, content)
  } finally {
    for (const fd of descriptors.reverse()) closeSync(fd)
  }
}
