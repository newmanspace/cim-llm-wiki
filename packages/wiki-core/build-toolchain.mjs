import { constants, closeSync, fstatSync, openSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

export function toolchainIdentity(root) {
  const hash = createHash('sha256')
  function walk(path, key) {
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const stat = fstatSync(fd)
      if (stat.isDirectory()) {
        // Keep each parent directory pinned while opening children (Linux runtime).
        const directory = `/proc/self/fd/${fd}`
        for (const name of readdirSync(directory).sort()) if (!['test', 'node_modules', 'cache', 'dist', 'sidebar-data.mjs'].includes(name)) walk(join(directory, name), key + '/' + name)
      } else {
        if (!stat.isFile()) throw new Error('Toolchain source must be a regular file')
        hash.update(key); hash.update(readFileSync(fd))
      }
    } finally { closeSync(fd) }
  }
  for (const key of ['package-lock.json', 'contracts', 'packages/wiki-core', 'packages/wiki-worker', 'wiki/package-lock.json', 'wiki/.vitepress/config.mjs', 'wiki/.vitepress/mermaid-markdown.mjs', 'wiki/.vitepress/theme', 'wiki/scripts']) walk(join(root, key), key)
  return hash.digest('hex')
}
