import { basename } from 'node:path'
import { join, relative } from 'node:path'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { parsePage } from './markdown.mjs'

export const namingFormat = 'project-type-module-topic-sequence-v1'
const code = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export function documentFilename({ short_code, doc_type, module, topic, sequence }) {
  if (![short_code, doc_type, module, topic].every(value => typeof value === 'string' && value.length <= 100 && code.test(value))) throw new Error('Canonical document naming codes required')
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 2147483647) throw new Error('Invalid document sequence')
  const filename = `${short_code}-${doc_type}-${module}-${topic}-${String(sequence).padStart(3, '0')}.md`
  if (filename.length > 255) throw new Error('Document filename exceeds 255 bytes')
  return filename
}

export function namingPolicyErrors(definition) {
  if (!definition.naming) return []
  const errors = [], seen = new Set(), templates = new Set(definition.templates.map(template => template.id)), assigned = new Set()
  for (const type of definition.naming.types) {
    if (seen.has(type.code)) errors.push('Duplicate naming type: ' + type.code)
    seen.add(type.code)
    for (const id of type.template_ids) {
      if (!templates.has(id) || assigned.has(id)) errors.push('Unknown or multiply assigned naming template: ' + id)
      assigned.add(id)
    }
  }
  return errors
}

export function identityErrors(identity, values, policy) {
  const errors = []
  const add = message => errors.push({ rule_id: 'document_identity_mismatch', severity: 'error', document_path: values.target_path, message })
  if (identity.filename !== documentFilename(identity)) add('Stored document filename is invalid')
  if (values.target_path && basename(values.target_path) !== identity.filename) add('Filename must match the reserved document identity')
  if (values.node_id && values.node_id !== identity.node_id) add('Node ID must match the reserved document identity')
  for (const field of ['module', 'topic', 'doc_type']) if (values[field] !== undefined && values[field] !== identity[field]) add('Document ' + field + ' differs from the reserved identity')
  if (values.template_id && !policy.types.find(type => type.code === identity.doc_type)?.template_ids.includes(values.template_id)) add('Template does not match the document type')
  if (values.document !== undefined) {
    const match = values.document.match(/^\|[ \t]*文档 ID[ \t]*\|[ \t]*([^|\r\n]+)\|/m)
    if (!match || match[1].trim() !== identity.node_id) add('Document information ID must match the reserved identity')
  }
  return errors
}

export function validateNamedTree(root, manifest) {
  if (!manifest) return
  const byName = new Map(manifest.identities.map(identity => [identity.filename, identity]))
  function walk(path) {
    if (!existsSync(path)) return
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const file = join(path, entry.name), rel = relative(root, file)
      if (entry.isDirectory()) { if (rel !== 'doc/99-templates') walk(file); continue }
      if (entry.isSymbolicLink()) throw new Error('Symbolic naming inputs are not permitted')
      if (!entry.name.toLowerCase().endsWith('.md') || entry.name.toLowerCase() === 'readme.md') continue
      const identity = byName.get(entry.name)
      if (!identity || identity.policy_digest !== manifest.policy.digest) throw new Error('DOCUMENT_IDENTITY_REQUIRED: ' + rel)
      const values = namedPageValues(readFileSync(file, 'utf8'), rel, identity)
      const errors = identityErrors(identity, values, manifest.policy)
      if (errors.length) throw new Error(JSON.stringify(errors))
    }
  }
  for (const plane of ['doc', 'code']) walk(join(root, plane))
}

function namedPageValues(document, target_path, identity) {
  if (!/^\uFEFF?---\r?\n/.test(document)) return { document, target_path }
  const { fm } = parsePage(document)
  if ((fm.type && fm.plane || fm.document_id) && fm.document_id !== identity.id) throw new Error('DOCUMENT_IDENTITY_MISMATCH: ' + target_path)
  return { document, target_path, node_id: fm.id, module: fm.module, template_id: fm.template_id }
}
