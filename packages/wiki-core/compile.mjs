import { sharedRoots, nodeProvenance } from './sources.mjs'
import {
  cpSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  renameSync,
  openSync,
  closeSync,
  lstatSync,
} from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import {
  PROJECT_ROOT,
  SCHEMA_VERSION,
  schemaErrors,
  nodeLocation,
  slugify,
} from './contracts.mjs'
import { renderPage } from './markdown.mjs'
import { assertValidWiki } from './validate.mjs'
import { activateFrozenRecords } from './docstore.mjs'

const json = (path) =>
  existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
const encode = (value) => JSON.stringify(value, null, 2) + '\n'

// Each replacement is atomic. Recover already replaced files if a later write fails.
function replaceFiles(changes) {
  const before = new Map(),
    temporary = []
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

function normalizeNode(node, data, sourceManifest, now) {
  if (!node || typeof node !== 'object' || Array.isArray(node))
    throw new Error('Each node must be an object')
  const defaults = {
    schema_version: SCHEMA_VERSION,
    source: data.source_doc,
    module: data.module,
    product: data.product,
    version: data.version,
    created_at: now,
    confidence: node.qscore?.total,
  }
  for (const [key, value] of Object.entries(defaults))
    if (node[key] == null) node[key] = value
  const provenance = nodeProvenance(node, sourceManifest)
  if (provenance.length) node.provenance = provenance
  node.updated_at = now
  node.status =
    node.status === 'approved' ? 'published' : (node.status ?? 'published')
  const [plane] = nodeLocation(node)
  if (node.plane && node.plane !== plane)
    throw new Error(`Invalid plane for ${node.id}`)
  node.plane = plane
}

function normalizeBundle(input, projectRoot, now) {
  const data = structuredClone(input)
  if (
    !data ||
    Array.isArray(data) ||
    typeof data !== 'object' ||
    !Array.isArray(data.nodes)
  )
    throw new Error('A versioned bundle object with nodes is required')
  const sourceManifest = json(
    join(projectRoot, 'data/documents/manifest.json'),
  ) || { docs: [] }
  for (const node of data.nodes) normalizeNode(node, data, sourceManifest, now)
  const problems = schemaErrors('bundle', data)
  if (problems.length)
    throw new Error(`Bundle schema validation failed:\n${problems.join('\n')}`)
  const unique = new Set()
  for (const node of data.nodes) {
    const slug = slugify(node.id)
    if (unique.has(slug))
      throw new Error(`Duplicate bundle node ID: ${node.id}`)
    unique.add(slug)
  }
  return data
}

function copyCandidate(wikiRoot, candidateRoot) {
  if (!existsSync(wikiRoot)) {
    mkdirSync(candidateRoot)
    return
  }
  cpSync(wikiRoot, candidateRoot, {
    recursive: true,
    filter: (path) => {
      if (['.git', '.vitepress'].includes(path.split('/').at(-1))) return false
      if (lstatSync(path).isSymbolicLink())
        throw new Error(
          `Symbolic links are not permitted in published content: ${path}`,
        )
      return true
    },
  })
}

function stageNodes(data, projectRoot, wikiRoot, candidateRoot) {
  const changes = new Map(),
    written = [],
    archived = [],
    wikiEntries = []
  for (const node of data.nodes) {
    if (node.review_level === 'archive') {
      changes.set(
        join(
          projectRoot,
          'data/review/archived',
          data.bundle_id,
          `${slugify(node.id)}.json`,
        ),
        encode(node),
      )
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
    wikiEntries.push({
      plane,
      path: `data/wiki/${path}`,
      node_id: node.id,
      bundle_id: data.bundle_id,
    })
  }
  return { changes, written, archived, wikiEntries }
}

function updateProjectRegistry(docsDir, data, wikiEntries, now, changes) {
  const registryPath = join(docsDir, 'project-registry.json')
  const registry = json(registryPath) || { projects: {} }
  registry.projects ||= {}
  const project = (registry.projects[data.project] ||= {})
  project.wiki_nodes ||= { doc: [], code: [] }
  for (const entry of wikiEntries) {
    project.wiki_nodes[entry.plane] ||= []
    if (!project.wiki_nodes[entry.plane].includes(entry.path))
      project.wiki_nodes[entry.plane].push(entry.path)
  }
  project.updated_at = now
  changes.set(registryPath, encode(registry))
}

function updateAPIRegistry(docsDir, data, now, changes) {
  const apiPath = join(docsDir, 'api-registry.json')
  const registry = json(apiPath) || {}
  for (const node of data.nodes.filter(
    (n) =>
      n.type === 'api' && n.transaction_code && n.review_level !== 'archive',
  )) {
    const path = `data/wiki/${data.project}/code/apis/${slugify(node.id)}.md`
    const code = node.transaction_code.toUpperCase()
    if (registry[code] && registry[code].page !== path)
      throw new Error(`Transaction code already registered: ${code}`)
    registry[code] = {
      page: path,
      id: node.id,
      bundle: data.bundle_id,
      registered_at: now,
    }
  }
  if (Object.keys(registry).length) changes.set(apiPath, encode(registry))
}

function activateSources(docsDir, data, now, changes) {
  const manifestPath = join(docsDir, 'manifest.json')
  const manifest = json(manifestPath)
  if (!manifest) return
  const sources = new Set(
    data.nodes
      .filter((n) => n.review_level !== 'archive')
      .flatMap((n) => (Array.isArray(n.source) ? n.source : [n.source])),
  )
  const activated = activateFrozenRecords(
    manifest,
    [...sources],
    'wiki-core',
    data.bundle_id,
    now,
  )
  if (activated.length) {
    manifest.updated_at = now
    changes.set(manifestPath, encode(manifest))
  }
}

export async function compileBundle(
  input,
  {
    projectRoot = process.env.CIM_WIKI_WORKSPACE || PROJECT_ROOT,
    wikiRoot = join(projectRoot, 'data/wiki'),
    preview = false,
    roots = sharedRoots(),
    afterPublish,
  } = {},
) {
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  const data = normalizeBundle(input, projectRoot, now)
  projectRoot = resolve(projectRoot)
  wikiRoot = resolve(wikiRoot)
  const docsDir = join(projectRoot, 'data/documents')
  mkdirSync(join(projectRoot, 'data'), { recursive: true })
  const lockPath = join(projectRoot, 'data/.wiki-publish.lock')
  let lock
  try {
    lock = openSync(lockPath, 'wx')
  } catch {
    throw new Error(
      'Another wiki publication is running, or a previous publication left a lock; inspect data/.wiki-publish.lock before retrying',
    )
  }
  let staging
  try {
    writeFileSync(
      lock,
      encode({ pid: process.pid, started_at: now, bundle_id: data.bundle_id }),
    )
    staging = mkdtempSync(join(tmpdir(), 'wiki-candidate-'))
    const candidateRoot = join(staging, 'wiki')
    copyCandidate(wikiRoot, candidateRoot)
    const { changes, written, archived, wikiEntries } = stageNodes(
      data,
      projectRoot,
      wikiRoot,
      candidateRoot,
    )
    try {
      assertValidWiki({ projectRoot, wikiRoot: candidateRoot, roots })
    } catch (e) {
      throw new Error(e.message.replaceAll(candidateRoot, wikiRoot), {
        cause: e,
      })
    }
    const result = {
      project: data.project,
      bundleId: data.bundle_id,
      written,
      archived,
      wikiEntries,
      preview: Boolean(preview),
    }
    if (preview) return result
    updateProjectRegistry(docsDir, data, wikiEntries, now, changes)
    updateAPIRegistry(docsDir, data, now, changes)
    activateSources(docsDir, data, now, changes)
    replaceFiles(changes)
    if (afterPublish) await afterPublish(result)
    return result
  } finally {
    if (staging) rmSync(staging, { recursive: true, force: true })
    closeSync(lock)
    rmSync(lockPath, { force: true })
  }
}
