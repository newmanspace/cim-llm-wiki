import { assertNoFileIncludes } from './markdown.mjs'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { dirname, extname, join, posix, relative } from 'node:path'

export const repositoryKind = 'repository_docs'
const supported = new Set(['.md', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.pdf'])
function git(root, args, options = {}) {
  return execFileSync('/usr/bin/git', ['-c', 'safe.directory=' + root, '-C', root, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  })
}
export function repositoryCommit(root) {
  if (
    !lstatSync(join(root, '.git'), { throwIfNoEntry: false })?.isDirectory() ||
    realpathSync(git(root, ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()) !==
      realpathSync(root)
  )
    throw new Error('Documentation requires an independent Git checkout')
  return git(root, ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
}
// Export supported files from the specified commit, preserving local uncommitted
// edits by never reading their working-tree bytes. Reject symlinks and submodules
// before the export can become a build input.
export function exportCommittedDocs(root, commit, destination) {
  mkdirSync(destination, { recursive: true })
  const records = git(root, ['ls-tree', '-rz', commit], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
  for (const record of records) {
    const [metadata, path] = record.split('\t'),
      [mode] = metadata.split(' ')
    if (!path || path.split('/').some((part) => ['..', '.git', '.vitepress'].includes(part)))
      throw new Error('Unsafe repository documentation path')
    if (mode !== '100644' && mode !== '100755')
      throw new Error('Symlinks and submodules are not allowed in documentation snapshots')
    if (!supported.has(extname(path).toLowerCase())) continue
    const file = join(destination, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, git(root, ['show', commit + ':' + path]), { mode: 0o640 })
  }
  assertRepositoryDocs(destination)
}
export function documentationFiles(root) {
  const files = []
  function walk(path) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (['.git', '.vitepress'].includes(entry.name)) continue
      const file = join(path, entry.name)
      if (entry.isSymbolicLink()) throw new Error('Documentation contains a symbolic link')
      if (entry.isDirectory()) walk(file)
      else if (entry.isFile() && extname(file).toLowerCase() === '.md')
        files.push(relative(root, file).split('\\').join('/'))
      else if (!entry.isFile()) throw new Error('Documentation contains a special file')
    }
  }
  walk(root)
  return files.sort((a, b) => a.localeCompare(b))
}
// Validate the repository document surface without imposing strict-node authoring
// templates. File includes are still forbidden because they escape captured inputs.
export function assertRepositoryDocs(root) {
  const files = documentationFiles(root)
  if (!files.length) throw new Error('Documentation Git commit contains no Markdown pages')
  for (const path of files) assertNoFileIncludes(readFileSync(join(root, path), 'utf8'))
  return files
}
export function repositoryNavigation(root) {
  const entries = assertRepositoryDocs(root).filter((path) => path !== 'index.md')
  const title = (path) =>
    readFileSync(join(root, path), 'utf8')
      .match(/^#\s+([^\r\n]+)/m)?.[1]
      ?.trim() || path.split('/').at(-1).replace(/\.md$/i, '')
  function branch(prefix) {
    const dirs = [
      ...new Set(
        entries
          .filter((path) => path.startsWith(prefix) && path.slice(prefix.length).includes('/'))
          .map((path) => path.slice(prefix.length).split('/')[0]),
      ),
    ]
    const pages = entries
      .filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
      .map((path) => ({ text: title(path), link: '/' + path.replace(/\.md$/i, '') }))
    return [
      ...pages,
      ...dirs.map((dir) => ({ text: dir, collapsed: true, items: branch(prefix + dir + '/') })),
    ]
  }
  return {
    sidebar: branch(''),
    nav: [
      { text: '首页', link: '/' },
      ...['doc', 'code']
        .filter((dir) => existsSync(join(root, dir, 'README.md')))
        .map((dir) => ({
          text: dir === 'doc' ? '产品文档' : '代码契约',
          link: '/' + dir + '/README',
        })),
    ],
  }
}

// Ordinary repository Markdown is data, never Vue source or repository plugins.
export function repositoryMarkdown(md, { root } = {}) {
  md.set({ html: false, linkify: false })
  md.renderer.rules.text = (tokens, index) =>
    md.utils.escapeHtml(tokens[index].content).replaceAll('{{', '&#123;&#123;')
  md.inline.ruler.before('emphasis', 'repository_wiki_link', (state, silent) =>
    wikiLink(state, silent, root),
  )
  md.core.ruler.after('inline', 'repository_source_citations', (state) => {
    for (const block of state.tokens) if (block.children) sourceCitations(block.children, state.env)
  })
}
function wikiLink(state, silent, root) {
  const match = state.src.slice(state.pos).match(/^\[\[([^\]\n]+)\]\]/)
  if (!match) return false
  if (!silent) {
    const [target, label] = match[1].split('|')
    if (root && !existsSync(join(root, target.split('#')[0].replace(/^\//, '')))) {
      const literal = state.push('text', '', 0)
      literal.content = match[0]
      state.pos += match[0].length
      return true
    }
    const open = state.push('link_open', 'a', 1)
    open.attrSet('href', '/' + target.replace(/^\//, ''))
    const text = state.push('text', '', 0)
    text.content = label || target
    state.push('link_close', 'a', -1)
  }
  state.pos += match[0].length
  return true
}
function sourceCitations(tokens, env) {
  let external = false
  for (const token of tokens) {
    if (token.type === 'link_open') {
      const href = token.attrGet('href') || ''
      const relativePath = env.relativePath || ''
      const path = posix.normalize(posix.join(posix.dirname(relativePath), href.split('#')[0]))
      external =
        !/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(href) && (path === '..' || path.startsWith('../'))
      if (external) {
        token.tag = 'span'
        token.attrs = [['title', '外部源码引用：' + href]]
      }
    } else if (token.type === 'link_close' && external) {
      token.tag = 'span'
      external = false
    }
  }
}
