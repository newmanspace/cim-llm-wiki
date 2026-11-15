// Routing belongs to the Project's bound definition, not to display directories.
export function validateDocumentTargetPath(path) {
  const parts = typeof path === 'string' ? path.split('/') : []
  if (typeof path !== 'string' || path.length > 600 || parts.length < 3 || parts.length > 16 ||
      !['doc', 'code'].includes(parts[0]) || !path.endsWith('.md') ||
      parts.at(-1).toLowerCase() === 'readme.md' ||
      parts.some((p) => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(p) || p === '.' || p === '..'))
    throw Object.assign(new Error('Invalid classified Markdown path'), { status: 422 })
  return path
}

export function documentDirectoryRule(definition, path) {
  return definition.directories
    .filter((d) => d.node_types.length && (path === d.path || path.startsWith(d.path + '/')))
    .sort((a, b) => b.path.split('/').length - a.path.split('/').length)[0] || null
}

export function documentTargetErrors(definition, templateId, targetPath) {
  const diagnostic = (rule_id, message, details = {}) => [{
    rule_id, severity: 'error', document_path: targetPath, template_id: templateId, message, ...details,
  }]
  try { validateDocumentTargetPath(targetPath) } catch (error) {
    return diagnostic('document_target_invalid', error.message)
  }
  const template = definition.templates.find((t) => t.id === templateId)
  if (!template) return diagnostic('document_template_unknown', 'Unknown template_id')
  const rule = documentDirectoryRule(definition, targetPath)
  if (rule?.node_types.includes(template.node_type)) return []
  return diagnostic(rule ? 'document_directory_mismatch' : 'document_directory_unmapped',
    'Target directory does not allow the selected template node_type', {
      node_type: template.node_type,
      matched_directory: rule?.path || null,
      allowed_directories: definition.directories.filter((d) => d.node_types.includes(template.node_type)).map((d) => d.path),
    })
}
