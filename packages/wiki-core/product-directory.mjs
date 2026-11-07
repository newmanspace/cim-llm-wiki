import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, renameSync, rmSync, lstatSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { CONTRACT_ROOT, NODE_TYPES, readContractJson, schemaErrors } from './contracts.mjs'
import { parsePage } from './markdown.mjs'

const identifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/
const segmentPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/
const reserved = new Set(['__proto__', 'prototype', 'constructor'])
const error = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
const encode = value => JSON.stringify(value, null, 2) + '\n'
const plain = value => typeof value === 'string' && value.length <= 2000 && !/[<>[\]`{}\r\n\0]/.test(value)
const escape = value => value.replace(/[\\*_!#|]/g, '\\$&').replaceAll('&', '&amp;')

function projectPath(project, wikiRoot) {
  if (typeof project !== 'string' || !identifierPattern.test(project) || reserved.has(project) || project === 'templates') error('Invalid project identifier')
  const root = resolve(wikiRoot)
  for (const target of [root, join(root, project), join(root, project, 'directory.json'), join(root, project, 'catalog'), join(root, project, 'document-contract.json')]) {
    if (lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink()) error('Symbolic links are not permitted')
  }
  return join(root, project)
}

export const directoryPageKey = (project, path = '') => `${project}/catalog/${path ? path.replaceAll('/', '__') : '_index'}.md`

const fieldsAllowed = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => fields.includes(k))
const namedText = value => plain(value) && Boolean(value.trim())
const pathParent = path => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''

function validateMatch(match) {
  if (!fieldsAllowed(match, ['types', 'version', 'module'])) error('Invalid directory match')
  if (!Array.isArray(match.types) || !match.types.length || match.types.some(type => !Object.hasOwn(NODE_TYPES, type))) error('Invalid directory node types')
  for (const key of ['version', 'module']) if (match[key] !== undefined && !namedText(match[key])) error('Invalid directory match value')
}

function validPath(path) {
  if (typeof path !== 'string' || path.length > 600) return false
  const segments = path.split('/')
  return segments.length <= 12 && segments.every(segment => segmentPattern.test(segment) && !reserved.has(segment))
}

function validateEntry(entry, paths) {
  if (!fieldsAllowed(entry, ['path', 'title', 'description', 'match'])) error('Invalid directory fields')
  if (!validPath(entry.path) || paths.has(entry.path)) error('Invalid or duplicate directory path')
  if (!namedText(entry.title) || !plain(entry.description)) error('Directory title and description must be plain text')
  paths.add(entry.path)
  if (entry.match !== undefined) validateMatch(entry.match)
}

function validateConfig(config, project) {
  if (!fieldsAllowed(config, ['schema_version', 'project', 'name', 'version', 'revision', 'directories'])) error('Invalid directory configuration fields')
  if (config.schema_version !== '1.0' || config.project !== project) error('Invalid directory configuration identity')
  if (![config.name, config.version].every(namedText) || !Number.isSafeInteger(config.revision) || config.revision < 1) error('Invalid directory configuration metadata')
  if (!Array.isArray(config.directories) || !config.directories.length || config.directories.length > 500) error('Expected 1 to 500 directories')
  const paths = new Set()
  for (const entry of config.directories) validateEntry(entry, paths)
  for (const path of paths) if (pathParent(path) && !paths.has(pathParent(path))) error('Directory parent is missing')
  return config
}

export function readDirectory(project, { wikiRoot }) {
  const path = join(projectPath(project, wikiRoot), 'directory.json')
  return existsSync(path) ? validateConfig(readContractJson(path), project) : null
}

function page(config, entry) {
  const path = entry?.path || ''
  const title = entry?.title || config.name
  const children = config.directories.filter(d => (d.path.includes('/') ? d.path.slice(0, d.path.lastIndexOf('/')) : '') === path)
  const lines = [`---\ntitle: ${JSON.stringify(title)}\n---`, `# ${escape(title)}`, escape(entry?.description || `Product documentation: ${config.name} (${config.version})`)]
  if (children.length) lines.push('## Directories\n\n' + children.map(d => `- [${escape(d.title)}](/${directoryPageKey(config.project, d.path).replace(/\.md$/, '')})`).join('\n'))
  lines.push('Knowledge pages are linked under this directory in the sidebar after review and compilation.')
  if (path) {
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    lines.push(`[Parent directory](/${directoryPageKey(config.project, parent).replace(/\.md$/, '')})`)
  }
  return lines.join('\n\n') + '\n'
}

