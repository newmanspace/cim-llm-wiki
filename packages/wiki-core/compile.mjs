import { cpSync, existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, renameSync, openSync, closeSync, lstatSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { PROJECT_ROOT, SCHEMA_VERSION, schemaErrors, nodeLocation, slugify } from './contracts.mjs'
import { renderPage } from './markdown.mjs'
import { assertValidWiki } from './validate.mjs'
import { activateFrozenRecords } from './docstore.mjs'

const json = path => existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
const encode = value => JSON.stringify(value, null, 2) + '\n'

// Each replacement is atomic. Recover already replaced files if a later write fails.
function replaceFiles(changes) {
  const before = new Map(), temporary = []
  try {
    for (const [path, content] of changes) {
      before.set(path, existsSync(path) ? readFileSync(path) : null)
      mkdirSync(dirname(path), { recursive: true })
      const temp = `${path}.${randomUUID()}.tmp`
      temporary.push(temp)
      writeFileSync(temp, content)
      renameSync(temp, path)
    }
  } catch (e) {
    for (const [path, content] of [...before].reverse()) {
      if (content === null) rmSync(path, { force: true })
      else writeFileSync(path, content)
    }
    throw e
  } finally {
    for (const path of temporary) rmSync(path, { force: true })
  }
}

export async function compileBundle(input, { projectRoot = PROJECT_ROOT, wikiRoot = join(projectRoot, 'data/wiki'), preview = false, afterPublish } = {}) {
  const data = structuredClone(input)
  if (!data || Array.isArray(data) || typeof data !== 'object' || !Array.isArray(data.nodes)) throw new Error('A versioned bundle object with nodes is required')
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  for (const node of data.nodes) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) throw new Error('Each node must be an object')
    node.schema_version ??= SCHEMA_VERSION
    node.source ??= data.source_doc
    node.module ??= data.module
    node.product ??= data.product
    node.version ??= data.version
    node.created_at ??= now
    node.updated_at = now
    node.confidence ??= node.qscore?.total
    node.status = node.status === 'approved' ? 'published' : (node.status ?? 'published')
    const loc = nodeLocation(node)
    if (node.plane && node.plane !== loc[0]) throw new Error(`Invalid plane for ${node.id}`)
    node.plane = loc[0]
  }
  const problems = schemaErrors('bundle', data)
  if (problems.length) throw new Error(`Bundle schema validation failed:\n${problems.join('\n')}`)
  const unique = new Set()
  for (const node of data.nodes) {
    const slug = slugify(node.id)
    if (unique.has(slug)) throw new Error(`Duplicate bundle node ID: ${node.id}`)
    unique.add(slug)
  }
  projectRoot = resolve(projectRoot)
  wikiRoot = resolve(wikiRoot)
  const docsDir = join(projectRoot, 'data/documents')
  mkdirSync(join(projectRoot, 'data'), { recursive: true })
  const lockPath = join(projectRoot, 'data/.wiki-publish.lock')
  let lock
  try { lock = openSync(lockPath, 'wx') }
  catch { throw new Error('Another wiki publication is running, or a previous publication left a lock; inspect data/.wiki-publish.lock before retrying') }
  let staging
  try {
    writeFileSync(lock, encode({ pid: process.pid, started_at: now, bundle_id: data.bundle_id }))
    staging = mkdtempSync(join(tmpdir(), 'wiki-candidate-'))
    const candidateRoot = join(staging, 'wiki')
    if (existsSync(wikiRoot)) cpSync(wikiRoot, candidateRoot, {
      recursive: true, filter: path => {
        if (['.git', '.vitepress'].includes(path.split('/').at(-1))) return false
        if (lstatSync(path).isSymbolicLink()) throw new Error(`Symbolic links are not permitted in published content: ${path}`)
        return true
      },
    })
    else mkdirSync(candidateRoot)
    const changes = new Map(), written = [], archived = [], wikiEntries = []
    for (const node of data.nodes) {
      if (node.review_level === 'archive') {
        changes.set(join(projectRoot, 'data/review/archived', data.bundle_id, `${slugify(node.id)}.json`), encode(node))
        archived.push(node.id)
        continue
      }
      const [plane, dir] = nodeLocation(node)
      const path = `${data.project}/${plane}/${dir}/${slugify(node.id)}.md`
      const { title, content, qscore, ...fm } = node
      const text = renderPage(fm, title, content)
      const dest = join(candidateRoot, path)
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, text)
      changes.set(join(wikiRoot, path), text)
      written.push(path)
      wikiEntries.push({ plane, path: `data/wiki/${path}`, node_id: node.id, bundle_id: data.bundle_id })
    }
    try { assertValidWiki({ projectRoot, wikiRoot: candidateRoot }) }
    catch (e) { throw new Error(e.message.replaceAll(candidateRoot, wikiRoot)) }
    if (preview) return { project: data.project, bundleId: data.bundle_id, written, archived, wikiEntries, preview: true }

    const registryPath = join(docsDir, 'project-registry.json')
    const registry = json(registryPath) || { projects: {} }
    registry.projects ||= {}
    const project = registry.projects[data.project] ||= {}
    project.wiki_nodes ||= { doc: [], code: [] }
    for (const entry of wikiEntries) {
      project.wiki_nodes[entry.plane] ||= []
      if (!project.wiki_nodes[entry.plane].includes(entry.path)) project.wiki_nodes[entry.plane].push(entry.path)
    }
    project.updated_at = now
    changes.set(registryPath, encode(registry))

    const apiPath = join(docsDir, 'api-registry.json')
    const apiRegistry = json(apiPath) || {}
    for (const node of data.nodes.filter(n => n.type === 'api' && n.transaction_code && n.review_level !== 'archive')) {
      const path = `data/wiki/${data.project}/code/apis/${slugify(node.id)}.md`
      const code = node.transaction_code.toUpperCase()
      if (apiRegistry[code] && apiRegistry[code].page !== path) throw new Error(`Transaction code already registered: ${code}`)
      apiRegistry[code] = { page: path, id: node.id, bundle: data.bundle_id, registered_at: now }
    }
    if (Object.keys(apiRegistry).length) changes.set(apiPath, encode(apiRegistry))

    const manifestPath = join(docsDir, 'manifest.json')
    const manifest = json(manifestPath)
    if (manifest) {
      const sources = new Set(data.nodes.filter(n => n.review_level !== 'archive').flatMap(n => Array.isArray(n.source) ? n.source : [n.source]))
      const activated = activateFrozenRecords(manifest, [...sources], 'wiki-core', data.bundle_id, now)
      if (activated.length) {
        manifest.updated_at = now
        changes.set(manifestPath, encode(manifest))
      }
    }
    replaceFiles(changes)
    const result = { project: data.project, bundleId: data.bundle_id, written, archived, wikiEntries, preview: false }
    if (afterPublish) await afterPublish(result)
    return result
  } finally {
    if (staging) rmSync(staging, { recursive: true, force: true })
    closeSync(lock)
    rmSync(lockPath, { force: true })
  }
}
