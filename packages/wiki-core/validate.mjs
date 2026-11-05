import { sharedRoots, resolveSource, resolveShared, hashFile, nodeProvenance } from './sources.mjs'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, relative, posix } from 'node:path'
import { createHash } from 'node:crypto'
import { PROJECT_ROOT, CONTRACT_ROOT, schemaErrors, nodeLocation, slugify, loadTemplateContracts, REFERENCE_TYPES } from './contracts.mjs'
import { parsePage, structureErrors, pageLinks } from './markdown.mjs'
import { validateDocumentSets } from './document-set.mjs'

const vocabulary = JSON.parse(readFileSync(join(CONTRACT_ROOT, 'vocabulary.json'), 'utf8'))
const issue = (code, path, message) => ({ code, path, message })

export function validateWiki({ projectRoot = process.env.CIM_WIKI_WORKSPACE || PROJECT_ROOT, wikiRoot = join(projectRoot, 'data/wiki'), roots = sharedRoots() } = {}) {
  wikiRoot = resolve(wikiRoot)
  const errors = [], warnings = [], pages = new Map(), files = new Set(), projects = new Set()
  const add = (code, path, message) => errors.push(issue(code, path, message))
  if (!statSync(wikiRoot, { throwIfNoEntry: false })?.isDirectory()) {
    return { errors: [issue('wiki_missing', wikiRoot, 'Wiki directory does not exist')], warnings, scanned: 0 }
  }
  const registryPath = join(projectRoot, 'data/documents/project-registry.json')
  if (existsSync(registryPath)) {
    try {
      const registry = JSON.parse(readFileSync(registryPath, 'utf8'))
      if (!registry.projects || Array.isArray(registry.projects) || typeof registry.projects !== 'object') throw new Error('registry.projects must be an object')
      for (const project of Object.keys(registry.projects)) {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(project)) throw new Error(`Invalid project ID: ${project}`)
        projects.add(project)
      }
    } catch (e) { add('project_registry_error', registryPath, e.message) }
  }
  function walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === '.vitepress') continue
      const path = join(dir, e.name), key = relative(wikiRoot, path).split('\\').join('/')
      if (e.isSymbolicLink()) { add('unsafe_path', key, 'Symbolic links are not permitted in published content'); continue }
      if (e.isDirectory()) {
        if (dir === wikiRoot && e.name !== 'templates' && (
          statSync(join(path, 'doc'), { throwIfNoEntry: false })?.isDirectory() ||
          statSync(join(path, 'code'), { throwIfNoEntry: false })?.isDirectory() ||
          existsSync(join(path, 'document-contract.json'))
        )) projects.add(e.name)
        if (e.name === 'templates') {
          if (key !== 'templates' && !/^[^/]+\/templates$/.test(key)) add('unsafe_path', key, 'Templates must be at wiki or project root')
          else if (key !== 'templates') projects.add(key.split('/')[0])
          continue
        }
        walk(path)
      } else files.add(key)
    }
  }
  walk(wikiRoot)
  let contractFor
  try {
    contractFor = loadTemplateContracts(wikiRoot)
    for (const project of projects) contractFor(project)
  } catch (e) { add('template_contract_error', wikiRoot, e.message) }

  for (const key of files) {
    if (!key.endsWith('.md')) continue
    let page
    try { page = parsePage(readFileSync(join(wikiRoot, key), 'utf8')) }
    catch (e) { add('frontmatter_error', key, e.message); continue }
    if (key === 'index.md') {
      if (typeof page.fm.title !== 'string' || !page.fm.title.trim() || Object.keys(page.fm).some(k => k !== 'title')) {
        add('homepage_schema', key, 'The generated root index may only declare its title')
      }
      continue
    }
    const { fm } = page
    const segments = key.split('/')
    const project = segments[0]
    pages.set(key, { ...page, project })
    const problems = schemaErrors('node', fm)
    for (const message of problems) add('schema_error', key, message)
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(project) || !['doc', 'code'].includes(segments[1]) || segments.length < 4) {
      add('plane_mismatch', key, 'Expected <project>/<doc|code>/<directory>/<file>.md')
    }
    if (segments.at(-1) !== `${slugify(fm.id)}.md`) add('filename_mismatch', key, 'Filename must match the node ID')
    try {
      const [plane, dir] = nodeLocation(fm)
      if (plane !== segments[1] || dir !== segments[2] || fm.plane !== plane) add('plane_mismatch', key, `Expected ${plane}/${dir}, including matching plane metadata`)
      if (dir !== 'manuals' && segments.length !== 4) add('plane_mismatch', key, 'Atomic nodes must not have nested directories')
      if (contractFor) {
        const contract = contractFor(project)[fm.type]
        errors.push(...structureErrors(page.tokens, contract, fm).map(e => issue(e.code, key, e.message)))
      }
    } catch (e) { add('template_contract_error', key, e.message) }
    if (fm.status === 'draft') add('unpublished_node', key, 'Draft nodes cannot be in the published wiki')
    if (fm.status === 'published' && fm.review_level === 'archive') add('review_required', key, 'Archived review decisions cannot be published')
    if (['L1_expert', 'L2_arch'].includes(fm.review_level) && fm.status === 'published' && fm.reviewer === 'auto') {
      add('review_required', key, 'Human review level requires an identified human reviewer')
    }
    if (fm.severity === 'Critical' && fm.review_level !== 'L2_arch') add('review_required', key, 'Critical rules require L2_arch review')
    if (fm.rule_type === 'business_rule' && Array.isArray(fm.applies_to) && fm.applies_to.length) add('rule_type_mismatch', key, 'Rules with applies_to must declare rule_type=contract')
    if (fm.operation && !vocabulary.operation.includes(fm.operation)) add('vocabulary_violation', key, `Unknown operation: ${fm.operation}`)
    if (fm.rule_category && !vocabulary.category.includes(fm.rule_category)) add('vocabulary_violation', key, `Unknown rule_category: ${fm.rule_category}`)
    if (Array.isArray(fm.rule_tags)) for (const tag of fm.rule_tags) {
      if (!vocabulary.category.includes(tag)) add('vocabulary_violation', key, `Unknown rule tag: ${tag}`)
    }
    if (fm.type === 'api' && !(Array.isArray(fm.preconditions) && fm.preconditions.length)) {
      const i = page.tokens.findIndex((t, i, ts) => t.type === 'heading_open' && ts[i + 1]?.content === 'Preconditions')
      if (i < 0 || !/^None[.!。]?$/i.test(page.tokens[i + 4]?.content?.trim() || '')) {
        add('preconditions_missing', key, 'Declare rule references or an explicit None in Preconditions')
      }
    }
    if (fm.created_at && fm.updated_at && Date.parse(fm.updated_at) < Date.parse(fm.created_at)) add('timestamp_order', key, 'updated_at precedes created_at')
    if (fm.updated_at && Date.now() - Date.parse(fm.updated_at) > 365 * 86400000) warnings.push(issue('outdated', key, 'Last update is older than one year'))
  }

  function resolveLink(target, key, wiki = true) {
    if (typeof target !== 'string') return null
    const raw = target.split('#')[0].split('?')[0]
    if (!raw) return key
    let decoded
    try { decoded = decodeURIComponent(raw) } catch { return null }
    if (decoded.includes('\\') || decoded.includes('\0')) return null
    const project = key.split('/')[0]
    const candidate = wiki
      ? posix.normalize(`${project}/${decoded.replace(/^\//, '')}`)
      : decoded.startsWith('/wiki/') ? decoded.slice('/wiki/'.length)
        : decoded.startsWith('/') ? decoded.slice(1) : posix.normalize(posix.join(posix.dirname(key), decoded))
    if (!candidate.startsWith(`${project}/`)) return null
    const options = [candidate]
    if (candidate.endsWith('.html')) options.push(candidate.slice(0, -5) + '.md')
    if (!posix.extname(candidate)) options.push(`${candidate}.md`, `${candidate}/index.md`)
    return options.find(p => files.has(p)) || null
  }

  const ids = new Map(), transactions = new Map(), incoming = new Map()
  for (const [key, page] of pages) {
    const { fm, project } = page
    const id = `${project}/${fm.id}`
    if (ids.has(id)) add('duplicate_id', key, `Duplicate ID also used by ${ids.get(id)}`)
    else ids.set(id, key)
    if (fm.transaction_code) {
      const code = String(fm.transaction_code).toUpperCase()
      if (transactions.has(code)) add('transaction_code_conflict', key, `Transaction also used by ${transactions.get(code)}`)
      else transactions.set(code, key)
    }
    const links = pageLinks(page.tokens)
    for (const [field, types] of Object.entries(REFERENCE_TYPES).filter(([field]) => field !== 'related_code')) {
      if (!Array.isArray(fm[field])) continue
      for (const value of fm[field]) {
        if (typeof value !== 'string' || !/^\[\[[^\]]+\]\]$/.test(value)) { add('reference_format', key, `${field} must contain wiki links`); continue }
        links.push({ target: value.slice(2, -2), wiki: true, types, field })
      }
    }
    if (Array.isArray(fm.related_code)) for (const value of fm.related_code) {
      if (/^\[\[/.test(value)) links.push({ target: value.slice(2, -2), wiki: true, types: ['code_index'], field: 'related_code' })
    }
    for (const link of links) {
      if (!link.wiki && /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(link.target || '')) continue
      const dest = resolveLink(link.target, key, link.wiki)
      if (!dest) { add('broken_link', key, `Unresolved or cross-project link: ${link.target}`); continue }
      incoming.set(dest, (incoming.get(dest) || 0) + 1)
      if (link.types && !link.types.includes(pages.get(dest)?.fm.type)) add('reference_type', key, `${link.field} must target ${link.types.join('|')}: ${dest}`)
    }
  }
  for (const key of pages.keys()) if (!incoming.has(key)) warnings.push(issue('orphan_knowledge', key, 'Page has no incoming references'))
  errors.push(...validateDocumentSets({ wikiRoot, projects, pages, resolveLink }))

  const manifestPath = join(projectRoot, 'data/documents/manifest.json')
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      if (!Array.isArray(manifest.docs)) throw new Error('manifest.docs must be an array')
      const byPath = new Map()
      for (const rec of manifest.docs) {
        byPath.set(rec.path, rec)
        let path
        try { path = resolveSource(rec.path, projectRoot, roots) }
        catch (e) { add('source_unavailable', rec.path, e.message); continue }
        if (!existsSync(path)) { add('doc_missing', rec.path, 'Registered source does not exist'); continue }
        if (rec.path.startsWith('shared://')) {
          try {
            if (!rec.original_uri || !rec.original_path || !rec.original_sha256 || !rec.version) throw new Error('Original document provenance is incomplete')
            if (hashFile(resolveShared(rec.original_uri, roots)) !== rec.original_sha256) add('original_drift', rec.path, 'Original document content has changed')
          } catch (e) { add('original_unavailable', rec.path, e.message) }
        }
        if (rec.state !== 'draft') {
          const hash = createHash('sha256').update(readFileSync(path)).digest('hex')
          if (!rec.sha256 || hash !== rec.sha256) add('doc_drift', rec.path, 'Frozen source hash is missing or has changed')
        }
      }
      for (const [key, { fm }] of pages) {
        for (const source of Array.isArray(fm.source) ? fm.source : [fm.source]) {
          if (typeof source === 'string' && source.startsWith('shared://')) {
            try {
              const expected = nodeProvenance({ source }, manifest)[0]
              if (!fm.provenance?.some(p => JSON.stringify(p) === JSON.stringify(expected))) add('provenance_mismatch', key, 'Original document provenance is absent or differs from the registered source')
            } catch (e) { add('provenance_missing', key, e.message) }
          }
          if (byPath.get(source)?.state === 'draft') add('doc_state', key, `Source is still draft: ${source}`)
        }
      }
    } catch (e) { add('source_manifest_error', manifestPath, e.message) }
  }
  if (!existsSync(manifestPath)) for (const [key, { fm }] of pages) {
    if ((Array.isArray(fm.source) ? fm.source : [fm.source]).some(s => typeof s === 'string' && s.startsWith('shared://'))) add('provenance_missing', key, 'Shared source manifest is missing')
  }
  return { errors, warnings, scanned: pages.size }
}

export function assertValidWiki(options) {
  const result = validateWiki(options)
  if (result.errors.length) throw new Error(result.errors.map(e => `[${e.code}] ${e.path}: ${e.message}`).join('\n'))
  return result
}
