import { NODE_TYPES } from '../wiki-core/contracts.mjs'
import { definitionSchema, templateVariables } from '../wiki-core/document-defaults.mjs'

function failure(code, message, status) {
  throw Object.assign(new Error(message), { code, status })
}

// Authoring templates are independent of the project's Wiki publication mode.
export function createProjectQueries({ discovery, defaults, quality, projectWikis }) {
  async function info(project) {
    try {
      return await discovery.projectInfo(project)
    } catch (error) {
      if (error.status === 403) failure('PROJECT_FORBIDDEN', 'Project access denied', 403)
      if (error.status === 404) failure('PROJECT_NOT_FOUND', 'Project not found', 404)
      failure('PROJECT_UNAVAILABLE', 'Project information could not be read', 503)
    }
  }
  async function project(project) {
    const projectInfo = await info(project)
    const sources = await dataSources(project)
    return {
      schema_version: '1.0', project, content_kind: projectWikis?.kind(project) || 'strict_nodes',
      project_info: projectInfo, repos: projectInfo.repos ?? null, modules: projectInfo.modules ?? null,
      data_sources: sources,
    }
  }
  async function dataSources(project) {
    if (!quality.enabled) return null
    try {
      return await quality.sources(project)
    } catch {
      failure('PROJECT_SOURCES_UNAVAILABLE', 'Project document sources could not be read', 503)
    }
  }
  function effective(project) {
    try {
      if (!defaults.store.binding(project)) failure('TEMPLATE_SOURCE_UNBOUND', 'Project has no document template reference', 409)
      return defaults.store.effective(project)
    } catch (error) {
      if (error.code === 'TEMPLATE_SOURCE_UNBOUND') throw error
      if (error.status || error instanceof SyntaxError) failure('TEMPLATE_SOURCE_INVALID', 'Project document template reference is invalid', 422)
      failure('TEMPLATE_SOURCE_UNAVAILABLE', 'Project document templates could not be read', 503)
    }
  }
  async function templates(project, templateID) {
    await info(project)
    const current = effective(project)
    const selected = templateID ? current.definition.templates.filter(t => t.id === templateID) : current.definition.templates
    if (!selected.length) failure('TEMPLATE_NOT_FOUND', 'Template not found in the project reference', 404)
    return {
      schema_version: '1.0', project, binding: { version: current.version, digest: current.digest, at: current.at },
      templates: selected, terms: current.definition.terms, directories: current.definition.directories,
      template_variables: templateVariables, document_defaults_schema: definitionSchema,
      naming: current.definition.naming ?? null, node_contracts: NODE_TYPES,
    }
  }
  async function bindTemplates(data, actor) {
    if (Object.keys(data).some(k => !['project', 'version', 'expected_digest', 'overrides'].includes(k)) || typeof data.version !== 'string' || !data.version.trim()) {
      failure('TEMPLATE_REFERENCE_INVALID', 'Explicit template version and supported reference fields are required', 422)
    }
    const projectInfo = await info(data.project)
    if (!Array.isArray(projectInfo.modules)) failure('PROJECT_UNAVAILABLE', 'Project module inventory could not be read', 503)
    const current = defaults.store.binding(data.project)
    if (data.expected_digest !== (current?.digest || null)) failure('TEMPLATE_REFERENCE_CONFLICT', 'Project template reference changed; read it again', 409)
    return defaults.store.bind(data.project, projectInfo.modules, data.overrides ?? current?.overrides ?? {}, data.version, true, true, actor)
  }
  return { project, templates, bindTemplates }
}
