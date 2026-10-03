// wiki-gitops.mjs — 知识库 GitOps 提交钩子（供 compile.mjs Stage 5 复用）
//
// 将 data/wiki 作为独立 git 仓库管理，使每次编译入库产生一条可追溯 commit，
// 支持 diff / 回溯 / git revert，同时主仓仍不被编译产物污染（data/ 保持 .gitignore）。
//
// 环境变量：
//   WIKI_GITOPS_ENABLED      开关（1/true/yes 生效；未设 = 离线 no-op，零副作用）
//   WIKI_GITOPS_ROOT         知识仓库根目录（默认取 compile 的 wikiRoot，即 data/wiki）
//   WIKI_GIT_REMOTE          可选，远端名或 URL；设置后 commit 完成即尝试 push
//   WIKI_GIT_BRANCH          可选，目标分支（默认当前 HEAD，push 时若缺省用 main）
//   WIKI_GIT_AUTHOR_NAME     提交者名称（默认 cim-wiki-pipeline）
//   WIKI_GIT_AUTHOR_EMAIL    提交者邮箱（默认 pipeline@cim-wiki.local）
//
// 设计原则：与 admin-client 一致——GitOps 不可用/失败仅告警，绝不阻断本地编译结果。
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])

export function gitopsEnabled() {
  return TRUTHY.has((process.env.WIKI_GITOPS_ENABLED || '').toLowerCase())
}

function gitRepoRoot(defaultRoot) {
  return process.env.WIKI_GITOPS_ROOT || defaultRoot
}

function runGit(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf-8' })
  if (r.status !== 0) {
    const err = new Error((r.stderr || r.stdout || `git ${args.join(' ')} failed`).trim())
    err.gitArgs = args
    throw err
  }
  return (r.stdout || '').trim()
}

// 确保 repoRoot 是一个独立 git 仓库；不存在则初始化并配置流水线身份与忽略项。
export function ensureRepo(repoRoot) {
  if (!existsSync(repoRoot)) {
    const e = new Error(`知识仓库根目录不存在: ${repoRoot}`)
    e.code = 'ENOENT'
    throw e
  }
  const inside = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: repoRoot, encoding: 'utf-8' })
  const isIndependentRepo = existsSync(join(repoRoot, '.git'))
  if (inside.status === 0 && isIndependentRepo) return { initialized: false }

  runGit(['init'], repoRoot)
  runGit(['config', 'user.name', process.env.WIKI_GIT_AUTHOR_NAME || 'cim-wiki-pipeline'], repoRoot)
  runGit(['config', 'user.email', process.env.WIKI_GIT_AUTHOR_EMAIL || 'pipeline@cim-wiki.local'], repoRoot)
  return { initialized: true }
}

// 暂存全部变更并提交（无变更时跳过）。返回 { committed, hash, changed }。
export function commitWiki(repoRoot, message) {
  runGit(['add', '-A'], repoRoot)
  const hasStaged = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: repoRoot })
  if (hasStaged.status === 0) {
    return { committed: false, reason: 'no-change' }
  }
  const changed = runGit(['diff', '--cached', '--name-only'], repoRoot).split('\n').filter(Boolean)
  runGit(['commit', '-m', message], repoRoot)
  const hash = runGit(['rev-parse', '--short', 'HEAD'], repoRoot)
  return { committed: true, hash, changed }
}

// 若配置了远端则推送；未配置视为 no-op。失败抛出交由调用方降级。
export function pushWiki(repoRoot) {
  const remote = process.env.WIKI_GIT_REMOTE
  if (!remote) return { pushed: false, reason: 'no-remote' }
  const branch = process.env.WIKI_GIT_BRANCH || runGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot)
  // 若 remote 是 URL 且尚未登记，则临时按 URL 推送。
  const remotes = runGit(['remote'], repoRoot).split('\n').filter(Boolean)
  const target = remotes.includes(remote) ? remote : null
  const args = target ? ['push', target, branch] : ['push', remote, branch]
  runGit(args, repoRoot)
  return { pushed: true, remote: target || remote, branch }
}
