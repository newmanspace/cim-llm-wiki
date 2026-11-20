import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import MarkdownIt from 'markdown-it'

const markdown = new MarkdownIt({ html: true })
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
export function packagePath(value) {
  if (typeof value !== 'string' || !value || value !== value.normalize('NFC') || (/[\\?#%:]/.test(value) || [...value].some(char => char.charCodeAt(0) < 32)) || value.startsWith('/')) throw new Error('Invalid package path')
  if (Buffer.byteLength(value) > 1024 || value.split('/').some(part => Buffer.byteLength(part) > 255)) throw new Error('Package path exceeds portable filesystem limits')
  if (value.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Package path must be normalized within its root')
  return value
}
export function resourcePath(entry, href) {
  if (href.startsWith('#') || /^(https?:|mailto:|data:)/i.test(href)) return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('/') || href.startsWith('\\')) throw new Error('Absolute or unsafe document resource')
  const name = decodeURIComponent(href.split('#')[0].split('?')[0])
  return packagePath(posix.normalize(posix.join(posix.dirname(entry), name)))
}
function checkHTMLResource(token) {
  if (!['html_block', 'html_inline'].includes(token.type)) return
  if (token.content.trim().startsWith('<!--')) return
  if (/<[a-z][^>]*\b(?:src|href|srcset|style|poster|data)\s*=/i.test(token.content)) throw new Error('HTML resource references require explicit conversion to Markdown before packaging')
}
export function documentResources(text, entry) {
  const resources = [], warnings = []
  for (const token of markdown.parse(text, {})) {
    checkHTMLResource(token)
    for (const child of token.children || []) {
      checkHTMLResource(child)
      const href = child.type === 'image' ? child.attrGet('src') : child.type === 'link_open' ? child.attrGet('href') : null
      if (!href) continue
      if (child.type === 'image' && /^https?:/i.test(href)) warnings.push({ rule_id: 'remote_image_unarchived', severity: 'warning', message: href })
      const path = resourcePath(entry, href)
      if (path) resources.push({ path, href, image: child.type === 'image' })
    }
  }
  return { resources, warnings }
}
export function packageManifest(entry, files) {
  packagePath(entry)
  if (!Array.isArray(files) || !files.length || files.length > 200) throw new Error('Package requires 1–200 files')
  const seen = new Set()
  const normalized = files.map(file => {
    const path = packagePath(file.path), key = path.toLowerCase()
    if (seen.has(key)) throw new Error('Duplicate or case-conflicting package path')
    seen.add(key)
    if (!/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 0 || typeof file.media_type !== 'string') throw new Error('Invalid package file metadata')
    return { path, sha256: file.sha256, size: file.size, media_type: file.media_type }
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  if (!normalized.some(file => file.path === entry) || !entry.endsWith('.md')) throw new Error('Package entry must be a Markdown file')
  return { schema_version: '1.0', entry, files: normalized }
}
export function packageDigest(manifest) { return sha256(JSON.stringify(packageManifest(manifest.entry, manifest.files))) }
