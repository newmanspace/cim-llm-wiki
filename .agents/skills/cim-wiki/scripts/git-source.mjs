#!/usr/bin/env node
// Read immutable Git blobs without checking out code, filters or submodules.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { pathToFileURL } from 'node:url'
import {
  extensions,
  commandFailure,
  safeRepositoryFile,
  destinationRoot,
  sharedURI,
  validateBinding,
} from './source-files.mjs'
import { runSourceCLI } from './source-client.mjs'
const exec = promisify(execFile)
const oidPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/

export function normalizeGitURL(input, allowFile = false) {
  const scp = input.match(
    /^([A-Za-z0-9][A-Za-z0-9._-]*)@([A-Za-z0-9][A-Za-z0-9.-]*):([^\s]+)$/,
  )
  const raw = scp ? `ssh://${scp[1]}@${scp[2]}/${scp[3]}` : input
  const url = new URL(raw)
  if (allowFile && url.protocol === 'file:') return url.href
  if (
    !['https:', 'ssh:'].includes(url.protocol) ||
    url.password ||
    url.search ||
    url.hash ||
    /\s/.test(raw)
  )
    throw new Error(
      'Git requires HTTPS or SSH without credentials or query parameters',
    )
  if (
    url.username &&
    (url.protocol !== 'ssh:' ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(url.username))
  )
    throw new Error(
      'Git authentication must use local credential helpers or SSH keys',
    )
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(host) && !isIP(host))
    throw new Error('Invalid Git host')
  return url.href.replace(/\/+$/, '')
}
function validateSelection(source) {
  const selected = source.revision_selector || 'HEAD'
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(selected) ||
    selected.includes('..') ||
    selected.includes('//') ||
    selected.endsWith('/') ||
    selected.endsWith('.') ||
    selected.split('/').some((p) => p.startsWith('.') || p.endsWith('.lock'))
  )
    throw new Error('Invalid Git revision selector')
  const subpath = source.subpath || ''
  if (subpath && !safeRepositoryFile(subpath))
    throw new Error('Invalid Git document subpath')
  return { selected, subpath }
}
function gitEnvironment() {
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '',
    SSH_ASKPASS_REQUIRE: 'never',
    GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o StrictHostKeyChecking=yes',
  }
  for (const key of [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_INDEX_FILE',
    'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_CONFIG_PARAMETERS',
    'GIT_CONFIG_COUNT',
  ])
    delete env[key]
  return env
}
function runner(repository, allowFile) {
  const config = [
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'core.fsmonitor=false',
    '-c',
    'maintenance.auto=false',
    '-c',
    'gc.auto=0',
    '-c',
    'fetch.recurseSubmodules=false',
    '-c',
    'protocol.allow=never',
    '-c',
    'protocol.https.allow=always',
    '-c',
    'protocol.ssh.allow=always',
    '-c',
    `protocol.file.allow=${allowFile ? 'always' : 'never'}`,
  ]
  return async (args, binary = false, maxBuffer = 16 * 1024 * 1024) => {
    try {
      return (
        await exec('git', [...config, '-C', repository, ...args], {
          env: gitEnvironment(),
          timeout: 120000,
          maxBuffer,
          encoding: binary ? 'buffer' : 'utf8',
        })
      ).stdout
    } catch (error) {
      throw commandFailure(
        error,
        'Git',
        'verify the remote, local credentials, SSH host trust and selected reference',
      )
    }
  }
}
function selectedFiles(listing, maxFiles, maxBytes) {
  const files = []
  let total = 0
  for (const entry of listing.split('\0').filter(Boolean)) {
    const match = entry.match(
      /^([0-7]{6}) (blob|commit) ([0-9a-f]+) +([0-9]+|-)\t([\s\S]+)$/,
    )
    if (!match) throw new Error('Invalid Git tree evidence')
    const [, mode, type, oid, size, path] = match
    if (mode === '160000')
      throw new Error('Git submodules are not document snapshots')
    if (mode === '120000' || type !== 'blob')
      throw new Error('Git symbolic links are not regular document files')
    if (!extensions.test(path)) continue
    if (
      !safeRepositoryFile(path) ||
      !oidPattern.test(oid) ||
      !Number.isSafeInteger(Number(size))
    )
      throw new Error('Unsafe Git document entry')
    total += Number(size)
    files.push({ path, blob_oid: oid, size: Number(size) })
  }
  if (!files.length || files.length > maxFiles || total > maxBytes)
    throw new Error('Git selection is empty or exceeds collection limits')
  return files
}
async function exportFiles(git, files, root, local, mount, maxBytes) {
  const output = []
  for (const file of files) {
    const bytes = await git(
      ['cat-file', 'blob', file.blob_oid],
      true,
      maxBytes + 1,
    )
    if (bytes.length !== file.size)
      throw new Error('Git blob size differs from its tree evidence')
    if (
      bytes
        .subarray(0, 200)
        .toString('utf8')
        .startsWith('version https://git-lfs.github.com/spec/v1')
    )
      throw new Error(
        'Git LFS pointer found; retrieve and verify the real object before ingestion',
      )
    const path = join(local, file.path)
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 })
    output.push({
      repository_path: file.path,
      blob_oid: file.blob_oid,
      size: file.size,
      local_path: path,
      source_uri: sharedURI(root, mount, path),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    })
  }
  return output
}
export async function collectGitSource({
  source,
  project,
  sharedRoot,
  mount,
  allowFile = false,
  maxFiles = 500,
  maxBytes = 100 * 1024 * 1024,
}) {
  validateBinding(project, mount)
  const repositoryURL = normalizeGitURL(source.url, allowFile),
    { selected, subpath } = validateSelection(source)
  const temporary = mkdtempSync(join(tmpdir(), 'cim-git-source-')),
    git = runner(temporary, allowFile)
  try {
    let advertised = await git(['ls-remote', '--symref', repositoryURL, 'HEAD'])
    if (!advertised.match(/^[0-9a-f]+\t/m))
      advertised = await git(['ls-remote', '--refs', repositoryURL])
    const advertisedOID = advertised.match(/^([0-9a-f]+)\t/m)?.[1]
    if (!oidPattern.test(advertisedOID || ''))
      throw new Error('Git repository has no readable commit references')
    await git([
      'init',
      '--bare',
      '--template=',
      `--object-format=${advertisedOID.length === 64 ? 'sha256' : 'sha1'}`,
      '.',
    ])
    await git(['remote', 'add', 'origin', repositoryURL])
    await git(['fetch', '--no-tags', '--depth=1', 'origin', selected])
    const commit = (
      await git(['rev-parse', '--verify', 'FETCH_HEAD^{commit}'])
    ).trim()
    if (!oidPattern.test(commit))
      throw new Error('Git returned an invalid full commit SHA')
    if (
      subpath &&
      (await git(['cat-file', '-t', `${commit}:${subpath}`])).trim() !== 'tree'
    )
      throw new Error('Git source subpath must be a document directory')
    const listing = await git([
      'ls-tree',
      '-r',
      '-z',
      '--long',
      commit,
      '--',
      ...(subpath ? [subpath] : []),
    ])
    const files = selectedFiles(listing, maxFiles, maxBytes),
      { root, local } = destinationRoot(sharedRoot, project, 'git')
    const output = await exportFiles(git, files, root, local, mount, maxBytes)
    const infoPath = join(local, 'git-info.json')
    writeFileSync(
      infoPath,
      JSON.stringify(
        {
          source_type: 'git',
          repository_url: repositoryURL,
          commit_sha: commit,
          revision_selector: selected,
          files: output.map(({ repository_path, blob_oid, size, sha256 }) => ({
            repository_path,
            blob_oid,
            size,
            sha256,
          })),
        },
        null,
        2,
      ) + '\n',
      { flag: 'wx', mode: 0o600 },
    )
    return {
      project,
      source_type: 'git',
      repository_url: repositoryURL,
      commit_sha: commit,
      git_info_uri: sharedURI(root, mount, infoPath),
      files: output,
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  runSourceCLI(collectGitSource, 'git').catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
