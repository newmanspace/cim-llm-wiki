import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function outputPath(path) {
  if (!path) return null
  if (path === '-') throw new Error('--output requires a file path; omit it to print the full response')
  const target = resolve(path)
  if (existsSync(target)) throw new Error('Output file already exists: ' + target)
  return target
}

export function contextSummary(value) {
  return {
    project: value.project, content_kind: value.content_kind,
    configuration_status: value.configuration_status, capabilities: value.capabilities,
    diagnostics: value.diagnostics, template_binding: value.template_binding,
    modules: value.modules,
    templates: value.document_defaults?.definition.templates.map(({ id, node_type, name }) => ({ id, node_type, name })) || [],
    document_naming: value.document_naming && {
      enabled: value.document_naming.enabled, ready: value.document_naming.ready,
      short_code: value.document_naming.short_code,
    },
  }
}

export function writeResponse(path, value) {
  if (path) writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
}

export function responseError(status, value) {
  const diagnostics = (value.diagnostics || []).map(diagnostic => `${diagnostic.path}: ${diagnostic.message}`)
  return `HTTP ${status}: ${value.error || 'Request failed'}` +
    (value.request_id ? ` [request_id=${value.request_id}]` : '') +
    (value.code ? ` [${value.code}]` : '') +
    (diagnostics.length ? '\n' + diagnostics.join('\n') : '') +
    (value.existing ? '\n' + JSON.stringify({ existing: value.existing }) : '')
}
