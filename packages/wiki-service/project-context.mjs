import { existsSync } from 'node:fs'
import { NODE_TYPES, CONTRACT_ROOT, readContractJson } from '../wiki-core/contracts.mjs'
import { definitionSchema, templateVariables } from '../wiki-core/document-defaults.mjs'
import { join } from 'node:path'

import { projectDeliveryContract, projectDirectory } from '../wiki-core/project-document-config.mjs'

const operations = ['check_document', 'submit', 'compile', 'publish_document']
const fail = (message, status) => { throw Object.assign(new Error(message), { status }) }

export function templateContext(effective) {
  const contracts = {}, templates = {}
  for (const entry of effective.definition.templates) {
    if (templates[entry.node_type]) continue
    templates[entry.node_type] = entry.body
    contracts[entry.node_type] = {
      ...NODE_TYPES[entry.node_type],
      requiredSections: [...new Set([...(NODE_TYPES[entry.node_type].requiredSections || []), ...entry.contract.sections.map(s => '## ' + s)])],
      tables: [...(NODE_TYPES[entry.node_type].tables || []), ...entry.contract.tables.map(t => ({ section: '## ' + t.section, columns: t.columns }))],
    }
  }
  return { document_defaults: effective, template_contracts: contracts, templates }
}

function configurationCapabilities(status, sources, ledgerEnabled) {
  const strictReady = status.document_defaults === 'ready' && status.delivery_contract === 'ready' && status.directory === 'ready'
  const ledgerReady = !ledgerEnabled || status.data_sources === 'ready'
  return {
    check_document: false,
    collect: status.project === 'ready' && status.data_sources === 'ready' && sources.some(source => source.enabled),
    submit: strictReady && ledgerReady, compile: strictReady && ledgerReady,
    publish_document: strictReady && status.document_directories === 'ready' && status.data_sources === 'ready',
  }
}

