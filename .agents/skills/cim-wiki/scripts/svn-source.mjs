#!/usr/bin/env node
// Standalone SVN collector. Authentication only uses the caller's SVN cache.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { runSourceCLI } from './source-client.mjs'
import {
  extensions,
  commandFailure,
  safeRepositoryFile,
  destinationRoot,
  sharedURI,
  validateBinding,
} from './source-files.mjs'
import { mkdirSync, readFileSync, writeFileSync, lstatSync } from 'node:fs'
import { resolve, join, relative, isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
const exec = promisify(execFile)
const xmlText = (value) =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
const field = (text, name) =>
  xmlText(text.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] || '')
async function svn(args) {
  try {
    return (
      await exec('svn', [...args, '--non-interactive', '--no-auth-cache'], {
        timeout: 120000,
        maxBuffer: 16 * 1024 * 1024,
        env: process.env,
      })
    ).stdout
  } catch (error) {
    throw commandFailure(
      error,
      'SVN',
      'verify cached credentials, TLS trust, repository permissions and revision',
    )
  }
}
function validateCollection(source, project, mount, allowFile) {
  validateBinding(project, mount)
  const url = new URL(source.url)
  if (
    (!['http:', 'https:'].includes(url.protocol) && !(allowFile && url.protocol === 'file:')) ||
    (!url.hostname && url.protocol !== 'file:') ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('SVN requires an HTTP or HTTPS URL without credentials, query or fragment')
  const parts = validateSubpath(source.subpath)
  const selected = source.revision_selector || 'HEAD'
  if (!/^(HEAD|[0-9]+)$/.test(selected))
    throw new Error('Invalid SVN revision selector')
  const target =
    url.href.replace(/\/+$/, '') +
    (parts.length ? '/' + parts.map(encodeURIComponent).join('/') : '')
  return { target, selected }
}
function validateSubpath(subpath) {
  const parts = (subpath || '').split('/').filter(Boolean)
  if (
    parts.some(
      (p) =>
        p === '..' ||
        p === '.' ||
        p.includes('\\') ||
        p.includes('@') ||
        /[%?#]/.test(p) ||
        p.includes(String.fromCharCode(0)),
    )
  )
    throw new Error('Invalid SVN subpath')
  if (subpath && parts.join('/') !== subpath)
    throw new Error('Invalid SVN subpath')
  return parts
}
function listFiles(listing, maxFiles, maxBytes) {
  const files = []
  let total = 0
  for (const match of listing.matchAll(
    /<entry\s+kind="file">([\s\S]*?)<\/entry>/g,
  )) {
    const name = field(match[1], 'name'),
      size = Number(field(match[1], 'size'))
    if (!extensions.test(name)) continue
    if (!safeRepositoryFile(name) || !Number.isSafeInteger(size) || size < 0)
      throw new Error('Unsafe SVN file entry')
    total += size
    files.push({ name, size })
  }
  if (!files.length || files.length > maxFiles || total > maxBytes)
    throw new Error('SVN selection is empty or exceeds collection limits')
  return files
}
export async function collectSvnSource({
  source,
  project,
  sharedRoot,
  mount,
  allowFile = false,
  maxFiles = 500,
  maxBytes = 100 * 1024 * 1024,
}) {
  const { target, selected } = validateCollection(
    source,
    project,
    mount,
    allowFile,
  )
  const info = await svn([
    'info',
    '--xml',
    '--revision',
    selected,
    `${target}@${selected}`,
  ])
  const revision = info.match(/<entry\s[^>]*revision="([0-9]+)"/)?.[1]
  const uuid = field(info, 'uuid'),
    rootUrl = field(info, 'root'),
    entryUrl = field(info, 'url')
  if (!revision || !uuid || !rootUrl || !entryUrl.startsWith(rootUrl))
    throw new Error('SVN returned incomplete revision evidence')
  const repositoryPrefix = decodeURIComponent(
    entryUrl.slice(rootUrl.length),
  ).replace(/^\//, '')
  const listing = await svn([
    'list',
    '--xml',
    '--recursive',
    '--revision',
    revision,
    `${target}@${revision}`,
  ])
  const files = listFiles(listing, maxFiles, maxBytes)
  const { root, local } = destinationRoot(sharedRoot, project)
  const infoPath = join(local, 'svn-info.xml')
  writeFileSync(infoPath, info, { flag: 'wx', mode: 0o600 })
  const uri = (path) => sharedURI(root, mount, path)
  const out = []
  for (const file of files) {
    const dest = resolve(local, file.name),
      rel = relative(local, dest)
    if (rel.startsWith('..') || isAbsolute(rel))
      throw new Error('SVN path escaped snapshot')
    mkdirSync(resolve(dest, '..'), { recursive: true, mode: 0o700 })
    await svn([
      'export',
      '--revision',
      revision,
      `${target}/${file.name.split('/').map(encodeURIComponent).join('/')}@${revision}`,
      dest,
    ])
    if (!lstatSync(dest).isFile() || lstatSync(dest).isSymbolicLink())
      throw new Error('SVN exports must be regular files')
    const bytes = readFileSync(dest)
    if (bytes.length !== file.size)
      throw new Error('SVN exported size differs from pinned listing')
    out.push({
      repository_path: [repositoryPrefix, file.name].filter(Boolean).join('/'),
      local_path: dest,
      source_uri: uri(dest),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    })
  }
  return {
    project,
    revision,
    repository_uuid: uuid,
    svn_info_uri: uri(infoPath),
    files: out,
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  runSourceCLI(collectSvnSource, 'svn').catch((e) => {
    console.error(e.message)
    process.exitCode = 1
  })
