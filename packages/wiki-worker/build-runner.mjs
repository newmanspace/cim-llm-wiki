import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { copySafe, snapshotContext } from '../wiki-core/build-snapshot.mjs'
import { assertValidWiki } from '../wiki-core/validate.mjs'
import { toolchainIdentity } from '../wiki-core/build-toolchain.mjs'

async function command(file, args, { cwd, env, signal, log }) {
  const child = spawn(file, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let kill
  const stop = () => {
    try { process.kill(-child.pid, 'SIGTERM') } catch (error) { if (error.code !== 'ESRCH') throw error }
    kill = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') console.error(error.message) } }, 2000)
    kill.unref()
  }
  signal.addEventListener('abort', stop, { once: true })
  let output = ''
  const collect = chunk => { output = (output + chunk.toString()).slice(-16000); writeFileSync(log, output) }
  child.stdout.on('data', collect); child.stderr.on('data', collect)
  try {
    const [code] = await once(child, 'exit')
    writeFileSync(log, output)
    if (signal.aborted) throw new Error('Build cancelled or timed out')
    if (code !== 0) throw new Error(`Static build failed (${code}): ${output.slice(-4000)}`)
  } finally { clearTimeout(kill); signal.removeEventListener('abort', stop) }
}
function linkDependencies(source, target) {
  mkdirSync(target, { recursive: true })
  for (const name of readdirSync(source)) {
    if (!name.startsWith('.vite')) symlinkSync(join(source, name), join(target, name))
  }
}
function toolchain(sourceRoot, target) {
  for (const part of ['packages/wiki-core', 'contracts', '.agents/skills/cim-wiki/assets']) copySafe(join(sourceRoot, part), join(target, part))
  mkdirSync(join(target, 'wiki'), { recursive: true })
  for (const part of ['.vitepress/config.mjs', '.vitepress/mermaid-markdown.mjs', '.vitepress/theme', 'scripts']) copySafe(join(sourceRoot, 'wiki', part), join(target, 'wiki', part))
  // Runtime dependencies are trusted toolchain files, outside the published input.
  linkDependencies(join(sourceRoot, 'node_modules'), join(target, 'node_modules'))
  // Vite writes .vite-temp beside dependencies. Keep that directory inside the
  // attempt, while individual installed packages remain immutable image files.
  linkDependencies(join(sourceRoot, 'wiki/node_modules'), join(target, 'wiki/node_modules'))
  writeFileSync(join(target, 'package.json'), '{"type":"module"}')
}
export async function buildSite({ job, buildsRoot, sourceRoot, signal, stage = () => {} }) {
  if (toolchainIdentity(sourceRoot) !== job.toolchainDigest) throw new Error('Build toolchain changed; register a new validated snapshot')
  const frozen = join(buildsRoot, 'snapshots', job.snapshot)
  snapshotContext(join(buildsRoot, 'snapshots'), job.snapshot, job.digest)
  const attempt = join(buildsRoot, 'attempts', job.id, job.claimToken)
  if (existsSync(attempt)) rmSync(attempt, { recursive: true })
  mkdirSync(attempt, { recursive: true })
  const input = join(attempt, 'input'), tools = join(attempt, 'tools')
  copySafe(frozen, input)
  const metadata = JSON.parse(readFileSync(join(frozen, 'snapshot.json'), 'utf8'))
  const context = { projectRoot: join(input, 'state'), wikiRoot: join(input, 'state/data/wiki'), roots: Object.fromEntries(metadata.rootIds.map(key => [key, join(input, 'shared', key)])) }
  stage('validate'); assertValidWiki(context)
  toolchain(sourceRoot, tools)
  const wiki = join(tools, 'wiki'), dist = join(attempt, 'dist')
  const env = { PATH: process.env.PATH, NODE_ENV: 'production', CIM_WIKI_WORKSPACE: context.projectRoot, CIM_WIKI_SHARED_ROOTS: JSON.stringify(context.roots), WIKI_ROOT: context.wikiRoot, WIKI_SIDEBAR_OUT: join(wiki, '.vitepress/sidebar-data.mjs'), WIKI_OUT_DIR: dist, WIKI_BASE: job.mode === 'preview' ? `/wiki-preview/${job.id}/` : '/wiki/', WIKI_GIT_COMMIT: job.gitCommit, WIKI_PREVIEW_ID: job.mode === 'preview' ? job.id : '', WIKI_PREVIEW_EXPIRES: job.expiresAt ? new Date(job.expiresAt).toISOString() : '' }
  stage('navigation')
  await command(process.execPath, [join(wiki, 'scripts/gen-sidebar.mjs')], { cwd: wiki, env, signal, log: join(attempt, 'navigation.log') })
  stage('build')
  await command(process.execPath, [join(sourceRoot, 'wiki/node_modules/vitepress/bin/vitepress.js'), 'build', wiki], { cwd: wiki, env, signal, log: join(attempt, 'build.log') })
  if (!existsSync(join(dist, 'index.html'))) throw new Error('Static site has no home page')
  return dist
}
