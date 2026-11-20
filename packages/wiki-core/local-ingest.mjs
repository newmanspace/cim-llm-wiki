import { identityErrors } from './document-naming.mjs'
import { createHash } from 'node:crypto'
import { checkDocument } from './document-check.mjs'
import { documentTargetErrors, validateDocumentTargetPath } from './document-routing.mjs'
import { DOCUMENT_FIELDS, FORMAT_TABLES, DOCUMENT_FORMAT } from './document-format.mjs'

// Semantic extraction and fidelity checks belong to the calling Agent.
export function checkCandidate({ project, templates, binding, terms, directories, naming, node_contracts }, input) {
  if (project !== input.project || !binding?.digest || !Array.isArray(terms))
    throw new Error('Complete rules from the target project are required')
  const template = input.template_id
    ? templates.find(t => t.id === input.template_id)
    : { id: null, contract: { format: DOCUMENT_FORMAT, sections: ['文档信息', '参考文档', '修订记录'], fields: DOCUMENT_FIELDS, tables: FORMAT_TABLES } }
  if (!template) throw new Error('Template not found in the project reference')
  const diagnostics = checkDocument(template, input.document, { terms, documentPath: input.target_path, root: input.root, nodeTypes: node_contracts ?? {} })
  if (input.template_id)
    diagnostics.push(...documentTargetErrors({ templates, directories }, input.template_id, input.target_path))
  if (!input.template_id) {
    try { validateDocumentTargetPath(input.target_path) }
    catch (error) { diagnostics.push({ rule_id: 'document_target_invalid', severity: 'error', message: error.message }) }
  }
  diagnostics.push(...checkIdentity(input, naming))
  const warnings = diagnostics.filter(d => d.severity === 'warning')
  if (!input.document_id) warnings.push({ rule_id: 'document_identity_pending', severity: 'warning', message: 'Reserve or reuse the formal identity at submission' })
  return {
    schema_version: '1.0', project, template_id: template.id,
    document_contract_digest: binding.digest,
    target_path: input.target_path, document_id: input.document_id ?? null,
    content_sha256: createHash('sha256').update(input.document).digest('hex'),
    errors: diagnostics.filter(d => d.severity !== 'warning'), warnings,
    fidelity: input.fidelity ?? 'not_checked',
    checked_at: new Date().toISOString(),
  }
}

function checkIdentity(input, naming) {
  if (!input.document_id || !naming) return []
  if (!input.identity || input.identity.id !== input.document_id)
    return [{ rule_id: 'document_identity_mismatch', severity: 'error', message: 'Provide the reserved identity matching document_id for local checks' }]
  return identityErrors(input.identity, input, naming)
}

export { collectLocalPackage } from './local-package.mjs'
export { packagePath, resourcePath, packageDigest } from './document-package.mjs'

export { documentLimits } from './package-limits.mjs'
