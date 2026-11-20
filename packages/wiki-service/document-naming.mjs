import { hashValue } from '../wiki-core/sources.mjs'
import { identityErrors } from '../wiki-core/document-naming.mjs'

function fail(code, message, status = 409) { throw Object.assign(new Error(message), { status, code }) }

export function createDocumentNaming({ defaults, quality }) {
  function policy(project) {
    if (!defaults.store.binding(project)) return null
    const binding = defaults.store.effective(project)
    return binding.definition.naming ? { ...binding.definition.naming, version: binding.version, digest: hashValue(binding.definition.naming) } : null
  }
  async function describe(project, info) {
    const definition = policy(project)
    if (!definition) return { enabled: false, code: 'NAMING_POLICY_UNBOUND' }
    if (!quality.enabled) fail('DOCUMENT_LEDGER_DISABLED', 'Document naming requires the project ledger', 503)
    const [settings, projectInfo] = await Promise.all([quality.all(project, 'naming-settings'), info || quality.call(project, 'project')])
    return { ...definition, enabled: true, ready: Boolean(settings[0]?.short_code && projectInfo.modules?.length), short_code: settings[0]?.short_code || null, settings_revision: settings[0]?.revision || 0, modules: projectInfo.modules }
  }
  async function reserve(data, key) {
    if (Object.keys(data).some(key => !['project', 'doc_type', 'module', 'topic'].includes(key))) fail('DOCUMENT_NAMING_FIELD_UNKNOWN', 'Only project, doc_type, module and topic are accepted', 422)
    const config = await describe(data.project)
    if (!config.enabled) fail('NAMING_POLICY_UNBOUND', 'Project must explicitly bind a published naming policy')
    if (!config.ready) fail('PROJECT_NAMING_INCOMPLETE', 'Configure the project short code and real modules before reserving a name')
    if (!config.types.some(type => type.code === data.doc_type)) fail('DOCUMENT_TYPE_UNKNOWN', 'Unknown document type', 422)
    const identity = await quality.call(data.project, 'reserve-document-identity', { body: { ...data, short_code: config.short_code, settings_revision: config.settings_revision, policy_digest: config.digest }, key })
    return { ...identity, document_id: identity.id }
  }
  async function check(project, documentId, values) {
    const definition = policy(project)
    if (!definition && !documentId) return { errors: [], identity: null, digest: null }
    if (!definition) fail('NAMING_POLICY_UNBOUND', 'Document naming policy is not bound')
    if (!documentId) fail('DOCUMENT_IDENTITY_REQUIRED', 'Reserve a document identity before registering or publishing', 422)
    const identity = await quality.find(project, 'document-identities', documentId)
    if (identity.policy_digest !== definition.digest || values.naming_digest && values.naming_digest !== definition.digest) fail('NAMING_POLICY_CHANGED', 'Document naming policy changed; explicit migration is required')
    return { identity, digest: definition.digest, errors: identityErrors(identity, values, definition) }
  }
  async function requireIdentity(project, id, values) {
    const result = await check(project, id, values)
    if (result.errors.length) fail('DOCUMENT_IDENTITY_MISMATCH', JSON.stringify(result.errors), 422)
    return result
  }
  return { policy, describe, reserve, check, requireIdentity }
}