// Discovery records expected configuration failures; it never authorizes mutations.
export function createProjectContext({ defaults, quality, naming, projectWikis, wikiPath }) {
  async function projectInfo(project) {
    if (quality.enabled) {
      const info = await quality.call(project, 'project')
      if (info?.id !== project) fail('Invalid project registry response', 503)
      return info
    }
    const known = projectWikis?.list().includes(project) || existsSync(wikiPath(project)) || defaults.store.binding(project)
    if (!known) fail('Project not found', 404)
    return { id: project }
  }

  async function discover(project) {
    const info = await projectInfo(project)
    const kind = projectWikis?.kind(project) || 'strict_nodes'
    const configuration_status = { project: quality.enabled ? 'ready' : 'disabled' }
    const diagnostics = []
    const result = {
      schema_version: '1.0', project, project_info: info, content_kind: kind,
      repos: info.repos ?? null, modules: info.modules ?? null,
      configuration_status, diagnostics,
      template_binding: null, document_defaults: null, templates: null, template_contracts: null,
      delivery_contract: null, directory: null,
      data_sources: null, document_directories: null,
      document_quality: { enabled: quality.enabled },
    }
    const diagnostic = (component, state, code, message, affected_operations) => {
      configuration_status[component] = state
      diagnostics.push({ component, code, message, affected_operations })
    }
    async function read(component, fn, code, affected, missingAffected = affected) {
      try {
        const value = await fn()
        configuration_status[component] = value === null ? 'missing' : 'ready'
        if (value === null) diagnostic(component, 'missing', code + '_MISSING', 'Project configuration is not set', missingAffected)
        return value
      } catch (error) {
        // Configuration errors are useful diagnostics; unexpected IO failures are not empty configuration.
        const state = [400, 409, 422].includes(error.status) || error instanceof SyntaxError ? 'invalid' : 'unavailable'
        diagnostic(component, state, code + '_' + state.toUpperCase(), state === 'unavailable' ? 'Configuration could not be read' : 'Project configuration is invalid', affected)
        return null
      }
    }
    if (!quality.enabled) diagnostic('project', 'disabled', 'PROJECT_REGISTRY_DISABLED', 'Project registry is not configured; basic project metadata is unavailable', [])
    await readStrictConfiguration(result, read, diagnostic)
    await readLedgerConfiguration(result, read, diagnostic)
    await readNamingConfiguration(result, read, diagnostic)
    const definition = result.document_defaults?.definition
    if (definition && info.modules && JSON.stringify([...info.modules].sort()) !== JSON.stringify([...result.document_defaults.modules].sort())) {
      diagnostic('modules', 'invalid', 'MODULE_INVENTORY_MISMATCH', 'Project modules differ from bound document modules', [])
    }
    result.capabilities = configurationCapabilities(configuration_status, result.data_sources, quality.enabled)
    result.capabilities.reserve_document_name = result.document_naming?.ready === true
    Object.assign(result, {
      document_defaults_schema: definitionSchema, template_variables: templateVariables,
      node_types: NODE_TYPES, node_schema: readContractJson(join(CONTRACT_ROOT, 'node.schema.json')),
      vocabulary: readContractJson(join(CONTRACT_ROOT, 'vocabulary.json')),
    })
    return result
  }
  async function readNamingConfiguration(result, read, diagnostic) {
    const project=result.project, info=result.project_info
    if (naming) {
      result.document_naming = await read('document_naming', () => naming.describe(project, info), 'DOCUMENT_NAMING', ['reserve_document_name'])
      if (result.document_naming && !result.document_naming.ready) diagnostic('document_naming', 'missing', result.document_naming.code || 'PROJECT_NAMING_INCOMPLETE', 'Project naming policy, short code and real modules must be configured', ['reserve_document_name'])
    }
  }
  async function readStrictConfiguration(result, read, diagnostic) {
    const { project } = result
    if (result.content_kind === 'repository_docs') {
      for (const component of ['document_defaults', 'delivery_contract', 'directory']) {
        diagnostic(component, 'not_applicable', 'STRICT_NODES_NOT_APPLICABLE', 'Repository documentation uses Git builds', operations)
      }
    } else {
      const binding = await read('document_defaults', () => defaults.store.binding(project), 'DOCUMENT_DEFAULTS', operations)
      result.template_binding = binding
      if (binding) {
        result.document_defaults = await read('document_defaults', () => defaults.store.effective(project), 'DOCUMENT_DEFAULTS', operations)
        if (result.document_defaults) Object.assign(result, templateContext(result.document_defaults))
      }
      if (result.document_defaults) {
        result.delivery_contract = await read('delivery_contract', () => projectDeliveryContract(project, result.document_defaults), 'DELIVERY_CONTRACT', operations)
        result.directory = projectDirectory(result.document_defaults)
        result.configuration_status.directory = 'ready'
      } else {
        for (const component of ['delivery_contract', 'directory']) {
          diagnostic(component, result.configuration_status.document_defaults, 'DOCUMENT_DEFAULTS_REQUIRED', 'Project configuration requires a valid published document binding', operations)
        }
      }
    }
  }
  async function readLedgerConfiguration(result, read, diagnostic) {
    const { project } = result
    const definition = result.document_defaults?.definition
    if (quality.enabled) {
      const [sources, directories] = await Promise.all([
        read('data_sources', () => quality.sources(project), 'DATA_SOURCES', ['collect', 'submit', 'compile', 'publish_document']),
        read('document_directories', () => quality.directories(project, definition), 'DOCUMENT_DIRECTORIES', ['publish_document']),
      ])
      result.data_sources = sources
      result.document_directories = directories
      // Preserve the quality workflow metadata without re-reading configuration or imposing template gates.
      result.document_quality = quality.info()
    } else {
      for (const component of ['data_sources', 'document_directories']) diagnostic(component, 'disabled', 'DOCUMENT_LEDGER_DISABLED', 'Document ledger is not configured', ['collect', 'publish_document'])
    }
  }
  return { discover, projectInfo }
}
