import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createDefaultsStore } from './document-defaults.mjs'
import { parsePage } from './markdown.mjs'

function filesUnder(path, prefix = '') {
  if (!existsSync(path)) return []
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => {
    if (entry.isSymbolicLink()) throw new Error('Symbolic links are not permitted')
    return entry.isDirectory() ? filesUnder(join(path, entry.name), prefix + entry.name + '/') : [prefix + entry.name]
  })
}

export function directorySidebar(project, wikiRoot, projectRoot) {
  const { definition } = createDefaultsStore(projectRoot).effective(project)
  const nodes = ['doc', 'code'].flatMap(plane => filesUnder(join(wikiRoot, project, plane)).filter(file => file.endsWith('.md')).map(file => {
    const key = `${project}/${plane}/${file}`
    const { fm, body } = parsePage(readFileSync(join(wikiRoot, key), 'utf8'))
    return { fm, title: fm.title || body.match(/^#\s+(.+)$/m)?.[1] || fm.id, key }
  }))
  const parent = path => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  const branch = path => definition.directories.filter(directory => parent(directory.path) === path).map(directory => ({
    text: directory.title, collapsed: true,
    items: [...branch(directory.path), ...nodes.filter(node => directory.node_types.includes(node.fm.type)).map(node => ({ text: node.title, link: '/' + node.key.replace(/\.md$/, '') }))],
  }))
  return branch('')
}
