import { createDefaultsStore, checkDocument } from '../wiki-core/document-defaults.mjs'
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
import { randomUUID } from 'node:crypto'
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
const standardDoc = new Set([
  '00-overview',
  '10-planning',
  '20-architecture',
  '30-standards',
  '40-requirements',
  '50-designs',
  '60-test',
  '70-release',
  '80-deploy',
  '90-guides',
  '99-templates',
])
const standardCode = new Set([
  'apis',
  'domain',
  'rules',
  'schemas',
  'code-index',
])
export function validateTarget(path) {
  if (typeof path !== 'string' || path.length > 600)
    fail('Invalid classified Markdown path')
  const parts = path.split('/')
  if (
    parts.length < 3 ||
    parts.some(
      (p) =>
        !p ||
        p === '.' ||
        p === '..' ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(p),
    ) ||
    !path.endsWith('.md') ||
    parts.at(-1).toLowerCase() === 'readme.md'
  )
    fail('Invalid classified Markdown path')
  if (
    !(
      parts[0] === 'doc'
        ? standardDoc
        : parts[0] === 'code'
          ? standardCode
          : new Set()
    ).has(parts[1])
  )
    fail('Target is outside the configured document classification')
  return path
}
function validateMarkdown(text) {
  if (!text.trim() || Buffer.byteLength(text) > 4 * 1024 * 1024)
    fail('Markdown is empty or exceeds the size limit')
  const tokens = parser.parse(text, {})
  if (!tokens.some((t) => t.type === 'heading_open' && t.tag === 'h1'))
    fail('Classified Markdown requires a document title')
  for (const token of tokens) {
    if (
      token.type === 'html_block' ||
      token.children?.some((t) => t.type === 'html_inline')
    )
      fail('Executable or raw HTML is not allowed in classified documents')
    validateInline(token.children || [])
  }
}
function validateInline(children) {
  for (const child of children) {
    if (child.type === 'image') {
      const src = child.attrGet('src') || ''
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
  wikiRoot,
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
  async function call(
    project,
    resource,
    { body, key, reviewToken, query } = {},
  ) {
    if (!enabled) fail('Document ledger is not configured', 503)
    identifier(project)
    const url = new URL(
      `/internal/v1/projects/${encodeURIComponent(project)}/document-quality/${resource}`,
      origin,
    )
    if (query)
      for (const [k, v] of Object.entries(query))
        if (v !== undefined) url.searchParams.set(k, String(v))
    let response
    try {
      response = await fetch(url, {
        method: body ? 'POST' : 'GET',
        headers: {
          Authorization: `Bearer ${ledgerToken}`,
          'Content-Type': 'application/json',
          ...(key ? { 'Idempotency-Key': key } : {}),
          ...(reviewToken ? { 'X-Document-Review-Token': reviewToken } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
      })
    } catch {
      fail('Document ledger is unavailable', 503)
    }
    const value = await response.json()
    if (!response.ok)
      fail(value.error || 'Document ledger request failed', response.status)
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
  async function context(project) {
    if (!enabled) return { document_quality: { enabled: false } }
    const [sources, configs, directories] = await Promise.all([
      all(project, 'data-sources'),
      all(project, 'source-revisions'),
      all(project, 'document-directories'),
    ])
    return {
      document_directories: directories,
      data_sources: sources.map((s) => ({
        ...s,
        ...configs.find((c) => c.id === s.config_id),
        id: s.id,
        config_id: s.config_id,
        enabled: s.enabled,
        revision: s.revision,
      })),
      document_quality: {
        enabled: true,
        rule_scope: 'classified-markdown-directory',
        document_dimensions: [
          'fidelity',
          'completeness',
          'traceability',
          'consistency',
          'structure',
          'usability',
          'validity',
        ],
        organized_export_enabled: Boolean(organizedRoot),
        requires_human: true,
      },
    }
  }
  async function find(project, resource, id) {
    const value = (await all(project, resource)).find(
      (r) => r.id === String(id),
    )
    if (!value) fail('Project document record not found', 404)
    return value
  }
  function snapshot(project, input) {
    const source = resolveShared(input, roots)
    const sha256 = hashFile(source),
      extension = source.toLowerCase().endsWith('.md') ? '.md' : '.bin'
    const path = join(
      projectRoot,
      'data/document-content',
      identifier(project),
      sha256 + extension,
    )
    mkdirSync(dirname(path), { recursive: true })
    if (existsSync(path)) {
      if (hashFile(path) !== sha256)
        fail('Immutable content snapshot has drifted', 409)
    } else
      writeFileSync(path, readFileSync(source), { flag: 'wx', mode: 0o600 })
    return { sha256, path }
  }
  async function verifyArtifact(project, artifact) {
    validateTarget(artifact.target_path)
    if (
      !existsSync(artifact.snapshot_path) ||
      hashFile(artifact.snapshot_path) !== artifact.content_sha256
    )
      fail('Artifact snapshot changed or is missing', 409)
    if (
      hashFile(resolveShared(artifact.content_uri, roots)) !==
      artifact.content_sha256
    )
      fail('Classified document changed; register a new version', 409)
    for (const link of artifact.source_links) {
      const source = await find(
        project,
        'source-observations',
        link.source_version_id,
      )
      if (
        source.source_type === 'git' &&
        hashFile(resolveShared(source.git_info_uri, roots)) !==
          source.git_info_sha256
      )
        fail('Git evidence changed; register a new source observation', 409)
      if (
        hashFile(resolveShared(source.original_uri, roots)) !==
          source.original_sha256 ||
        hashFile(source.snapshot_path) !== source.original_sha256
      )
        fail('Original document changed or is missing', 409)
    }
    const registered = registeredDocument(artifact.parsed_uri)
    if (
      registered.project !== project ||
      registered.state === 'draft' ||
      hashFile(resolveShared(registered.path, roots)) !== registered.sha256
    )
      fail('Parsed document is not frozen at its registered version', 409)
    if(!artifact.document_contract_digest)fail('Artifact contract binding is missing',409)
    checkArtifactContract(project,artifact,readFileSync(artifact.snapshot_path,'utf8'))
    return artifact
  }
  function checkArtifactContract(project,artifact,text,phase='review',reviewer) {
    const binding=createDefaultsStore(projectRoot).effective(project)
    if(artifact.document_contract_digest && artifact.document_contract_digest!==binding.digest)fail('Artifact document contract changed; register a new artifact',409)
    const template=binding.definition.templates.find(t=>t.id===artifact.template_id)
    if(!template)fail('Artifact requires a bound template_id',422)
    const diagnostics=checkDocument(template,text,{phase,reviewer,terms:binding.definition.terms,documentPath:artifact.target_path})
    if(diagnostics.some(d=>d.severity==='error'))fail('Artifact document contract failed: '+JSON.stringify(diagnostics),422)
    artifact.document_contract_digest=binding.digest
  }

  async function prepareArtifact(project, data) {
    validateTarget(data.target_path)
    const doc = registeredDocument(data.parsed_uri)
    if (doc.project !== project)
      fail('Parsed source belongs to another project', 403)
    if (doc.state === 'draft')
      fail('Freeze and verify the parsed document before classifying it', 409)
    const content = snapshot(project, data.content_uri)
    if (data.content_sha256 && data.content_sha256 !== content.sha256)
      fail('Artifact hash mismatch', 409)
    validateMarkdown(readFileSync(content.path, 'utf8'))
    checkArtifactContract(project,data,readFileSync(content.path,'utf8'))
    const links = data.source_links
    if (!Array.isArray(links) || !links.length)
      fail('Source links are required')
    let hasRegisteredOriginal = false
    for (const link of links) {
      const original = await find(
        project,
        'source-observations',
        link.source_version_id,
      )
      if (
        original.original_uri === doc.original_uri &&
        original.original_sha256 === doc.original_sha256
      )
        hasRegisteredOriginal = true
    }
    if (!hasRegisteredOriginal)
      fail('Artifact sources must include the registered original', 409)
    data.content_sha256 = content.sha256
    data.snapshot_path = content.path
  }
  async function prepareObservation(project, data) {
    const original = snapshot(project, data.original_uri)
    if (data.original_sha256 !== original.sha256)
      fail('Source hash differs from observed file', 409)
    const run = await find(project, 'ingest-runs', data.run_id)
    if (run.source_type === 'git') {
      const infoPath = resolveShared(data.git_info_uri, roots)
      verifyGitEvidence(
        readFileSync(infoPath, 'utf8'),
        data,
        run,
        readFileSync(original.path),
      )
      data.git_info_sha256 = hashFile(infoPath)
    } else {
      const info = readFileSync(resolveShared(data.svn_info_uri, roots), 'utf8')
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
    if (operation === 'artifacts') await prepareArtifact(project, data)
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
      const artifact = await verifyArtifact(
        project,
        await find(project, 'document-results', id),
      )
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
        if (
          !tasks.some(
            (t) => t.evaluation_id === evaluation.id && t.status === 'approved',
          )
        )
          fail('Independent document review is required', 409)
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
  async function finish(project, publications, status, key) {
    for (const p of publications)
      await call(project, 'publication-finish', {
        body: { id: p.id, status },
        key: key + '-' + p.id + '-' + status,
      })
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
    const reviewer=events.find(e=>e.task_id===task?.id&&e.decision==='approve')?.actor_id
    checkArtifactContract(project,artifact,readFileSync(artifact.snapshot_path,'utf8'),'publish',reviewer)
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
      await finish(project, publications, 'published', key)
      return { path: dest, sha256: artifact.content_sha256, publications }
    } catch (e) {
      if (!wrote) await finish(project, publications, 'failed', key)
      throw e
    }
  }
  async function preview(project, id, original = false) {
    const artifact = await verifyArtifact(
      project,
      await find(project, 'document-results', id),
    )
    if (!original)
      return {
        markdown: readFileSync(artifact.snapshot_path, 'utf8'),
        parsed: readFileSync(resolveShared(artifact.parsed_uri, roots), 'utf8'),
      }
    const source = await find(
      project,
      'source-observations',
      artifact.source_links[0].source_version_id,
    )
    const bytes = readFileSync(source.snapshot_path)
    if (bytes.length > 25 * 1024 * 1024)
      fail('Original is too large for inline download; use its shared URI', 413)
    return {
      name: basename(source.repository_path),
      base64: bytes.toString('base64'),
    }
  }
  return {
    enabled,
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
  }
}
