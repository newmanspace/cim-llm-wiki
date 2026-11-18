import { schemaErrors } from './contracts.mjs'

// All delivery and directory views come from the same immutable Project binding.
export function projectDeliveryContract(project, effective) {
  const contract = {
    schema_version: '1.0', project, modules: effective.modules,
    documents: effective.definition.delivery,
  }
  const errors = schemaErrors('documentSet', contract)
  if (errors.length) throw Object.assign(new Error('Invalid Project delivery configuration: ' + errors.join('; ')), { status: 409 })
  return contract
}

export function projectDirectory(effective) {
  return { version: effective.version, digest: effective.digest, directories: effective.definition.directories }
}
