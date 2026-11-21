// Service-only limits: deployment must explicitly supply byte capacities.
export function documentLimits() {
  const limit = name => {
    const value = Number(process.env[name])
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(name + ' must be a positive byte limit')
    return value
  }
  return { file: limit('CIM_WIKI_UPLOAD_MAX_BYTES'), package: limit('CIM_WIKI_PACKAGE_MAX_BYTES') }
}
