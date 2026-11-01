#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PROJECT_ROOT } from './contracts.mjs'
import { validateWiki, assertValidWiki } from './validate.mjs'
import { compileBundle } from './compile.mjs'
import { adminEnabled, pushWikiNodes } from './admin-client.mjs'
import { gitopsEnabled, ensureRepo, commitWiki, pushWiki } from './wiki-gitops.mjs'

export async function runCli(argv = process.argv.slice(2)) {
  try {
    const [command, ...args] = argv
    const allowedFlags = command === 'compile' ? ['--wiki-root', '--project-root', '--preview'] : ['--project-root', '--json']
    const values = {}, positional = []
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]
      if (!arg.startsWith('--')) { positional.push(arg); continue }
      if (!allowedFlags.includes(arg)) throw new Error(`Unsupported option: ${arg}`)
      if (['--json', '--preview'].includes(arg)) values[arg] = true
      else {
        if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${arg}`)
        values[arg] = args[++i]
      }
    }
    const projectRoot = resolve(values['--project-root'] || PROJECT_ROOT)
    if (command === 'validate') {
      if (positional.length > 1) throw new Error('validate accepts a single wiki directory')
      const wikiRoot = resolve(positional[0] || process.env.WIKI_ROOT || join(projectRoot, 'data/wiki'))
      const result = validateWiki({ wikiRoot, projectRoot })
      if (values['--json']) console.log(JSON.stringify(result, null, 2))
      else {
        console.log(`Scanned pages: ${result.scanned}`)
        for (const [label, items] of [['ERROR', result.errors], ['WARN', result.warnings]]) {
          for (const e of items) console.log(`${label} [${e.code}] ${e.path}: ${e.message}`)
        }
        console.log(`Result: ${result.errors.length} error, ${result.warnings.length} warning`)
      }
      process.exitCode = result.errors.length ? 1 : 0
      return result
    }
    if (command !== 'compile' || positional.length !== 1) throw new Error('Usage: cli.mjs validate [wiki_root] [--json] | compile <bundle_id|nodes.json> [--wiki-root DIR] [--preview]')
    const src = existsSync(resolve(positional[0])) ? resolve(positional[0]) : join(projectRoot, 'data/work', positional[0], 'nodes.json')
    const data = JSON.parse(readFileSync(src, 'utf8'))
    if (process.env.ADMIN_PROJECT_ID && process.env.ADMIN_PROJECT_ID !== data.project) throw new Error('ADMIN_PROJECT_ID conflicts with bundle.project')
    const wikiRoot = resolve(values['--wiki-root'] || process.env.WIKI_ROOT || join(projectRoot, 'data/wiki'))
    const repoRoot = resolve(process.env.WIKI_GITOPS_ROOT || wikiRoot)
    if (gitopsEnabled() && repoRoot !== wikiRoot) throw new Error('WIKI_GITOPS_ROOT must match the validated wiki root')
    const result = await compileBundle(data, { wikiRoot, projectRoot, preview: !!values['--preview'], afterPublish: async result => {
      if (gitopsEnabled() && result.written.length) {
        assertValidWiki({ wikiRoot, projectRoot })
        ensureRepo(repoRoot)
        const commit = commitWiki(repoRoot, `chore(wiki): ${result.project} ${result.bundleId} - ${result.written.length} node(s)`, { projectRoot })
        if (commit.committed) pushWiki(repoRoot)
      }
      if (adminEnabled() && result.wikiEntries.length) {
        try { await pushWikiNodes(result.project, result.wikiEntries) }
        catch (e) { throw new Error(`Local publication succeeded, but Admin indexing failed: ${e.message}`) }
      }
    } })
    console.log(JSON.stringify(result, null, 2))
    return result
  } catch (e) {
    console.error(e.message)
    process.exitCode = 1
    return null
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await runCli()
