import { mkdirSync, lstatSync, realpathSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
export const extensions = /\.(pdf|docx?|xlsx?|pptx?|md|txt|html?)$/i
export function validateBinding(project, mount) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(project))
    throw new Error('Invalid project binding')
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(mount))
    throw new Error('Invalid shared mount')
}
export const sharedURI = (root, mount, path) =>
  'shared://' + mount + '/' + relative(root, path).split(sep).join('/')
export function safeRepositoryFile(name) {
  return (
    Boolean(name) &&
    !name
      .split('/')
      .some(
        (p) =>
          !p ||
          p === '..' ||
          p === '.' ||
          p.includes('\\') ||
          p.includes('@') ||
          /[%?#]/.test(p) ||
          p.includes(String.fromCharCode(0)),
      )
  )
}
export function destinationRoot(sharedRoot, project, kind = 'svn') {
  const root = realpathSync(sharedRoot),
    local = join(root, project, kind, randomUUID())
  let parent = root
  for (const segment of [project, kind]) {
    parent = join(parent, segment)
    try {
      if (lstatSync(parent).isSymbolicLink())
        throw new Error('Shared path cannot contain symlinks')
    } catch (e) {
      if (e.code !== 'ENOENT') throw e
    }
  }
  mkdirSync(local, { recursive: true, mode: 0o700 })
  return { root, local }
}

export function commandFailure(error, tool, hint) {
  const cause = new Error(error.code || `${tool.toUpperCase()}_FAILED`)
  return Object.assign(
    new Error(
      error.code === 'ENOENT'
        ? `${tool} CLI is required`
        : `${tool} request failed; ${hint}`,
    ),
    { code: `${tool.toUpperCase()}_FAILED`, cause },
  )
}
