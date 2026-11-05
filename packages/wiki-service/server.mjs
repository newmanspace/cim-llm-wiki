#!/usr/bin/env node
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, rmSync, openSync, closeSync, realpathSync } from 'node:fs'
import { join, dirname, resolve, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { PROJECT_ROOT, CONTRACT_ROOT, NODE_TYPES, schemaErrors, loadTemplateContracts, readContractJson, nodeLocation, slugify } from '../wiki-core/contracts.mjs'
import { compileBundle } from '../wiki-core/compile.mjs'
import { validateWiki } from '../wiki-core/validate.mjs'
import { loadManifest, saveManifest, transition } from '../wiki-core/docstore.mjs'
import { sharedRoots, resolveShared, hashFile, hashValue, nodeProvenance, writeSharedFile } from '../wiki-core/sources.mjs'
import { convertInput, embedImages } from './parsers.mjs'

const PREFIX = '/api/v2/knowledge'
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/
const bundlePattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/
const assetRoot = join(PROJECT_ROOT, '.agents/skills/cim-wiki/assets')
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
const json = path => JSON.parse(readFileSync(path, 'utf8'))
const now = () => new Date().toISOString()
function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.${randomUUID()}.tmp`
  try { writeFileSync(temp, JSON.stringify(data, null, 2) + '\n'); renameSync(temp, path) }
  finally { rmSync(temp, { force: true }) }
}
function identifier(value, pattern = idPattern) {
  if (typeof value !== 'string' || !pattern.test(value) || ['__proto__', 'constructor', 'prototype'].includes(value)) fail('Invalid identifier')
  return value
}
function actor(value) {
  if (typeof value !== 'string' || !value.trim() || /^(auto|agent|llm|system)$/i.test(value.trim())) fail('An identified human reviewer is required')
  return value.trim()
}
async function body(req) {
  const chunks = []; let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 8 * 1024 * 1024) fail('Request body exceeds 8 MiB', 413)
    chunks.push(chunk)
  }
  const data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('JSON object required')
  return data
}
function sameToken(actual, expected) {
  const a = Buffer.from(actual || ''), b = Buffer.from(`Bearer ${expected}`)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function createKnowledgeServer({ projectRoot = process.env.CIM_WIKI_WORKSPACE || PROJECT_ROOT,
  wikiRoot = process.env.WIKI_ROOT || join(projectRoot, 'data/wiki'), roots = sharedRoots(),
  token = process.env.CIM_WIKI_API_TOKEN, reviewerTokens = JSON.parse(process.env.CIM_WIKI_REVIEW_TOKENS || '{}'), parser = convertInput } = {}) {
  if (!token) throw new Error('CIM_WIKI_API_TOKEN is required')
  if (!reviewerTokens || typeof reviewerTokens !== 'object' || Array.isArray(reviewerTokens)) throw new Error('CIM_WIKI_REVIEW_TOKENS must map human identities to separate tokens')
  for (const [name, credential] of Object.entries(reviewerTokens)) {
    actor(name)
    if (typeof credential !== 'string' || credential.length < 32 || credential === token) throw new Error('Reviewer tokens must be independent and at least 32 characters')
  }
  projectRoot = resolve(projectRoot); wikiRoot = resolve(wikiRoot)
  const options = { projectRoot, wikiRoot, roots }
  const docs = () => loadManifest(projectRoot)
  const getDoc = source => docs().docs.find(d => d.path === source) || fail('Registered document not found', 404)
  const bundlePath = id => join(projectRoot, 'data/service/bundles', `${identifier(id, bundlePattern)}.json`)
  const getBundle = id => existsSync(bundlePath(id)) ? json(bundlePath(id)) : fail('Bundle not found', 404)
  let queue = Promise.resolve()

  function context(project) {
    identifier(project)
    const contractPath = join(wikiRoot, project, 'document-contract.json')
    if (!existsSync(contractPath)) fail('Project delivery contract is required on the server', 409)
    const contract = readContractJson(contractPath)
    const errors = schemaErrors('documentSet', contract)
    if (errors.length || contract.project !== project) fail(`Invalid delivery contract: ${errors.join('; ')}`, 409)
    const contracts = loadTemplateContracts(wikiRoot)(project)
    const templates = {}
    for (const [type, entry] of Object.entries(contracts)) {
      // Template filenames are constrained by the versioned template schema.
      const manifests = [join(wikiRoot, project, 'templates/manifest.json'), join(wikiRoot, 'templates/manifest.json')]
      const file = manifests.filter(existsSync).map(p => readContractJson(p).templates?.[type]?.file).find(Boolean) || entry.template
      if (file) {
        const path = [join(wikiRoot, project, 'templates', file), join(wikiRoot, 'templates', file), join(assetRoot, file)].find(existsSync)
        if (path) templates[type] = readFileSync(path, 'utf8')
      }
    }
    return { schema_version: '1.0', project, delivery_contract: contract, node_types: NODE_TYPES,
      node_schema: json(join(CONTRACT_ROOT, 'node.schema.json')), vocabulary: json(join(CONTRACT_ROOT, 'vocabulary.json')), template_contracts: contracts, templates }
  }

  async function register(data, convert) {
    identifier(data.project)
    if (['version', 'system', 'category'].some(k => typeof data[k] !== 'string' || !data[k].trim())) fail('system, version and category must be nonempty strings')
    if (data.ingest_path !== undefined && (typeof data.ingest_path !== 'string' || !data.ingest_path.trim())) fail('ingest_path must be a nonempty original path')
    const original = resolveShared(data.source, roots)
    const parsedUri = data.parsed
    if (typeof parsedUri !== 'string' || !parsedUri.endsWith('.md') || parsedUri === data.source) fail('A distinct shared .md parsed path is required')
    const parsed = resolveShared(parsedUri, roots, { write: convert })
    if (existsSync(parsed) && realpathSync(parsed) === realpathSync(original)) fail('Original and parsed files must be distinct')
    if (docs().docs.some(d => d.path === parsedUri)) fail('Parsed path is already registered; use a new version/path', 409)
    const beforeHash = hashFile(original)
    if (convert) {
      if (existsSync(parsed) || existsSync(join(dirname(parsed), basename(parsed, '.md') + '_assets'))) fail('Conversion will not overwrite an existing file or asset directory', 409)
      const result = await parser(original, data.engine)
      if (!result.md?.trim()) fail('Parser returned empty Markdown', 422)
      if (hashFile(original) !== beforeHash) fail('Original document changed during conversion', 409)
      // Recheck the shared mount after an asynchronous parser call.
      resolveShared(parsedUri, roots, { write: true })
      const sharedParent = parsedUri.slice(0, parsedUri.lastIndexOf('/') + 1)
      const embedded = embedImages(result.md, result.images || [], dirname(parsed), basename(parsed, '.md'),
        (path, bytes) => writeSharedFile(sharedParent + path, bytes, roots))
      writeSharedFile(parsedUri, embedded.md, roots)
    }
    if (!readFileSync(parsed, 'utf8').trim()) fail('Parsed Markdown is empty', 422)
    const record = { doc_id: `shared-${hashValue({ project: data.project, source: data.source }).slice(0, 20)}`,
      project: data.project, system: data.system, version: data.version, category: data.category,
      path: parsedUri, original_uri: data.source, original_path: original,
      original_sha256: beforeHash, parsed_sha256: hashFile(parsed),
      ...(data.ingest_path ? { ingest_path: String(data.ingest_path) } : {}),
      state: 'draft', sha256: null, bundles: [], created_at: now(), updated_at: now(),
      history: [{ from: null, to: 'draft', at: now(), by: 'knowledge-service' }] }
    const manifest = docs(); manifest.docs.push(record); saveManifest(projectRoot, manifest)
    return { document: record, markdown: readFileSync(parsed, 'utf8') }
  }

  function submittedBundle(data) {
    const value = readContractJson(resolveShared(data.uri, roots))
    identifier(value.bundle_id, bundlePattern); identifier(value.project)
    context(value.project)
    if (!Array.isArray(value.nodes) || !value.nodes.length) fail('A versioned bundle with nodes is required')
    const manifest = docs()
    for (const node of value.nodes) {
      node.source ??= value.source_doc
      const sources = Array.isArray(node.source) ? node.source : [node.source]
      if (!sources.length || sources.some(s => typeof s !== 'string' || !s.startsWith('shared://'))) fail('Every node must cite registered shared sources')
      for (const source of sources) {
        const rec = getDoc(source)
        if (rec.project !== value.project) fail('Cross-project source reference')
        if (!['frozen', 'active'].includes(rec.state)) fail('Source must be frozen before extraction/submission', 409)
        if (hashFile(resolveShared(source, roots)) !== rec.sha256 || hashFile(resolveShared(rec.original_uri, roots)) !== rec.original_sha256) fail('Source or original document has changed', 409)
      }
      node.provenance = nodeProvenance(node, manifest)
      const q = node.qscore
      const dimensions = ['auth', 'comp', 'rel', 'fresh', 'struct', 'reuse', 'risk']
      if (!q || dimensions.some(k => typeof q[k] !== 'number' || q[k] < 0 || q[k] > 1)) fail('Seven local LLM score dimensions (auth, comp, rel, fresh, struct, reuse, risk) are required')
      const total = Number((q.auth * .2 + q.comp * .2 + q.rel * .15 + q.fresh * .15 + q.struct * .1 + q.reuse * .1 + (1 - q.risk) * .1).toFixed(4))
      if (q.total !== total) fail('Score total does not match the seven dimensions')
      node.confidence = total
      const level = total >= .95 ? 'L0_auto' : total >= .8 ? 'L1_expert' : total >= .55 ? 'L2_arch' : 'archive'
      const levels = ['L0_auto', 'L1_expert', 'L2_arch', 'archive']
      if (!levels.includes(node.review_level) || levels.indexOf(node.review_level) < levels.indexOf(level)) fail('Review level is lower than the score permits')
      const [plane, dir] = nodeLocation(node)
      const existing = join(wikiRoot, value.project, plane, dir, `${slugify(node.id)}.md`)
      const critical = node.severity === 'Critical' || /hold|release|qtime|状态机|plm|erp/i.test(`${node.title} ${node.content}`) || (node.type === 'business_rule' && existsSync(existing))
      if (critical && node.review_level !== 'archive' && node.review_level !== 'L2_arch') fail('Critical or modified business rules require L2_arch review')
      // Any replacement requires human approval, including high-scoring nodes.
      node.reviewer = 'auto'
      node.schema_version ??= '1.0'; node.status ??= 'published'
      node.created_at ??= now(); node.updated_at ??= now()
    }
    const errors = schemaErrors('bundle', value)
    if (errors.length) fail(`Bundle contract failed: ${errors.join('; ')}`)
    const path = bundlePath(value.bundle_id)
    if (existsSync(path)) fail('Bundle ID is already submitted; use a new ID for revisions', 409)
    const needsReview = value.nodes.some(n => {
      const [plane, dir] = nodeLocation(n)
      return ['L1_expert', 'L2_arch'].includes(n.review_level) || existsSync(join(wikiRoot, value.project, plane, dir, `${slugify(n.id)}.md`))
    })
    const targets = value.nodes.filter(n => n.review_level !== 'archive').map(n => {
      const [plane, dir] = nodeLocation(n)
      const path = `${value.project}/${plane}/${dir}/${slugify(n.id)}.md`
      return { path, sha256: existsSync(join(wikiRoot, path)) ? hashFile(join(wikiRoot, path)) : null }
    })
    const record = { targets, bundle: value, submitted_uri: data.uri, digest: hashValue(value), state: needsReview ? 'pending' : 'auto', submitted_at: now() }
    writeJson(path, record)
    return record
  }

  async function route(req, url, data, reviewerIdentity) {
    const path = url.pathname.slice(PREFIX.length)
    if (req.method === 'GET' && path === '/context') return context(url.searchParams.get('project'))
    if (req.method === 'GET' && path === '/document') {
      const rec = getDoc(url.searchParams.get('source'))
      return { document: rec, markdown: readFileSync(resolveShared(rec.path, roots), 'utf8') }
    }
    if (req.method === 'GET' && path === '/bundle') return getBundle(url.searchParams.get('id'))
    if (req.method === 'POST' && path === '/convert') return register(data, true)
    if (req.method === 'POST' && path === '/register') return register(data, false)
    if (req.method === 'POST' && path === '/state') {
      const rec = getDoc(data.source)
      if (!['freeze', 'unfreeze'].includes(data.action)) fail('Only freeze and unfreeze are supported; activation requires compilation')
      if (rec.state === 'active') fail('Published sources are immutable; register a new version', 409)
      if (data.action === 'freeze' && hashFile(resolveShared(rec.original_uri, roots)) !== rec.original_sha256) fail('Original document has changed', 409)
      // transition resolves shared URIs with the same explicit root configuration.
      return transition(projectRoot, rec.path, data.action === 'freeze' ? 'frozen' : 'draft', { by: typeof data.by === 'string' && data.by.trim() ? data.by : 'local-agent', note: data.note || '', roots })
    }
    if (req.method === 'POST' && path === '/bundles') return submittedBundle(data)
    if (req.method === 'POST' && path === '/review') {
      if (!reviewerIdentity) fail('Human review requires an independent reviewer credential', 403)
      if (data.reviewer !== undefined && data.reviewer !== reviewerIdentity) fail('Reviewer identity is bound to the authenticated credential', 403)
      const record = getBundle(data.bundle_id)
      if (record.state !== 'pending') fail('Only pending bundles can be reviewed', 409)
      if (!['approve', 'reject'].includes(data.decision)) fail('Decision must be approve or reject')
      record.review = { decision: data.decision, reviewer: reviewerIdentity, note: data.note || '', at: now(), digest: record.digest }
      record.state = data.decision === 'approve' ? 'approved' : 'rejected'
      writeJson(bundlePath(data.bundle_id), record)
      return record
    }
    if (req.method === 'POST' && path === '/compile') {
      if (data.preview !== undefined && typeof data.preview !== 'boolean') fail('preview must be a boolean')
      const record = getBundle(data.bundle_id)
      if (!['auto', 'approved', 'published'].includes(record.state)) fail('Bundle is not approved for publication', 409)
      if (record.digest !== hashValue(record.bundle) || (record.state === 'approved' && record.review?.digest !== record.digest)) fail('Bundle changed after review', 409)
      if (record.state !== 'published') for (const target of record.targets || []) {
        const current = existsSync(join(wikiRoot, target.path)) ? hashFile(join(wikiRoot, target.path)) : null
        if (current !== target.sha256) fail('Published baseline changed since submission; submit a new bundle for review', 409)
      }
      const bundle = structuredClone(record.bundle)
      if (record.review?.decision === 'approve') for (const node of bundle.nodes) node.reviewer = record.review.reviewer
      const result = await compileBundle(bundle, { ...options, preview: data.preview === true })
      if (!data.preview) { record.state = 'published'; record.compiled_at = now(); writeJson(bundlePath(data.bundle_id), record) }
      return result
    }
    if (req.method === 'POST' && path === '/validate') return validateWiki(options)
    fail('Endpoint not found', 404)
  }

  return createServer(async (req, res) => {
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)) }
    try {
      const url = new URL(req.url, 'http://localhost')
      if (req.method === 'GET' && url.pathname === '/healthz') { send(200, { status: 'ok' }); return }
      const reviewerIdentity = Object.entries(reviewerTokens).find(([, credential]) => sameToken(req.headers.authorization, credential))?.[0]
      if (!sameToken(req.headers.authorization, token) && !reviewerIdentity) { send(401, { error: 'Bearer token required' }); return }
      if (reviewerIdentity && req.method !== 'GET' && url.pathname !== PREFIX + '/review') fail('Reviewer credentials may only submit review decisions', 403)
      if (!url.pathname.startsWith(PREFIX + '/')) fail('Endpoint not found', 404)
      const data = req.method === 'POST' ? await body(req) : null
      if (req.method === 'POST') {
        const work = queue.then(async () => {
          // One service mutation at a time, including across processes using the same state directory.
          mkdirSync(join(projectRoot, 'data'), { recursive: true })
          const lockPath = join(projectRoot, 'data/.knowledge-service.lock')
          let lock
          try { lock = openSync(lockPath, 'wx') } catch { fail('Another service mutation is running', 409) }
          try { return await route(req, url, data, reviewerIdentity) } finally { closeSync(lock); rmSync(lockPath, { force: true }) }
        })
        queue = work.catch(() => {})
        send(200, await work)
      } else send(200, await route(req, url))
    } catch (e) { send(e.status || (e instanceof SyntaxError ? 400 : 422), { error: e.message }) }
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = createKnowledgeServer()
  server.requestTimeout = 15 * 60 * 1000
  server.listen(Number(process.env.KNOWLEDGE_PORT || 8090), process.env.KNOWLEDGE_HOST || '127.0.0.1', () => console.log('Knowledge service ready'))
}
