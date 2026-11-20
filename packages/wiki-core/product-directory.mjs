import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createDefaultsStore } from './document-defaults.mjs'
import { parseBuildPage } from './build-validation.mjs'

function filesUnder(path, prefix = '') {
  if (!existsSync(path)) return []
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => {
    if (entry.isSymbolicLink()) throw new Error('Symbolic links are not permitted')
    return entry.isDirectory() ? filesUnder(join(path, entry.name), prefix + entry.name + '/') : [prefix + entry.name]
  })
}

export function directorySidebar(project, wikiRoot, projectRoot) {
  const defaults = createDefaultsStore(projectRoot)
  const nodes = ['doc', 'code'].flatMap(plane => filesUnder(join(wikiRoot, project, plane)).filter(file => file.endsWith('.md')).map(file => {
    const key = `${project}/${plane}/${file}`
    const { fm, body } = parseBuildPage(readFileSync(join(wikiRoot, key), 'utf8'))
    return { fm, title: fm.title || body.match(/^#\s+([^\r\n]+)/m)?.[1]?.trim() || fm.id || file, key }
  }))
  if (!defaults.binding(project)) return ['doc', 'code'].map(plane => ({
    text: plane, items: nodes.filter(node => node.key.startsWith(`${project}/${plane}/`)).map(node => ({ text: node.title, link: '/' + node.key.replace(/\.md$/, '') })),
  })).filter(group => group.items.length)
  const { definition } = defaults.effective(project)
  const directoryFor = node => {
    const path = node.key.slice(project.length + 1)
    const physical = definition.directories.filter(d => path.startsWith(d.path + '/')).sort((a, b) => b.path.length - a.path.length)
    return (physical.find(d => d.path.includes('/')) || definition.directories.find(d => d.node_types.includes(node.fm.type)) || physical[0])?.path
  }
  const parent = path => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  const branch = path => definition.directories.filter(directory => parent(directory.path) === path).map(directory => ({
    text: directory.title, collapsed: true,
    items: [...branch(directory.path), ...nodes.filter(node => directoryFor(node) === directory.path).map(node => ({ text: node.title, link: '/' + node.key.replace(/\.md$/, '') }))],
  }))
  return branch('')
}
