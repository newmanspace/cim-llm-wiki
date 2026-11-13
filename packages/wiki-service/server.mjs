import { createDocumentDefaults } from './document-defaults.mjs'
import {
  checkDocument,
  templateFor,
  definitionSchema,
  templateVariables,
} from '../wiki-core/document-defaults.mjs'
import { createDocumentQuality } from './document-quality.mjs'
import {
  readDirectory,
  updateDirectory,
} from '../wiki-core/product-directory.mjs'
import { createServer } from 'node:http'
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  renameSync,
  rmSync,
  openSync,
  closeSync,
  realpathSync,
} from 'node:fs'
import { join, dirname, resolve, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import {
  PROJECT_ROOT,
  CONTRACT_ROOT,
  NODE_TYPES,
  schemaErrors,
  readContractJson,
  nodeLocation,
  slugify,
} from '../wiki-core/contracts.mjs'
import { compileBundle } from '../wiki-core/compile.mjs'
import { validateWiki } from '../wiki-core/validate.mjs'
import {
  loadManifest,
  saveManifest,
  transition,
} from '../wiki-core/docstore.mjs'
import {
  sharedRoots,
  resolveShared,
  hashFile,
  hashValue,
  nodeProvenance,
  writeSharedFile,
} from '../wiki-core/sources.mjs'
import { convertInput, embedImages } from './parsers.mjs'

const PREFIX = '/api/v2/knowledge'
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/
const bundlePattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status })
}
const json = (path) => JSON.parse(readFileSync(path, 'utf8'))
const now = () => new Date().toISOString()
function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(temp, JSON.stringify(data, null, 2) + '\n')
    renameSync(temp, path)
  } finally {
    rmSync(temp, { force: true })
  }
}
function identifier(value, pattern = idPattern) {
  if (
    typeof value !== 'string' ||
    !pattern.test(value) ||
    ['__proto__', 'constructor', 'prototype'].includes(value)
  )
    fail('Invalid identifier')
  return value
}
function actor(value) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    /^(auto|agent|llm|system)$/i.test(value.trim())
  )
    fail('An identified human reviewer is required')
  return value.trim()
}
async function body(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 8 * 1024 * 1024) fail('Request body exceeds 8 MiB', 413)
    chunks.push(chunk)
  }
  const data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  if (!data || typeof data !== 'object' || Array.isArray(data))
    fail('JSON object required')
  return data
}
function sameToken(actual, expected) {
  const a = Buffer.from(actual || ''),
    b = Buffer.from(`Bearer ${expected}`)
  return a.length === b.length && timingSafeEqual(a, b)
}

function validateCredentials(token, reviewerTokens, ledgerToken) {
  if (ledgerToken && Object.values(reviewerTokens).includes(ledgerToken))
    throw new Error(
      'Settings service and reviewer credentials must be independent',
    )

  if (!token) throw new Error('CIM_WIKI_API_TOKEN is required')
  if (
    !reviewerTokens ||
    typeof reviewerTokens !== 'object' ||
    Array.isArray(reviewerTokens)
  )
    throw new Error(
      'CIM_WIKI_REVIEW_TOKENS must map human identities to separate tokens',
    )
  for (const [name, credential] of Object.entries(reviewerTokens)) {
    actor(name)
    if (
      typeof credential !== 'string' ||
      credential.length < 32 ||
      credential === token
    )
      throw new Error(
        'Reviewer tokens must be independent and at least 32 characters',
      )
  }
}

