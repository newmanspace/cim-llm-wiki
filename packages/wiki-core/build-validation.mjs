import { lstatSync, readdirSync } from 'node:fs'
import { readRegularFile } from './safe-files.mjs'
import { join, relative } from 'node:path'
import { assertNoFileIncludes, parsePage, renderingErrors } from './markdown.mjs'

export function parseBuildPage(text) {
  assertNoFileIncludes(text)
  return parsePage(/^\uFEFF?---\r?\n/.test(text) ? text : '---\n{}\n---\n' + text, {
    preserveTrace: true,
  })
}

// Build committed document data with the current renderer. Authoring contracts
// belong to submission; changing a template must not invalidate older pages.
export function validateBuildInput({ wikiRoot, sourceRoot, project } = {}) {
  const root = sourceRoot || wikiRoot
  const errors = []
  let scanned = 0
  function walk(path) {
    const key = relative(root, path) || '.'
    const stat = lstatSync(path, { throwIfNoEntry: false })
    if (!stat) {
      errors.push({ code: 'wiki_missing', path: key, message: 'Wiki directory does not exist' })
      return
    }
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
      errors.push({
        code: 'unsafe_path',
        path: key,
        message: 'Build inputs must be regular files or directories',
      })
      return
    }
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path)) {
        if (!['.git', '.vitepress', 'templates'].includes(entry)) walk(join(path, entry))
      }
    } else if (path.endsWith('.md')) {
      scanned++
      try {
        const text = readRegularFile(path, 'utf8')
        const page = parseBuildPage(text)
        errors.push(...renderingErrors(page.tokens).map((error) => ({ ...error, path: key })))
        if (Object.hasOwn(page.fm, 'head'))
          errors.push({
            code: 'active_content',
            path: key,
            message: 'Document frontmatter must not override the site HTML head',
          })
      } catch (error) {
        errors.push({ code: 'frontmatter_error', path: key, message: error.message })
      }
    }
  }
  if (project && !/^[a-z0-9][a-z0-9_-]*$/i.test(project)) throw new Error('Invalid build project')
  walk(sourceRoot || !project ? root : join(root, project))
  return { errors, warnings: [], scanned }
}

export function assertBuildInput(options) {
  const result = validateBuildInput(options)
  if (result.errors.length)
    throw Object.assign(
      new Error(
        result.errors.map((error) => `[${error.code}] ${error.path}: ${error.message}`).join('\n'),
      ),
      { code: 'wiki_validation', diagnostics: result.errors },
    )
  return result
}
