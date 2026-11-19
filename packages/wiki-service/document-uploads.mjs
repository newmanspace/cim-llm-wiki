import { documentLimits } from '../wiki-core/package-limits.mjs'
import { mediaType } from '../wiki-core/file-media.mjs'
import { mkdirSync, readFileSync, writeFileSync, existsSync, openSync, closeSync, writeSync, rmSync, renameSync, lstatSync, readdirSync } from 'node:fs'
import { join, basename, extname } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { packageManifest, packageDigest, documentResources, sha256 } from '../wiki-core/document-package.mjs'
import { resolveShared } from '../wiki-core/sources.mjs'

const fail = (message, status = 422) => { throw Object.assign(new Error(message), { status }) }
const projectID = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value) || ['constructor', 'prototype', '__proto__'].includes(value)) fail('Invalid project')
  return value
}
export function createDocumentUploads({ projectRoot, roots }) {
  const root = join(projectRoot, 'data/document-uploads')
  const { file: maxFile, package: maxPackage } = documentLimits()
  function directory(project) {
    const path = join(root, projectID(project))
    mkdirSync(path, { recursive: true, mode: 0o700 })
    if (lstatSync(root).isSymbolicLink() || lstatSync(path).isSymbolicLink()) fail('Unsafe upload storage')
    return path
  }
  function metadata(project, uri, scheme) {
    const match = typeof uri === 'string' && uri.match(new RegExp('^' + scheme + '://([a-f0-9]{64})$'))
    if (!match) fail('Invalid uploaded resource URI')
    const path = join(directory(project), match[1] + (scheme === 'uploaded' ? '.file.json' : '.package.json'))
    if (!existsSync(path) || lstatSync(path).isSymbolicLink()) fail('Resource not found in project', 404)
    return JSON.parse(readFileSync(path, 'utf8'))
  }
  function saveJSON(path, data) {
    try { writeFileSync(path, JSON.stringify(data), { flag: 'wx', mode: 0o600 }) }
    catch (error) { if (error.code !== 'EEXIST') throw error }
  }
  function finish(project, filename, temp, digest, size, prefix) {
    if (['.', '..'].includes(filename)) fail('A safe source filename is required')
    if (!filename || basename(filename) !== filename || (/[\\]/.test(filename) || [...filename].some(char => char.charCodeAt(0) < 32))) fail('A safe source filename is required')
    const type = mediaType(filename, prefix)
    const id = sha256(filename + '\n' + digest), dir = directory(project)
    const path = join(dir, id + extname(filename).toLowerCase())
    if (existsSync(path)) {
      if (lstatSync(path).isSymbolicLink() || sha256(readFileSync(path)) !== digest) fail('Uploaded file changed', 409)
    } else renameSync(temp, path)
    const value = { uri: 'uploaded://' + id, filename, sha256: digest, size, media_type: type }
    saveJSON(join(dir, id + '.file.json'), value)
    return value
  }
  async function upload(project, filename, stream) {
    const temp = join(directory(project), randomUUID() + '.tmp'), fd = openSync(temp, 'wx', 0o600)
    const hash = createHash('sha256'); let size = 0, prefix = Buffer.alloc(0)
    try {
      for await (const chunk of stream) {
        size += chunk.length
        if (size > maxFile) fail('File exceeds upload limit', 413)
        if (prefix.length < 512) prefix = Buffer.concat([prefix, chunk.subarray(0, 512 - prefix.length)])
        hash.update(chunk)
        for (let offset = 0; offset < chunk.length;) offset += writeSync(fd, chunk, offset, chunk.length - offset)
      }
      closeSync(fd)
      return finish(project, filename, temp, hash.digest('hex'), size, prefix)
    } catch (error) {
      try { closeSync(fd) } catch { /* Descriptor may already be closed before commit. */ }
      throw error
    } finally { rmSync(temp, { force: true }) }
  }
  function put(project, filename, bytes) {
    if (bytes.length > maxFile) fail('File exceeds upload limit', 413)
    const temp = join(directory(project), randomUUID() + '.tmp')
    writeFileSync(temp, bytes, { flag: 'wx', mode: 0o600 })
    try { return finish(project, filename, temp, sha256(bytes), bytes.length, bytes.subarray(0, 512)) }
    finally { rmSync(temp, { force: true }) }
  }
  function file(project, uri) {
    const value = metadata(project, uri, 'uploaded')
    if (value.uri !== uri || 'uploaded://' + sha256(value.filename + '\n' + value.sha256) !== uri) fail('Uploaded metadata changed', 409)
    const path = join(directory(project), uri.slice(11) + extname(value.filename).toLowerCase())
    if (!existsSync(path) || lstatSync(path).isSymbolicLink() || sha256(readFileSync(path)) !== value.sha256) fail('Uploaded file is missing or changed', 409)
    saveJSON(join(directory(project), uri.slice(11) + '.pin.json'), { referenced: true })
    return { ...value, path }
  }
  function getPackage(project, uri) {
    const value = metadata(project, uri, 'document-package')
    if (value.uri !== uri || uri !== 'document-package://' + packageDigest(value) || packageDigest(value) !== value.package_sha256) fail('Package manifest changed', 409)
    for (const item of value.files) {
      const stored = file(project, item.uri)
      if (item.sha256 !== stored.sha256 || item.size !== stored.size || item.media_type !== stored.media_type) fail('Package file changed', 409)
    }
    return value
  }
  function seal(project, input) {
    if (!Array.isArray(input.files) || !input.files.length || input.files.length > 200) fail('Package requires 1–200 files')
    const files = input.files.map(item => {
      const stored = file(project, item.uri)
      if (stored.sha256 !== item.sha256) fail('Package hash mismatch', 409)
      return { path: item.path, uri: item.uri, sha256: stored.sha256, size: stored.size, media_type: stored.media_type }
    })
    const manifest = packageManifest(input.entry, files)
    if (files.reduce((size, item) => size + item.size, 0) > maxPackage) fail('Package exceeds size limit', 413)
    if (!readFileSync(file(project, files.find(item => item.path === input.entry).uri).path, 'utf8').trim()) fail('Markdown entry is empty')
    for (const item of files.filter(item => item.path.endsWith('.md'))) {
      const bytes = readFileSync(file(project, item.uri).path)
      if (bytes.length > 4 * 1024 * 1024) fail('Markdown exceeds 4 MiB', 413)
      const { resources } = documentResources(new TextDecoder('utf-8', { fatal: true }).decode(bytes), item.path)
      if (resources.some(resource => !files.some(candidate => candidate.path === resource.path))) fail('Package contains missing document resources')
    }
    const digest = packageDigest(manifest)
    const value = { ...manifest, files: manifest.files.map(item => ({ ...item, uri: files.find(candidate => candidate.path === item.path).uri })), uri: 'document-package://' + digest, package_sha256: digest }
    saveJSON(join(directory(project), digest + '.package.json'), value)
    return value
  }
  function resolve(project, uri) {
    if (uri?.startsWith('uploaded://')) return file(project, uri).path
    if (uri?.startsWith('document-package://')) { const value = getPackage(project, uri); return file(project, value.files.find(item => item.path === value.entry).uri).path }
    return resolveShared(uri, roots)
  }
  function cleanup({ now = Date.now(), retentionMs = 7 * 24 * 60 * 60 * 1000 } = {}) {
    let removed = 0
    if (!existsSync(root)) return { removed }
    for (const project of readdirSync(root)) {
      const dir = directory(project)
      for (const name of readdirSync(dir).filter(name => /^[a-f0-9-]{36}\.tmp$/.test(name))) {
        const path = join(dir, name)
        if (now - lstatSync(path).mtimeMs > 24 * 60 * 60 * 1000) { rmSync(path); removed++ }
      }
      for (const name of readdirSync(dir).filter(name => /^[a-f0-9]{64}\.file\.json$/.test(name))) {
        const path = join(dir, name), id = name.slice(0, 64)
        if (existsSync(join(dir, id + '.pin.json')) || now - lstatSync(path).mtimeMs < retentionMs) continue
        const value = JSON.parse(readFileSync(path, 'utf8'))
        rmSync(join(dir, id + extname(value.filename).toLowerCase()), { force: true })
        rmSync(path); removed++
      }
    }
    return { removed }
  }
  return { upload, put, file, seal, getPackage, resolve, cleanup }
}