export function createKnowledgeServer({
  projectRoot = process.env.CIM_WIKI_WORKSPACE || PROJECT_ROOT,
  wikiRoot = process.env.WIKI_ROOT || join(projectRoot, 'data/wiki'),
  roots = sharedRoots(),
  autoPublish = process.env.CIM_WIKI_AUTO_PUBLISH === 'true',
  token = process.env.CIM_WIKI_API_TOKEN,
  reviewerTokens = JSON.parse(process.env.CIM_WIKI_REVIEW_TOKENS || '{}'),
  parser = convertInput,
  ledgerURL = process.env.CIM_WIKI_LEDGER_URL,
  ledgerToken = process.env.CIM_WIKI_LEDGER_TOKEN,
  organizedRoot = process.env.CIM_WIKI_ORGANIZED_ROOT,
} = {}) {
  validateCredentials(token, reviewerTokens, ledgerToken)
  projectRoot = resolve(projectRoot)
  wikiRoot = resolve(wikiRoot)
  const options = { projectRoot, wikiRoot, roots }
  const docs = () => loadManifest(projectRoot)
  const getDoc = (source) =>
    docs().docs.find((d) => d.path === source) ||
    fail('Registered document not found', 404)
  const bundlePath = (id) =>
    join(
      projectRoot,
      'data/service/bundles',
      `${identifier(id, bundlePattern)}.json`,
    )
  const getBundle = (id) =>
    existsSync(bundlePath(id))
      ? json(bundlePath(id))
      : fail('Bundle not found', 404)
  const quality = createDocumentQuality({
    ledgerURL,
    ledgerToken,
    organizedRoot,
    projectRoot,
    roots,
    registeredDocument: getDoc,
    wikiRoot,
  })
  const defaults = createDocumentDefaults(projectRoot, wikiRoot)
  let queue = Promise.resolve()

  function context(project) {
    identifier(project)
    const contractPath = join(wikiRoot, project, 'document-contract.json')
    if (!existsSync(contractPath))
      fail('Project delivery contract is required on the server', 409)
    const contract = readContractJson(contractPath)
    const errors = schemaErrors('documentSet', contract)
    if (errors.length || contract.project !== project)
      fail(`Invalid delivery contract: ${errors.join('; ')}`, 409)
    const effective = defaults.store.effective(project)
    const contracts = {},
      templates = {}
    for (const entry of effective.definition.templates) {
      if (templates[entry.node_type]) continue
      templates[entry.node_type] = entry.body
      contracts[entry.node_type] = {
        ...NODE_TYPES[entry.node_type],
        requiredSections: [
          ...new Set([
            ...(NODE_TYPES[entry.node_type].requiredSections || []),
            ...entry.contract.sections.map((s) => '## ' + s),
          ]),
        ],
        tables: [
          ...(NODE_TYPES[entry.node_type].tables || []),
          ...entry.contract.tables.map((t) => ({
            section: '## ' + t.section,
            columns: t.columns,
          })),
        ],
      }
    }
    return {
      schema_version: '1.0',
      document_defaults: effective,
      document_defaults_schema: definitionSchema,
      template_variables: templateVariables,
      project,
      delivery_contract: contract,
      directory: readDirectory(project, { wikiRoot }),
      node_types: NODE_TYPES,
      node_schema: json(join(CONTRACT_ROOT, 'node.schema.json')),
      vocabulary: json(join(CONTRACT_ROOT, 'vocabulary.json')),
      template_contracts: contracts,
      templates,
    }
  }

  function prepareRegistration(data, convert) {
    identifier(data.project)
    if (
      ['version', 'system', 'category'].some(
        (k) => typeof data[k] !== 'string' || !data[k].trim(),
      )
    )
      fail('system, version and category must be nonempty strings')
    if (
      data.ingest_path !== undefined &&
      (typeof data.ingest_path !== 'string' || !data.ingest_path.trim())
    )
      fail('ingest_path must be a nonempty original path')
    const original = resolveShared(data.source, roots)
    const parsedUri = data.parsed
    if (
      typeof parsedUri !== 'string' ||
      !parsedUri.endsWith('.md') ||
      parsedUri === data.source
    )
      fail('A distinct shared .md parsed path is required')
    const parsed = resolveShared(parsedUri, roots, { write: convert })
    if (existsSync(parsed) && realpathSync(parsed) === realpathSync(original))
      fail('Original and parsed files must be distinct')
    if (docs().docs.some((d) => d.path === parsedUri))
      fail('Parsed path is already registered; use a new version/path', 409)
    const beforeHash = hashFile(original)
    return { original, parsedUri, parsed, beforeHash }
  }

  async function convertSharedDocument(
    data,
    original,
    parsedUri,
    parsed,
    beforeHash,
  ) {
    if (
      existsSync(parsed) ||
      existsSync(join(dirname(parsed), basename(parsed, '.md') + '_assets'))
    )
      fail(
        'Conversion will not overwrite an existing file or asset directory',
        409,
      )
    const result = await parser(original, data.engine)
    if (!result.md?.trim()) fail('Parser returned empty Markdown', 422)
    if (hashFile(original) !== beforeHash)
      fail('Original document changed during conversion', 409)
    // Recheck the shared mount after an asynchronous parser call.
    resolveShared(parsedUri, roots, { write: true })
    const sharedParent = parsedUri.slice(0, parsedUri.lastIndexOf('/') + 1)
    const embedded = embedImages(
      result.md,
      result.images || [],
      dirname(parsed),
      basename(parsed, '.md'),
      (path, bytes) => writeSharedFile(sharedParent + path, bytes, roots),
    )
    writeSharedFile(parsedUri, embedded.md, roots)
  }

  async function register(data, convert) {
    const { original, parsedUri, parsed, beforeHash } = prepareRegistration(
      data,
      convert,
    )
    if (convert)
      await convertSharedDocument(data, original, parsedUri, parsed, beforeHash)
    if (!readFileSync(parsed, 'utf8').trim())
      fail('Parsed Markdown is empty', 422)
    const record = {
      doc_id: `shared-${hashValue({ project: data.project, source: data.source }).slice(0, 20)}`,
      project: data.project,
      system: data.system,
      version: data.version,
      category: data.category,
      path: parsedUri,
      original_uri: data.source,
      original_path: original,
      original_sha256: beforeHash,
      parsed_sha256: hashFile(parsed),
      ...(data.ingest_path ? { ingest_path: String(data.ingest_path) } : {}),
      state: 'draft',
      sha256: null,
      bundles: [],
      created_at: now(),
      updated_at: now(),
      history: [
        { from: null, to: 'draft', at: now(), by: 'knowledge-service' },
      ],
    }
    const manifest = docs()
    manifest.docs.push(record)
    saveManifest(projectRoot, manifest)
    return { document: record, markdown: readFileSync(parsed, 'utf8') }
  }

  function validateNodeSources(node, value, manifest) {
    node.source ??= value.source_doc
    const sources = Array.isArray(node.source) ? node.source : [node.source]
    if (
      !sources.length ||
      sources.some((s) => typeof s !== 'string' || !s.startsWith('shared://'))
    )
      fail('Every node must cite registered shared sources')
    for (const source of sources) {
      const rec = getDoc(source)
      if (rec.project !== value.project) fail('Cross-project source reference')
      if (!['frozen', 'active'].includes(rec.state))
        fail('Source must be frozen before extraction/submission', 409)
      if (
        hashFile(resolveShared(source, roots)) !== rec.sha256 ||
        hashFile(resolveShared(rec.original_uri, roots)) !== rec.original_sha256
      )
        fail('Source or original document has changed', 409)
    }
    node.provenance = nodeProvenance(node, manifest)
  }

  function validateNodeScore(node) {
    const q = node.qscore
    const dimensions = [
      'auth',
      'comp',
      'rel',
      'fresh',
      'struct',
      'reuse',
      'risk',
    ]
    if (
      !q ||
      dimensions.some((k) => typeof q[k] !== 'number' || q[k] < 0 || q[k] > 1)
    )
      fail(
        'Seven local LLM score dimensions (auth, comp, rel, fresh, struct, reuse, risk) are required',
      )
    const total = Number(
      (
        q.auth * 0.2 +
        q.comp * 0.2 +
        q.rel * 0.15 +
        q.fresh * 0.15 +
        q.struct * 0.1 +
        q.reuse * 0.1 +
        (1 - q.risk) * 0.1
      ).toFixed(4),
    )
    if (q.total !== total)
      fail('Score total does not match the seven dimensions')
    node.confidence = total
    const level =
      total >= 0.95
        ? 'L0_auto'
        : total >= 0.8
          ? 'L1_expert'
          : total >= 0.55
            ? 'L2_arch'
            : 'archive'
    const levels = ['L0_auto', 'L1_expert', 'L2_arch', 'archive']
    if (
      !levels.includes(node.review_level) ||
      levels.indexOf(node.review_level) < levels.indexOf(level)
    )
      fail('Review level is lower than the score permits')
  }

  function validateNodeRisk(node, value) {
    const [plane, dir] = nodeLocation(node)
    const existing = join(
      wikiRoot,
      value.project,
      plane,
      dir,
      `${slugify(node.id)}.md`,
    )
    const critical =
      node.severity === 'Critical' ||
      /hold|release|qtime|状态机|plm|erp/i.test(
        `${node.title} ${node.content}`,
      ) ||
      (node.type === 'business_rule' && existsSync(existing))
    if (
      critical &&
      node.review_level !== 'archive' &&
      node.review_level !== 'L2_arch'
    )
      fail('Critical or modified business rules require L2_arch review')
    // Any replacement requires human approval, including high-scoring nodes.
  }

  function prepareSubmittedNode(node, value, manifest) {
    validateNodeSources(node, value, manifest)
    validateNodeScore(node)
    validateNodeRisk(node, value)
    node.reviewer = 'auto'
    node.schema_version ??= '1.0'
    node.status ??= 'published'
    node.created_at ??= now()
    node.updated_at ??= now()
  }

  async function submittedBundle(data) {
    const value = readContractJson(resolveShared(data.uri, roots))
    identifier(value.bundle_id, bundlePattern)
    identifier(value.project)
    context(value.project)
    if (!Array.isArray(value.nodes) || !value.nodes.length)
      fail('A versioned bundle with nodes is required')
    const effective = defaults.store.effective(value.project)
    const manifest = docs()
    for (const node of value.nodes) {
      const diagnostics = checkDocument(
        templateFor(effective.definition, node),
        '# ' + node.title + '\n\n' + node.content,
        { terms: effective.definition.terms, phase: 'review' },
      )
      if (diagnostics.some((e) => e.severity === 'error'))
        fail('Document contract failed: ' + JSON.stringify(diagnostics))
      prepareSubmittedNode(node, value, manifest)
    }
    const errors = schemaErrors('bundle', value)
    if (errors.length) fail(`Bundle contract failed: ${errors.join('; ')}`)
    const path = bundlePath(value.bundle_id)
    if (existsSync(path))
      fail('Bundle ID is already submitted; use a new ID for revisions', 409)
    const needsReview =
      !autoPublish ||
      value.nodes.some((n) => {
        const [plane, dir] = nodeLocation(n)
        return (
          ['L1_expert', 'L2_arch'].includes(n.review_level) ||
          existsSync(
            join(wikiRoot, value.project, plane, dir, `${slugify(n.id)}.md`),
          )
        )
      })
    const targets = value.nodes
      .filter((n) => n.review_level !== 'archive')
      .map((n) => {
        const [plane, dir] = nodeLocation(n)
        const path = `${value.project}/${plane}/${dir}/${slugify(n.id)}.md`
        return {
          path,
          sha256: existsSync(join(wikiRoot, path))
            ? hashFile(join(wikiRoot, path))
            : null,
        }
      })
    const sources = value.nodes.flatMap((node) =>
      Array.isArray(node.source) ? node.source : [node.source],
    )
    const documentArtifacts = await quality.bindings(
      value.project,
      sources,
      data.artifact_ids,
    )
    const record = {
      ...(documentArtifacts.length
        ? { document_artifacts: documentArtifacts }
        : {}),
      targets,
      bundle: value,
      submitted_uri: data.uri,
      digest: hashValue(value),
      document_defaults_digest: effective.digest,
      state: needsReview ? 'pending' : 'auto',
      submitted_at: now(),
    }
    writeJson(path, record)
    return record
  }

  function changeSourceState(data) {
    const rec = getDoc(data.source)
    if (!['freeze', 'unfreeze'].includes(data.action))
      fail(
        'Only freeze and unfreeze are supported; activation requires compilation',
      )
    if (rec.state === 'active')
      fail('Published sources are immutable; register a new version', 409)
    if (
      data.action === 'freeze' &&
      hashFile(resolveShared(rec.original_uri, roots)) !== rec.original_sha256
    )
      fail('Original document has changed', 409)
    // transition resolves shared URIs with the same explicit root configuration.
    return transition(
      projectRoot,
      rec.path,
      data.action === 'freeze' ? 'frozen' : 'draft',
      {
        by:
          typeof data.by === 'string' && data.by.trim()
            ? data.by
            : 'local-agent',
        note: data.note || '',
        roots,
      },
    )
  }

  function reviewSubmittedBundle(data, reviewerIdentity) {
    if (!reviewerIdentity)
      fail('Human review requires an independent reviewer credential', 403)
    if (data.reviewer !== undefined && data.reviewer !== reviewerIdentity)
      fail('Reviewer identity is bound to the authenticated credential', 403)
    const record = getBundle(data.bundle_id)
    if (record.state !== 'pending')
      fail('Only pending bundles can be reviewed', 409)
    if (!['approve', 'reject'].includes(data.decision))
      fail('Decision must be approve or reject')
    record.review = {
      decision: data.decision,
      reviewer: reviewerIdentity,
      note: data.note || '',
      at: now(),
      digest: record.digest,
    }
    record.state = data.decision === 'approve' ? 'approved' : 'rejected'
    writeJson(bundlePath(data.bundle_id), record)
    return record
  }

  function verifyPublishedBaseline(record) {
    if (record.state !== 'published')
      for (const target of record.targets || []) {
        const current = existsSync(join(wikiRoot, target.path))
          ? hashFile(join(wikiRoot, target.path))
          : null
        if (current !== target.sha256)
          fail(
            'Published baseline changed since submission; submit a new bundle for review',
            409,
          )
      }
  }

  function checkedPublicationBundle(record) {
    const effective = defaults.store.effective(record.bundle.project)
    if (record.document_defaults_digest !== effective.digest)
      fail(
        'Document contract changed after submission; submit a new bundle',
        409,
      )
    const bundle = structuredClone(record.bundle)
    const reviewer =
      record.review?.reviewer ||
      (autoPublish &&
      record.bundle.nodes.every((n) => n.review_level === 'L0_auto')
        ? 'auto'
        : undefined)
    for (const node of bundle.nodes) {
      if (reviewer)
        node.content = node.content.replace(
          /^(\|\s*审核者\s*\|)[^\n|]*(\|)\s*$/m,
          (_, start, end) => start + ' ' + reviewer + ' ' + end,
        )
      const diagnostics = checkDocument(
        templateFor(effective.definition, node),
        '# ' + node.title + '\n\n' + node.content,
        { terms: effective.definition.terms, phase: 'publish', reviewer },
      )
      if (diagnostics.some((e) => e.severity === 'error'))
        fail(
          'Document publication contract failed: ' +
            JSON.stringify(diagnostics),
        )
    }
    return bundle
  }

  async function compileSubmittedBundle(data) {
    if (data.preview !== undefined && typeof data.preview !== 'boolean')
      fail('preview must be a boolean')
    const record = getBundle(data.bundle_id)
    if (!['auto', 'approved', 'published'].includes(record.state))
      fail('Bundle is not approved for publication', 409)
    if (
      record.digest !== hashValue(record.bundle) ||
      (record.state === 'approved' && record.review?.digest !== record.digest)
    )
      fail('Bundle changed after review', 409)
    if (record.publication_pending) return recoverQualityPublication(record)
    verifyPublishedBaseline(record)
    const bundle = checkedPublicationBundle(record)
    if (record.review?.decision === 'approve')
      for (const node of bundle.nodes) node.reviewer = record.review.reviewer
    const result = await compileQualityBundle(
      bundle,
      record,
      data.preview === true,
    )
    if (!data.preview) {
      record.state = 'published'
      record.compiled_at = now()
      writeJson(bundlePath(data.bundle_id), record)
    }
    return result
  }

  async function compileQualityBundle(bundle, record, preview) {
    if (!record.document_artifacts?.length)
      await quality.bindings(
        bundle.project,
        bundle.nodes.flatMap((n) =>
          Array.isArray(n.source) ? n.source : [n.source],
        ),
        [],
      )
    if (record.document_artifacts?.length && !quality.enabled)
      fail('Document ledger is required for this quality-linked bundle', 503)
    await quality.gate(bundle.project, record.document_artifacts)
    const publicationKey = `bundle-${bundle.bundle_id}-${randomUUID()}`
    const publications = preview
      ? []
      : await quality.gate(
          bundle.project,
          record.document_artifacts,
          'start',
          publicationKey,
        )
    let result
    try {
      result = await compileBundle(bundle, {
        ...options,
        preview: preview === true,
      })
    } catch (error) {
      if (publications.length)
        await quality.finish(
          bundle.project,
          publications,
          'failed',
          publicationKey,
        )
      throw error
    }
    if (publications.length) {
      record.publication_pending = {
        publications,
        key: publicationKey,
        result,
        files: result.written.map((path) => ({
          path,
          sha256: hashFile(join(wikiRoot, path)),
        })),
      }
      writeJson(bundlePath(bundle.bundle_id), record)
      await quality.finish(
        bundle.project,
        publications,
        'published',
        publicationKey,
      )
      delete record.publication_pending
    }
    return result
  }

  async function recoverQualityPublication(record) {
    const pending = record.publication_pending
    for (const file of pending.files) {
      if (
        !existsSync(join(wikiRoot, file.path)) ||
        hashFile(join(wikiRoot, file.path)) !== file.sha256
      )
        fail(
          'Pending publication files changed; operator reconciliation required',
          409,
        )
    }
    await quality.gate(record.bundle.project, record.document_artifacts)
    await quality.finish(
      record.bundle.project,
      pending.publications,
      'published',
      pending.key,
    )
    delete record.publication_pending
    record.state = 'published'
    record.compiled_at = now()
    writeJson(bundlePath(record.bundle.bundle_id), record)
    return pending.result
  }

  const getRoutes = {
    '/directories': (url) =>
      readDirectory(url.searchParams.get('project'), { wikiRoot }),
    '/context': async (url) => {
      const project = url.searchParams.get('project')
      return { ...context(project), ...(await quality.context(project)) }
    },
    '/document': (url) => {
      const rec = getDoc(url.searchParams.get('source'))
      return {
        document: rec,
        markdown: readFileSync(resolveShared(rec.path, roots), 'utf8'),
      }
    },
    '/bundle': (url) => getBundle(url.searchParams.get('id')),
  }
  const postRoutes = {
    '/initialize': (data) => {
      if (
        Object.keys(data).some(
          (k) => !['project', 'name', 'product_version', 'modules'].includes(k),
        )
      )
        fail('Unsupported initialization field')
      return defaults.initialize(data)
    },
    '/check-document': (data) => defaults.check(data),
    '/render-document': (data) => defaults.render(data),
    '/directories': (data) => updateDirectory(data, { wikiRoot }),
    '/convert': (data) => register(data, true),
    '/register': (data) => register(data, false),
    '/state': changeSourceState,
    '/bundles': submittedBundle,
    '/review': reviewSubmittedBundle,
    '/compile': compileSubmittedBundle,
    '/validate': () => validateWiki(options),
  }

  async function qualityRoute(req, url, data, reviewerIdentity, path) {
    const reads = [
      'data-sources',
      'source-revisions',
      'ingest-runs',
      'source-observations',
      'ingest-source-links',
      'ingest-artifact-links',
      'document-results',
      'quality-policies',
      'quality-policy-effective',
      'document-evaluations',
      'quality-issues',
      'document-review-tasks',
      'document-review-events',
      'publications',
    ]
    const writes = [
      'ingest-runs',
      'source-observations',
      'artifacts',
      'document-evaluations',
      'document-review-decisions',
    ]
    if (
      req.method === 'GET' &&
      ['/document-result-preview', '/document-result-original'].includes(path)
    ) {
      const project = url.searchParams.get('project')
      context(project)
      return {
        data: await quality.preview(
          project,
          url.searchParams.get('id'),
          path.endsWith('-original'),
        ),
      }
    }
    if (req.method === 'GET' && reads.includes(path.slice(1))) {
      const project = url.searchParams.get('project')
      context(project)
      return {
        data: await quality.call(project, path.slice(1), {
          query: Object.fromEntries(
            [...url.searchParams].filter(([key]) => key !== 'project'),
          ),
        }),
      }
    }
    if (req.method === 'POST' && writes.includes(path.slice(1))) {
      context(data.project)
      if (path === '/document-review-decisions' && !reviewerIdentity)
        fail('Independent human reviewer authentication required', 403)
      return {
        data: await quality.mutate(
          path.slice(1),
          data,
          req.headers['idempotency-key'],
          reviewerIdentity ? req.headers.authorization.slice(7) : undefined,
        ),
      }
    }
    if (req.method === 'POST' && path === '/publish-document') {
      context(data.project)
      return {
        data: await quality.publish(data, req.headers['idempotency-key']),
      }
    }
  }

  async function route(req, url, data, reviewerIdentity) {
    const path = url.pathname.slice(PREFIX.length)
    const qualityResult = await qualityRoute(
      req,
      url,
      data,
      reviewerIdentity,
      path,
    )
    if (qualityResult !== undefined) return qualityResult
    if (req.method === 'GET' && Object.hasOwn(getRoutes, path))
      return getRoutes[path](url)
    if (req.method === 'POST' && Object.hasOwn(postRoutes, path))
      return postRoutes[path](data, reviewerIdentity)
    fail('Endpoint not found', 404)
  }

  async function internalSettings(req, url) {
    const action = url.pathname.slice('/internal/document-defaults'.length)
    const data = req.method === 'POST' ? await body(req) : null
    const actor = req.headers['x-settings-actor']
    if (typeof actor !== 'string' || !actor.trim())
      fail('Authenticated administrator identity required', 403)
    const actions = {
      'GET ': () => defaults.store.state(),
      'GET /project': () =>
        defaults.store.preview(url.searchParams.get('project')),
      'POST /save': () =>
        defaults.store.save(data.definition, data.expected_revision, actor),
      'POST /publish': () =>
        defaults.store.publish(data.expected_revision, actor),
      'POST /check': () => defaults.check(data),
      'POST /preview': () =>
        defaults.store.preview(data.project, data.overrides || {}),
      'POST /render': () => defaults.render(data),
      'POST /bind': () =>
        defaults.initialize({ ...data, actor }, data.upgrade === true),
    }
    const execute = actions[req.method + ' ' + action]
    if (!execute) fail('Settings endpoint not found', 404)
    return req.method === 'POST' ? mutate(execute) : execute()
  }

  async function mutate(operation) {
    const work = queue.then(async () => {
      // One service mutation at a time, including across processes using the same state directory.
      mkdirSync(join(projectRoot, 'data'), { recursive: true })
      const lockPath = join(projectRoot, 'data/.knowledge-service.lock')
      let lock
      try {
        lock = openSync(lockPath, 'wx')
      } catch {
        fail('Another service mutation is running', 409)
      }
      try {
        return await operation()
      } finally {
        closeSync(lock)
        rmSync(lockPath, { force: true })
      }
    })
    queue = work.catch(() => {})
    return work
  }

  function authenticateAgent(req, url) {
    const reviewerIdentity = Object.entries(reviewerTokens).find(
      ([, credential]) => sameToken(req.headers.authorization, credential),
    )?.[0]
    if (!sameToken(req.headers.authorization, token) && !reviewerIdentity) {
      fail('Bearer token required', 401)
    }
    if (
      reviewerIdentity &&
      req.method !== 'GET' &&
      ![PREFIX + '/review', PREFIX + '/document-review-decisions'].includes(
        url.pathname,
      )
    )
      fail('Reviewer credentials may only submit review decisions', 403)
    return reviewerIdentity
  }

  return createServer(async (req, res) => {
    const send = (status, value) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      })
      res.end(JSON.stringify(value))
    }
    try {
      const url = new URL(req.url, 'http://localhost')
      if (req.method === 'GET' && url.pathname === '/healthz') {
        send(200, { status: 'ok' })
        return
      }
      if (url.pathname.startsWith('/internal/document-defaults')) {
        if (
          !ledgerToken ||
          ledgerToken.length < 32 ||
          ledgerToken === token ||
          !sameToken(req.headers.authorization, ledgerToken)
        )
          fail('Administrator service authentication required', 403)
        send(200, await internalSettings(req, url))
        return
      }
      const reviewerIdentity = authenticateAgent(req, url)
      if (!url.pathname.startsWith(PREFIX + '/'))
        fail('Endpoint not found', 404)
      const data = req.method === 'POST' ? await body(req) : null
      if (req.method === 'POST') {
        send(200, await mutate(() => route(req, url, data, reviewerIdentity)))
      } else send(200, await route(req, url))
    } catch (e) {
      send(e.status || (e instanceof SyntaxError ? 400 : 422), {
        error: e.message,
      })
    }
  })
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const server = createKnowledgeServer()
  server.requestTimeout = 15 * 60 * 1000
  server.listen(
    Number(process.env.KNOWLEDGE_PORT || 8090),
    process.env.KNOWLEDGE_HOST || '127.0.0.1',
    () => console.log('Knowledge service ready'),
  )
}
