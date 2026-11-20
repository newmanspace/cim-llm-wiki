import { documentLimits } from './package-limits.mjs'
import { lstatSync, realpathSync } from 'node:fs'
import { readRegularFile } from './safe-files.mjs'
import { resolve, relative, sep, join } from 'node:path'
import {
  documentResources,
  packageManifest,
  packageDigest,
  packagePath,
  sha256,
} from './document-package.mjs'
import { mediaType } from './file-media.mjs'

export function collectLocalPackage(root, entry) {
  packagePath(entry)
  const limits = documentLimits()
  const base = realpathSync(root),
    pending = [entry],
    seen = new Set(),
    files = [],
    warnings = [],
    images = []
  while (pending.length) {
    const path = pending.shift()
    if (seen.has(path)) continue
    seen.add(path)
    if (seen.size > 200) throw new Error('Package exceeds 200 files')
    let ancestor = base
    for (const part of path.split('/')) {
      ancestor = join(ancestor, part)
      if (lstatSync(ancestor).isSymbolicLink())
        throw new Error('Symbolic links are not allowed in document packages')
    }
    const local = resolve(base, path),
      rel = relative(base, realpathSync(local))
    if (rel === '..' || rel.startsWith('..' + sep) || !lstatSync(local).isFile())
      throw new Error('Resource escaped package root or is not a file')
    const bytes = readRegularFile(local)
    if (bytes.length > limits.file) throw new Error('Package file exceeds configured upload limit')
    files.push({
      path,
      sha256: sha256(bytes),
      size: bytes.length,
      media_type: mediaType(path, bytes.subarray(0, 512)),
    })
    if (path.endsWith('.md')) {
      if (bytes.length > 4 * 1024 * 1024) throw new Error('Markdown exceeds 4 MiB')
      const dependencies = documentResources(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes),
        path,
      )
      warnings.push(...dependencies.warnings)
      images.push(
        ...dependencies.resources
          .filter((resource) => resource.image)
          .map((resource) => resource.path),
      )
      pending.push(...dependencies.resources.map((resource) => resource.path))
    }
  }
  if (files.reduce((size, file) => size + file.size, 0) > limits.package)
    throw new Error('Package exceeds configured byte limit')
  if (
    images.some(
      (path) =>
        !files.some(
          (file) =>
            file.path === path &&
            ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.media_type),
        ),
    )
  )
    throw new Error(
      'Inline images require PNG/JPEG/GIF/WebP; preserve other formats as downloadable attachments',
    )
  const manifest = packageManifest(entry, files)
  return { ...manifest, package_sha256: packageDigest(manifest), warnings }
}