function generatedPages(config) {
  return new Map([null, ...config.directories].map(d => [directoryPageKey(config.project, d?.path), page(config, d)]))
}

function replaceConfig(path, content) {
  const temporary = path + '.' + randomUUID() + '.tmp'
  try {
    writeFileSync(temporary, content, { flag: 'wx' })
    renameSync(temporary, path)
  } finally {
    rmSync(temporary, { force: true })
  }
}

function saveDirectory(config, wikiRoot, contract) {
  const base = projectPath(config.project, wikiRoot)
  const stage = join(base, `.directory-${randomUUID()}`), backup = stage + '-backup'
  const configPath = join(base, 'directory.json'), catalog = join(base, 'catalog')
  const before = existsSync(configPath) ? readFileSync(configPath) : null
  mkdirSync(stage, { recursive: true })
  let moved = false, installed = false
  try {
    for (const [key, text] of generatedPages(config)) writeFileSync(join(stage, key.split('/').at(-1)), text)
    if (existsSync(catalog)) { renameSync(catalog, backup); moved = true }
    renameSync(stage, catalog); installed = true
    replaceConfig(configPath, encode(config))
    if (contract) writeFileSync(join(base, 'document-contract.json'), encode(contract), { flag: 'wx' })
  } catch (e) {
    if (installed) rmSync(catalog, { recursive: true, force: true })
    if (moved) renameSync(backup, catalog)
    if (before) replaceConfig(configPath, before)
    else rmSync(configPath, { force: true })
    throw e
  } finally {
    rmSync(stage, { recursive: true, force: true }); rmSync(backup, { recursive: true, force: true })
  }
  return config
}

const versionPath = version => version.toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-|-$/g, '')
function mapping(path, version, module) {
  let types
  if (module && path.endsWith('/features')) types = ['requirement', 'frd', 'design', 'test_case', 'api', 'data_dictionary', 'data_schema', 'business_rule', 'business_object', 'scenario', 'interaction', 'code_index', 'module']
  else if (path.endsWith('/application-help/common-functions')) types = ['user-manual', 'faq']
  else if (path.endsWith('/system-administration-guide')) types = ['admin-manual']
  else if (path.endsWith('/runbooks')) types = ['runbook', 'incident']
  else if (path.endsWith('/installation-guide')) types = ['deployment']
  else if (path.endsWith('/solutions-and-proposals')) types = ['solution']
  else if (path.endsWith('/release-notes')) types = ['release']
  else if (path.endsWith('/system-testing')) types = ['test_case']
  if (types) return { types, ...(path.startsWith('product-versions/') ? { version } : {}), ...(module ? { module } : {}) }
}

function initializationInput(input) {
  const contract = input.delivery_contract
  if (!contract || schemaErrors('documentSet', contract).length || contract.project !== input.project) error('A valid delivery contract matching the project is required')
  if (![input.name, input.version].every(namedText) || !segmentPattern.test(versionPath(input.version))) error('Invalid product name or version')
  const modules = input.modules || []
  if (!Array.isArray(modules) || modules.length > 30 || new Set(modules).size !== modules.length) error('Invalid module identifiers')
  if (modules.some(module => typeof module !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(module) || reserved.has(module))) error('Invalid module identifiers')
  return { contract, modules }
}

function standardDirectories(input, modules) {
  const template = readContractJson(join(CONTRACT_ROOT, 'product-directory-template.json'))
  return template.directories.flatMap(entry => {
    if (entry.path.includes('feature-template')) return []
    const candidates = entry.path.includes('module-template') ? modules : [null]
    return candidates.map(module => {
      const path = entry.path.replace('version-template', versionPath(input.version)).replace('module-template', module)
      const title = entry.title === 'Version Template' ? input.version : entry.title === 'Module Template' ? module : entry.title
      const match = mapping(path, input.version, module)
      return { ...entry, path, title, ...(match ? { match } : {}) }
    })
  })
}

