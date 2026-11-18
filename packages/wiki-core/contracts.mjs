import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { parseDocument } from 'yaml'

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const CONTRACT_ROOT = join(PROJECT_ROOT, 'contracts/wiki/v1')
export const SCHEMA_VERSION = '1.0'
const read = name => JSON.parse(readFileSync(join(CONTRACT_ROOT, name), 'utf8'))
const nodeTypes = read('node-types.json')
export const NODE_TYPES = nodeTypes.types
if (JSON.stringify([...nodeTypes.enum].sort()) !== JSON.stringify(Object.keys(NODE_TYPES).sort())) {
  throw new Error('Node type enumeration and routing definitions disagree')
}
const ajv = new Ajv({ allErrors: true, strict: false })
addFormats(ajv)
ajv.addSchema(nodeTypes)
ajv.addSchema(read('node.schema.json'), 'node')
ajv.addSchema(read('template.schema.json'), 'template')
const validators = {
  node: ajv.getSchema('node'),
  bundle: ajv.compile(read('bundle.schema.json')),
  template: ajv.getSchema('template'),
  documentSet: ajv.compile(read('document-set.schema.json')),
}

export const REFERENCE_TYPES = { applies_to: ['api'], preconditions: ['business_rule'], related_apis: ['api'],
  related_rules: ['business_rule'], related_designs: ['design'], related_requirements: ['requirement'],
  related_tests: ['test_case'], related_modules: ['module'], related_code: ['code_index'] }

export function readContractJson(path) {
  const text = readFileSync(path, 'utf8')
  const value = JSON.parse(text)
  const doc = parseDocument(text, { uniqueKeys: true })
  if (doc.errors.length) throw new Error(doc.errors.map(e => e.message).join('; '))
  return value
}

export function schemaErrors(kind, value) {
  const check = validators[kind]
  if (check(value)) return []
  return check.errors.map(e => `${e.instancePath || '/'} ${e.message}${e.params.additionalProperty ? ` (${e.params.additionalProperty})` : ''}`)
}

export const slugify = id => String(id).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')

export function nodeLocation(node) {
  const entry = NODE_TYPES[node.type]
  if (!entry) throw new Error(`Unknown node type: ${node.type}`)
  const variant = entry.variants?.[node.rule_type]
  if (variant) return [variant.plane, variant.dir]
  return [entry.plane, entry.dir]
}

export function loadTemplateContracts(wikiRoot) {
  const rejectLegacy = dir => {
    if (existsSync(join(dir,'manifest.json')))throw new Error('Legacy template manifests are not supported; use published global document template definitions')
  }
  rejectLegacy(join(wikiRoot,'templates'))
  return project=>{
    if(project)rejectLegacy(join(wikiRoot,project,'templates'))
    return NODE_TYPES
  }
}
