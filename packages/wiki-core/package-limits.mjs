export function documentLimits() {
  const limit = (name, fallback) => {
    const value = Number(process.env[name] || fallback)
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(name + ' must be a positive byte limit')
    return value
  }
  return { file: limit('CIM_WIKI_UPLOAD_MAX_BYTES', 25 * 1024 * 1024), package: limit('CIM_WIKI_PACKAGE_MAX_BYTES', 100 * 1024 * 1024) }
}