export function initializeDirectory(input, { wikiRoot }) {
  const base = projectPath(input.project, wikiRoot)
  if (existsSync(join(base, 'directory.json')) || existsSync(join(base, 'catalog'))) error('Product directory is already initialized', 409)
  const { contract, modules } = initializationInput(input)
  const contractPath = join(base, 'document-contract.json')
  if (existsSync(contractPath) && encode(readContractJson(contractPath)) !== encode(contract)) error('Existing delivery contract differs; it will not be overwritten', 409)
  const config = validateConfig({ schema_version: '1.0', project: input.project, name: input.name, version: input.version, revision: 1, directories: standardDirectories(input, modules) }, input.project)
  return saveDirectory(config, wikiRoot, existsSync(contractPath) ? null : contract)
}

export function updateDirectory(input, { wikiRoot }) {
  const current = readDirectory(input.project, { wikiRoot })
  if (!current) error('Product directory is not initialized', 404)
  if (input.expected_revision !== current.revision) error('Directory revision conflict', 409)
  return saveDirectory(validateConfig({ ...current, revision: current.revision + 1, directories: input.directories }, input.project), wikiRoot)
}

function filesUnder(path, prefix = '') {
  if (!existsSync(path)) return []
  return readdirSync(path, { withFileTypes: true }).flatMap(e => {
    if (e.isSymbolicLink()) error('Symbolic links are not permitted')
    return e.isDirectory() ? filesUnder(join(path, e.name), prefix + e.name + '/') : [prefix + e.name]
  })
}

export function validateDirectories(wikiRoot) {
  const errors = []
  if (!existsSync(wikiRoot)) return errors
  for (const project of readdirSync(wikiRoot, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)) {
    if (!existsSync(join(wikiRoot, project, 'directory.json')) && !existsSync(join(wikiRoot, project, 'catalog'))) continue
    try {
      const config = readDirectory(project, { wikiRoot })
      const catalog = join(wikiRoot, project, 'catalog')
      if (!config && !existsSync(catalog)) continue
      const expected = config ? generatedPages(config) : new Map()
      for (const file of filesUnder(catalog)) {
        const key = `${project}/catalog/${file}`
        if (!expected.has(key)) errors.push({ code: 'directory_page_extra', path: key, message: 'Unregistered directory page' })
      }
      for (const [key, text] of expected) if (!existsSync(join(wikiRoot, key)) || readFileSync(join(wikiRoot, key), 'utf8') !== text)
        errors.push({ code: 'directory_page_drift', path: key, message: 'Directory page differs from its validated configuration' })
    } catch (e) { errors.push({ code: 'directory_config_error', path: project, message: e.message }) }
  }
  return errors
}

export function directorySidebar(project, wikiRoot) {
  const config = readDirectory(project, { wikiRoot })
  if (!config) return []
  const nodes = ['doc', 'code'].flatMap(plane => filesUnder(join(wikiRoot, project, plane)).filter(f => f.endsWith('.md')).map(file => {
    const key = `${project}/${plane}/${file}`
    const parsed = parsePage(readFileSync(join(wikiRoot, key), 'utf8'))
    return { fm: parsed.fm, title: parsed.fm.title || parsed.body.match(/^#\s+(.+)$/m)?.[1] || parsed.fm.id, key }
  }))
  const branch = parent => config.directories.filter(d => (d.path.includes('/') ? d.path.slice(0, d.path.lastIndexOf('/')) : '') === parent).map(d => {
    const matching = d.match ? nodes.filter(n => d.match.types.includes(n.fm.type) && ['version', 'module'].every(k => d.match[k] === undefined || n.fm[k] === d.match[k])) : []
    return { text: d.title, link: '/' + directoryPageKey(project, d.path).replace(/\.md$/, ''), collapsed: true,
      items: [...branch(d.path), ...matching.map(n => ({ text: n.title, link: '/' + n.key.replace(/\.md$/, '') }))] }
  })
  return [{ text: config.name, link: '/' + directoryPageKey(project).replace(/\.md$/, ''), items: branch(''), collapsed: false }]
}
