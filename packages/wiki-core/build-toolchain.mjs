import { readFileSync, readdirSync, lstatSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

export function toolchainIdentity(root) {
  const hash = createHash('sha256')
  function walk(path, key) {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) throw new Error('Toolchain source must not contain symlinks')
    if (stat.isDirectory()) {
      for (const name of readdirSync(path).sort()) if (!['test', 'node_modules', 'cache', 'dist', 'sidebar-data.mjs'].includes(name)) walk(join(path, name), key + '/' + name)
    } else { hash.update(key); hash.update(readFileSync(path)) }
  }
  for (const key of ['package-lock.json', 'contracts', 'packages/wiki-core', 'packages/wiki-worker', 'wiki/package-lock.json', 'wiki/.vitepress/config.mjs', 'wiki/.vitepress/mermaid-markdown.mjs', 'wiki/.vitepress/theme', 'wiki/scripts']) walk(join(root, key), key)
  return hash.digest('hex')
}
