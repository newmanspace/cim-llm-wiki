import { assertNoFileIncludes } from '../wiki-core/markdown.mjs'
import { documentResources } from '../wiki-core/document-package.mjs'
import { validateOptionalScore } from '../wiki-core/quality-score.mjs'
import { requestID } from './request-logs.mjs'
import { createDefaultsStore } from '../wiki-core/document-defaults.mjs'
import { checkCandidate } from '../wiki-core/local-ingest.mjs'
import { NODE_TYPES } from '../wiki-core/contracts.mjs'
import { documentDirectoryRule, validateDocumentTargetPath } from '../wiki-core/document-routing.mjs'
import { verifyGitEvidence } from './source-evidence.mjs'
import {
  readFileSync,
  mkdirSync,
  existsSync,
  lstatSync,
  writeFileSync,
  renameSync,
  rmSync,
  realpathSync,
} from 'node:fs'
import {
  join,
  resolve,
  dirname,
  relative,
  isAbsolute,
  basename,
} from 'node:path'
import { requestLedger } from './ledger-http.mjs'
import { readRegularFile } from '../wiki-core/safe-files.mjs'
import { createHash, randomUUID } from 'node:crypto'
import MarkdownIt from 'markdown-it'
import { resolveShared, hashFile } from '../wiki-core/sources.mjs'
const fail = (message, status = 422) => {
  throw Object.assign(new Error(message), { status })
}
const identifier = (value) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value))
    fail('Explicit project binding required')
  return value
}
const parser = new MarkdownIt({ html: true })
export const validateTarget = validateDocumentTargetPath
function validateMarkdown(text, pack) {
  try { assertNoFileIncludes(text) } catch (error) { fail(error.message) }
  if (!text.trim() || Buffer.byteLength(text) > 4 * 1024 * 1024)
    fail('Markdown is empty or exceeds the size limit')
  const tokens = parser.parse(text, {})
  for (const token of tokens) {
    if (
      token.type === 'html_block' ||
      token.children?.some((t) => t.type === 'html_inline')
    )
      fail('Executable or raw HTML is not allowed in classified documents')
    validateInline(token.children || [], pack)
  }
}
function validateInline(children, pack) {
  for (const child of children) {
    if (child.type === 'image') {
      const src = child.attrGet('src') || ''
      if (pack && /^https?:/i.test(src)) continue
      if (pack && !src.startsWith('data:')) {
        const resource = documentResources('![image](' + src + ')', pack.entry).resources[0]
        if (!resource || !pack.files.some(file => file.path === resource.path && ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.media_type))) fail('Image must reference a supported raster file in the document package')
        continue
      }
      if (
        !src.startsWith('data:image/') ||
        !/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(src)
      )
        fail('Images must be embedded raster data with supported MIME types')
    }
    if (child.type === 'link_open') {
      const href = child.attrGet('href') || ''
      if (/^(javascript|vbscript|data|file):/i.test(href))
        fail('Unsafe document link')
    }
  }
}
function safeFile(root, path) {
  const dest = resolve(root, path),
    rel = relative(root, dest)
  if (rel.startsWith('..') || isAbsolute(rel))
    fail('Output escaped configured root')
  let current = resolve(root)
  for (const segment of rel.split('/')) {
    current = join(current, segment)
    if (existsSync(current) && lstatSync(current).isSymbolicLink())
      fail('Output path contains a symbolic link')
  }
  return dest
}
export function createDocumentQuality({
  ledgerURL = process.env.CIM_WIKI_LEDGER_URL,
  ledgerToken = process.env.CIM_WIKI_LEDGER_TOKEN,
  organizedRoot = process.env.CIM_WIKI_ORGANIZED_ROOT,
  projectRoot,
  roots,
  registeredDocument,
  uploads,
  wikiRoot,
  namingCheck,
}) {
  const enabled = Boolean(ledgerURL && ledgerToken)
  if (Boolean(ledgerURL) !== Boolean(ledgerToken))
    fail('Both ledger URL and token must be configured')
  const origin = ledgerURL ? new URL(ledgerURL) : null
  if (
    origin &&
    (!['http:', 'https:'].includes(origin.protocol) ||
      origin.username ||
      origin.password ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash)
  )
    fail('Invalid ledger origin')
  function ledgerTarget(project, resource, query) {
    const projectID = identifier(project)
    if (typeof resource !== 'string' || !/^[a-z]+(?:-[a-z]+)*$/.test(resource)) fail('Invalid ledger resource', 422)
    const url = new URL(
      `/internal/v1/projects/${encodeURIComponent(projectID)}/document-quality/${resource}`,
      origin,
    )
    if (url.origin !== origin.origin) fail('Ledger origin cannot change', 422)
    if (query)
      for (const [k, v] of Object.entries(query))
        if (v !== undefined) url.searchParams.set(k, String(v))
    return url
  }
  async function call(
    project,
    resource,
    { body, key, reviewToken, query } = {},
  ) {
    if (!enabled) fail('Document ledger is not configured', 503)
    const url = ledgerTarget(project, resource, query)
    let response
    try {
      response = await requestLedger(origin, {
        path: url.pathname + url.search,
        method: body ? 'POST' : 'GET',
        headers: {
          Authorization: `Bearer ${ledgerToken}`,
          'Content-Type': 'application/json',
          ...(requestID() ? { 'X-Request-ID': requestID() } : {}),
          ...(key ? { 'Idempotency-Key': key } : {}),
          ...(reviewToken ? { 'X-Document-Review-Token': reviewToken } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,

      })
    } catch {
      fail('Document ledger is unavailable', 503)
    }
    const value = response.value
    if (!response.ok) throw Object.assign(new Error(value.error || 'Document ledger request failed'), { status: response.status, code: value.code, existing: value.existing })
    return value.data
  }
  async function all(project, resource) {
    const items = []
    let cursor
    do {
      const page = await call(project, resource, {
        query: { cursor, limit: 200 },
      })
      items.push(...page.items)
      cursor = page.next_cursor
    } while (cursor)
    return items
  }
  async function sources(project) {
    const [sources, configs] = await Promise.all([all(project, 'data-sources'), all(project, 'source-revisions')])
    return sources.map(source => {
      const config = configs.find(config => config.id === source.config_id && config.source_id === source.id)
      if (!config) fail('Data source configuration is missing', 409)
      return { ...source, ...config, id: source.id, config_id: source.config_id, enabled: source.enabled, revision: source.revision }
    })
  }
  async function directories(project, definition) {
    return (await all(project, 'document-directories')).map(directory => ({
      ...directory,
      node_types: definition ? documentDirectoryRule(definition, directory.path)?.node_types || [] : null,
    }))
  }
  async function context(project) {
    if (!enabled) return { document_quality: { enabled: false } }
    const definition = createDefaultsStore(projectRoot).effective(project).definition
    const [data_sources, document_directories] = await Promise.all([sources(project), directories(project, definition)])
    return { data_sources, document_directories, document_quality: info() }
  }
  function info() {
    return {
      enabled,
      rule_scope: 'classified-markdown-directory',
      document_dimensions: ['fidelity', 'completeness', 'traceability', 'consistency', 'structure', 'usability', 'validity'],
      organized_export_enabled: Boolean(organizedRoot),
      requires_human: false,
      approval_policy: 'directory-quality-policy',
    }
  }
  async function find(project, resource, id) {
    const value = (await all(project, resource)).find(
      (r) => r.id === String(id),
    )
    if (!value) fail('Project document record not found', 404)
    return value
  }
  const resolveInput = (project, uri) => uploads ? uploads.resolve(project, uri) : resolveShared(uri, roots)
  const inputPackage = (project, uri) => uri?.startsWith('document-package://') ? uploads.getPackage(project, uri) : null
  function snapshot(project, input) {
    const source = resolveInput(project, input)
    const content = readRegularFile(source)
    const sha256 = createHash('sha256').update(content).digest('hex'),
      extension = source.toLowerCase().endsWith('.md') ? '.md' : '.bin'
    const path = join(
      projectRoot,
      'data/document-content',
      identifier(project),
      sha256 + extension,
    )
    mkdirSync(dirname(path), { recursive: true })
    try { writeFileSync(path, content, { flag: 'wx', mode: 0o600 }) }
    catch (error) {
      if (error.code !== 'EEXIST') throw error
      if (!readRegularFile(path).equals(content)) fail('Immutable content snapshot has drifted', 409)
    }
    return { sha256, path, package: inputPackage(project, input) }
  }
  function verifySnapshot(artifact) {
    if (!existsSync(artifact.snapshot_path) || hashFile(artifact.snapshot_path) !== artifact.content_sha256)
      fail('Artifact snapshot changed or is missing', 409)
    if (artifact.parsed_snapshot_path && hashFile(artifact.parsed_snapshot_path) !== artifact.parsed_sha256)
      fail('Parsed snapshot changed or is missing', 409)
  }
  function checkLocalReport(project, data, content, binding) {
    if (!data.local_report) return
    if (data.local_report.project !== project || data.local_report.content_sha256 !== content.sha256 ||
        data.local_report.document_contract_digest !== binding.digest ||
        data.local_report.target_path !== data.target_path ||
        data.local_report.template_id !== (data.template_id ?? null) ||
        data.local_report.document_id !== (data.document_id ?? null))
      fail('Local report does not match the submitted document or rules', 409)
  }
  function verifyPackages(project, artifact) {
    if (artifact.package_sha256 && inputPackage(project, artifact.content_uri)?.package_sha256 !== artifact.package_sha256) fail('Document attachments changed', 409)
    if (artifact.parsed_package_sha256 && inputPackage(project, artifact.parsed_uri)?.package_sha256 !== artifact.parsed_package_sha256) fail('Parsed attachments changed', 409)
  }
  async function verifyArtifact(project, artifact, requireFrozen = true) {
    validateTarget(artifact.target_path)
    verifySnapshot(artifact)
    verifyPackages(project, artifact)
    if (hashFile(resolveInput(project, artifact.content_uri)) !== artifact.content_sha256)
      fail('Classified document changed; register a new version', 409)
    for (const link of artifact.source_links) {
      const source = await find(
        project,
        'source-observations',
        link.source_version_id,
      )
      if (
        source.source_type === 'git' &&
        hashFile(resolveInput(project, source.git_info_uri)) !==
          source.git_info_sha256
      )
        fail('Git evidence changed; register a new source observation', 409)
      if (
        hashFile(resolveInput(project, source.original_uri)) !==
          source.original_sha256 ||
        hashFile(source.snapshot_path) !== source.original_sha256
      )
        fail('Original document changed or is missing', 409)
    }
    verifyParsedSource(project, artifact, requireFrozen)
    if(!artifact.document_contract_digest)fail('Artifact contract binding is missing',409)
    if (namingCheck && artifact.workflow_state !== 'draft') await namingCheck(project, artifact.document_id, artifact)
    return artifact
  }
  function verifyParsedSource(project, artifact, requireFrozen) {
    const registered = registeredDocument(artifact.parsed_uri, project, artifact.parsed_source_id)
    if (
      registered.project !== project ||
      (requireFrozen && (artifact.workflow_version ? artifact.workflow_state !== 'frozen' : registered.state === 'draft')) ||
      hashFile(resolveInput(project, registered.path)) !== (artifact.parsed_sha256 || registered.sha256)
    )
      fail('Parsed document is not frozen at its registered version', 409)
  }
  async function prepareNamingIdentity(project, data) {
    const naming = namingCheck ? await namingCheck(project, data.document_id, data) : null
    if (naming?.identity) {
      if (data.logical_key && data.logical_key !== data.document_id) fail('logical_key must be the document identity', 422)
      data.logical_key = data.document_id
      data.naming_digest = naming.digest
    }
  }
  async function prepareArtifact(project, data, draft = false) {
    if (!draft || data.document_id) await prepareNamingIdentity(project, data)
    validateTarget(data.target_path)
    validateOptionalScore(data.qscore)
    const binding = createDefaultsStore(projectRoot).effective(project)
    if (data.document_contract_digest && data.document_contract_digest !== binding.digest)
      fail('Project rules changed; refresh local rules and checks', 409)
    data.document_contract_digest = binding.digest
    const doc = registeredDocument(data.parsed_uri, project, data.parsed_source_id)
    if (doc.project !== project)
      fail('Parsed source belongs to another project', 403)
    const content = snapshot(project, data.content_uri)
    if (data.content_sha256 && data.content_sha256 !== content.sha256)
      fail('Artifact hash mismatch', 409)
    const document = readFileSync(content.path, 'utf8')
    validateMarkdown(document, content.package)
    if (!draft) validateSubmission(project, data, document, binding)
    const parsed = snapshot(project, data.parsed_uri)
    data.parsed_sha256 = parsed.sha256
    data.parsed_snapshot_path = parsed.path
    if (content.package) {
      data.package_sha256 = content.package.package_sha256
      data.parsed_package_sha256 = parsed.package?.package_sha256 ?? null
      if (!data.local_report || data.local_report.package_sha256 !== data.package_sha256) fail('Local report does not match document attachments', 409)
    }
    checkLocalReport(project, data, content, binding)
    await checkOriginalLinks(project, data, doc)
    data.content_sha256 = content.sha256
    data.snapshot_path = content.path
  }
  function validateSubmission(project, data, document, binding) {
    let report
    try {
      report = checkCandidate({ project, ...binding.definition, binding, node_contracts: NODE_TYPES }, { ...data, project, document })
    } catch (error) {
      throw Object.assign(new Error(error.message), { status: 422, code: 'DOCUMENT_SUBMISSION_INVALID' })
    }
    if (report.errors.length) throw Object.assign(new Error('Document submission validation failed'), {
      status: 422, code: 'DOCUMENT_SUBMISSION_INVALID', diagnostics: report.errors,
    })
  }
  async function checkOriginalLinks(project, data, doc) {
    const links = data.source_links
    if (!Array.isArray(links) || !links.length)
      fail('Source links are required')
    if (hashFile(resolveInput(project, doc.original_uri)) !== doc.original_sha256)
      fail('Original document changed after parsing', 409)
    const pack = inputPackage(project, doc.original_uri)
    const required = pack ? pack.files : [{ uri: doc.original_uri, sha256: doc.original_sha256 }]
    const observed = []
    for (const link of links) observed.push(await find(project, 'source-observations', link.source_version_id))
    for (const resource of required) {
      if (!observed.some(source => source.original_uri === resource.uri && source.original_sha256 === resource.sha256) &&
          !observed.some(source => source.original_uri === doc.original_uri && source.original_sha256 === doc.original_sha256))
        fail('Artifact sources must include the registered original and its attachments', 409)
    }
  }
  async function prepareObservation(project, data) {
    const original = snapshot(project, data.original_uri)
    if (data.original_sha256 !== original.sha256)
      fail('Source hash differs from observed file', 409)
    const run = await find(project, 'ingest-runs', data.run_id)
    if (run.source_type === 'git') {
      const infoPath = resolveInput(project, data.git_info_uri)
      verifyGitEvidence(
        readFileSync(infoPath, 'utf8'),
        data,
        run,
        readFileSync(original.path),
      )
      data.git_info_sha256 = hashFile(infoPath)
    } else if (run.source_type === 'svn') {
      const info = readFileSync(resolveInput(project, data.svn_info_uri), 'utf8')
      if (
        !info.includes(`<uuid>${run.repository_uuid}</uuid>`) ||
        !info.includes(`revision="${run.operative_revision}"`)
      )
        fail('SVN evidence differs from the pinned run', 409)
    }
    data.snapshot_path = original.path
  }
  async function mutate(operation, input, key, reviewToken) {
    const project = identifier(input.project)
    if (!key) fail('Idempotency-Key is required')
    const data = structuredClone(input)
    delete data.project
    if (operation === 'source-observations')
      await prepareObservation(project, data)
    if (['artifacts', 'document-drafts', 'document-submit'].includes(operation)) {
      if (data.artifact_id) fail('Submit the complete candidate and local report as a new version', 422)
      await prepareArtifact(project, data, operation === 'document-drafts')
    }
    if (['document-freeze', 'document-review-requests'].includes(operation)) {
      const artifact = await verifyArtifact(project, await find(project, 'document-results', data.artifact_id), operation !== 'document-freeze')
      data.content_sha256 = artifact.content_sha256
      data.package_sha256 = artifact.package_sha256
    }
    if (
      operation === 'document-evaluations' ||
      operation === 'document-review-decisions'
    ) {
      const artifactID =
        operation === 'document-evaluations'
          ? data.artifact_id
          : (await find(project, 'document-review-tasks', data.task_id))
              .artifact_id
      await verifyArtifact(
        project,
        await find(project, 'document-results', artifactID),
      )
    }
    return call(project, operation, { body: data, key, reviewToken })
  }
  async function bindings(project, sourceURIs, artifactIds) {
    if (!enabled) {
      if (artifactIds?.length)
        fail('Document ledger is required for quality-linked bundles', 503)
      return []
    }
    const configured = (await all(project, 'data-sources')).length > 0
    if (!configured && !artifactIds?.length) return []
    if (!Array.isArray(artifactIds) || !artifactIds.length)
      fail(
        'Project source documents require artifact_ids and quality evaluations',
        409,
      )
    const evaluations = await all(project, 'document-evaluations'),
      out = []
    for (const id of new Set(artifactIds)) {
      const artifact = await find(project, 'document-results', id)
      const evaluation = evaluations
        .filter((e) => e.artifact_id === artifact.id)
        .at(-1)
      if (!evaluation) fail('Document quality evaluation is missing', 409)
      out.push({
        artifact_id: artifact.id,
        evaluation_id: evaluation.id,
        parsed_uri: artifact.parsed_uri,
        content_sha256: artifact.content_sha256,
      })
    }
    for (const source of sourceURIs)
      if (!out.some((a) => a.parsed_uri === source))
        fail('Every node source must have a quality-reviewed artifact', 409)
    return out
  }
  async function gate(project, bindings, phase = 'check', key = '') {
    const publications = []
    try {
      for (const binding of bindings || []) {
        const artifact = await verifyArtifact(
          project,
          await find(project, 'document-results', binding.artifact_id),
        )
        const evaluation = await find(
          project,
          'document-evaluations',
          binding.evaluation_id,
        )
        const policy = await call(project, 'quality-policy-effective', {
          query: {
            path: artifact.target_path.slice(
              0,
              artifact.target_path.lastIndexOf('/'),
            ),
          },
        })
        if (
          evaluation.artifact_id !== artifact.id ||
          evaluation.policy_digest !== policy.digest ||
          evaluation.blocking
        )
          fail('Document quality approval is stale or blocked', 409)
        const versions = await all(project, 'document-results')
        const evaluations = await all(project, 'document-evaluations')
        if (
          versions.some(
            (v) =>
              v.logical_key === artifact.logical_key &&
              v.version > artifact.version,
          ) ||
          evaluations.filter((e) => e.artifact_id === artifact.id).at(-1)
            ?.id !== evaluation.id
        )
          fail('A newer artifact or evaluation supersedes this approval', 409)
        const tasks = await all(project, 'document-review-tasks')
        if (!approvedReview(tasks, evaluation, policy))
          fail('Document review approval is required', 409)
        if (phase === 'start')
          publications.push(
            await call(project, 'publication-start', {
              body: { artifact_id: artifact.id, evaluation_id: evaluation.id },
              key: key + '-' + artifact.id,
            }),
          )
      }
    } catch (error) {
      if (publications.length)
        await finish(project, publications, 'failed', key)
      throw error
    }
    return publications
  }
  function approvedReview(tasks, evaluation, policy) {
    return tasks.find((task) => {
      if (task.evaluation_id !== evaluation.id || task.status !== 'approved') return false
      if (task.approval_mode !== 'auto') return true
      return !policy.require_human && !evaluation.needs_review &&
        typeof evaluation.total === 'number' && evaluation.total >= policy.review_threshold
    })
  }
  async function finish(project, publications, status, key) {
    const completed = []
    for (const p of publications)
      completed.push(await call(project, 'publication-finish', {
        body: { id: p.id, status },
        key: key + '-' + p.id + '-' + status,
      }))
    return completed
  }
  function outputPath(project, artifact, input) {
    mkdirSync(organizedRoot, { recursive: true })
    const root = realpathSync(organizedRoot)
    if (
      root === realpathSync(projectRoot) ||
      root === resolve(wikiRoot || join(projectRoot, 'data/wiki')) ||
      root.startsWith(resolve(wikiRoot || join(projectRoot, 'data/wiki')) + '/')
    )
      fail(
        'Organized exports must be separate from code and runtime knowledge roots',
      )
    const dest = safeFile(root, `${project}/${artifact.target_path}`)
    if (
      existsSync(dest) &&
      hashFile(dest) !== artifact.content_sha256 &&
      !input.expected_sha256
    )
      fail('Replacing an organized file requires its expected SHA-256', 409)
    if (
      input.expected_sha256 &&
      (existsSync(dest) ? hashFile(dest) : null) !== input.expected_sha256
    )
      fail('Organized output baseline changed', 409)
    return dest
  }
  async function publish(input, key) {
    if (!organizedRoot)
      fail('A separate organized Markdown root must be configured', 503)
    const project = identifier(input.project),
      artifact = await verifyArtifact(
        project,
        await find(project, 'document-results', input.artifact_id),
      )
    const binding = {
      artifact_id: artifact.id,
      evaluation_id: input.evaluation_id,
    }
    await gate(project, [binding])
    const tasks=await all(project,'document-review-tasks'),events=await all(project,'document-review-events')
    const task=tasks.find(t=>t.evaluation_id===input.evaluation_id&&t.status==='approved')
    const decision=events.find(e=>e.task_id===task?.id&&e.decision==='approve')
    const reviewer=decision?.actor_id
    if(task?.approval_mode==='auto' && (reviewer!=='system:quality-policy' || decision.approval_mode!=='auto' || decision.policy_digest!==task.policy_digest))fail('Automatic approval evidence is missing or stale',409)
    void reviewer
    const dest = outputPath(project, artifact, input)
    if (existsSync(dest) && hashFile(dest) === artifact.content_sha256) {
      const completed = (await all(project, 'publications')).filter(
        (p) =>
          p.artifact_id === artifact.id &&
          p.evaluation_id === input.evaluation_id &&
          p.status === 'published',
      )
      if (completed.length)
        return {
          path: dest,
          sha256: artifact.content_sha256,
          publications: completed,
        }
    }
    const publications = await gate(
      project,
      [binding],
      'start',
      (key || 'export') + '-' + randomUUID(),
    )
    let wrote = false
    try {
      mkdirSync(dirname(dest), { recursive: true })
      const temp = dest + '.' + randomUUID() + '.tmp'
      try {
        writeFileSync(temp, readFileSync(artifact.snapshot_path), {
          flag: 'wx',
        })
        renameSync(temp, dest)
        wrote = true
      } finally {
        rmSync(temp, { force: true })
      }
      const completed = await finish(project, publications, 'published', key)
      return { path: dest, sha256: artifact.content_sha256, publications: completed }
    } catch (e) {
      if (!wrote) await finish(project, publications, 'failed', key)
      throw e
    }
  }
  async function reviewedSource(project, taskID) {
    const task = await find(project, 'document-review-tasks', taskID)
    const artifact = await find(project, 'document-results', task.artifact_id)
    if (task.status !== 'approved' || artifact.workflow_state !== 'frozen' ||
        task.artifact_digest !== (artifact.package_sha256 || artifact.content_sha256))
      fail('The frozen document version must have an approved document review', 409)
    const versions = await all(project, 'document-results')
    if (versions.some(v => v.logical_key === artifact.logical_key && v.version > artifact.version)) fail('Reviewed document version is superseded', 409)
    const document = readRegularFile(artifact.snapshot_path)
    if (createHash('sha256').update(document).digest('hex') !== artifact.content_sha256) fail('Reviewed document snapshot changed', 409)
    const pack = inputPackage(project, artifact.content_uri)
    if (artifact.package_sha256 && pack?.package_sha256 !== artifact.package_sha256) fail('Reviewed document package changed', 409)
    const files = [{ path: artifact.target_path, bytes: document }]
    for (const item of pack?.files || []) {
      if (item.path === pack.entry) continue
      const path = join(dirname(artifact.target_path), relative(dirname(pack.entry), item.path))
      const bytes = readRegularFile(uploads.file(project, item.uri).path)
      if (createHash('sha256').update(bytes).digest('hex') !== item.sha256) fail('Reviewed attachment changed', 409)
      files.push({ path, bytes })
    }
    return { artifact, task, files }
  }
  async function preview(project, id, original = false) {
    const artifact = await find(project, 'document-results', id)
    verifySnapshot(artifact)
    if (!artifact.workflow_version) await verifyArtifact(project, artifact, false)
    if (!original)
      return {
        markdown: readFileSync(artifact.snapshot_path, 'utf8'),
        parsed: readFileSync(artifact.parsed_snapshot_path || resolveInput(project, artifact.parsed_uri), 'utf8'),
        candidate_package: inputPackage(project, artifact.content_uri),
        parsed_package: inputPackage(project, artifact.parsed_uri),
      }
    const registered = registeredDocument(artifact.parsed_uri, project, artifact.parsed_source_id)
    const originalPack = inputPackage(project, registered.original_uri)
    const entryURI = originalPack?.files.find(file => file.path === originalPack.entry)?.uri || registered.original_uri
    const observations = await Promise.all(artifact.source_links.map(link => find(project, 'source-observations', link.source_version_id)))
    const source = observations.find(item => item.original_uri === registered.original_uri || item.original_uri === entryURI)
    if (!source) fail('Registered original source not found', 409)
    const bytes = readFileSync(source.snapshot_path)
    if (createHash('sha256').update(bytes).digest('hex') !== source.original_sha256)
      fail('Original snapshot changed', 409)
    if (bytes.length > 25 * 1024 * 1024)
      fail('Original is too large for inline download; use its shared URI', 413)
    return {
      name: basename(source.repository_path),
      base64: bytes.toString('base64'),
    }
  }
  async function resource(project, id, scope, path) {
    const artifact = await find(project, 'document-results', id)
    if (!['candidate', 'parsed'].includes(scope)) fail('Invalid resource scope')
    const pack = inputPackage(project, scope === 'candidate' ? artifact.content_uri : artifact.parsed_uri)
    const item = pack?.files.find(file => file.path === path)
    if (!item) fail('Document attachment not found', 404)
    return uploads.file(project, item.uri)
  }
  return {
    enabled,
    info,
    sources,
    directories,
    context,
    call,
    all,
    find,
    mutate,
    bindings,
    gate,
    finish,
    publish,
    preview,
    resource,
    reviewedSource,
  }
}
