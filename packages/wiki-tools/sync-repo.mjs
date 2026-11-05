#!/usr/bin/env node
// sync-repo.mjs — 增量同步脚本：检测 git submodule 变更，定位受影响模块
// 用法:
//   node sync-repo.mjs <project-id>              # 同步指定项目
//   node sync-repo.mjs --all                     # 同步所有项目
//   node sync-repo.mjs <project-id> --dry-run    # 仅检测变更，不触发流水线
//
// 工作流：
//   1. 读取 project-registry.json 获取项目配置
//   2. 进入 submodule 目录执行 git fetch + diff lastSyncSHA..HEAD
//   3. 通过 module_mapping 将变更文件映射到业务模块
//   4. 输出受影响模块列表 + 变更文件清单
//   5. 更新 lastSyncSHA 和 synced_at

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { adminEnabled, pushSyncStatus } from './admin-client.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(process.env.CIM_WIKI_WORKSPACE || resolve(__dirname, '..', '..'))
const REGISTRY_PATH = join(PROJECT_ROOT, 'data', 'documents', 'project-registry.json')

function loadRegistry() {
  if (!existsSync(REGISTRY_PATH)) {
    console.error(`project-registry.json 不存在: ${REGISTRY_PATH}`)
    console.error('请先通过 Admin API 或手动创建项目配置')
    process.exit(1)
  }
  const reg = JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'))
  return reg.projects || {}
}

function saveRegistry(projects) {
  const reg = { projects }
  writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2) + '\n', 'utf-8')
}

function gitCmd(cwd, ...args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf-8', timeout: 30000 }).trim()
  } catch {
    return null
  }
}

function detectChanges(project, projectId) {
  const results = { projectId, changedFiles: [], affectedModules: new Set(), errors: [], repoSyncs: [] }

  for (const repo of project.repos || []) {
    const repoPath = resolve(PROJECT_ROOT, repo.submodule)
    if (!existsSync(repoPath)) {
      results.errors.push(`submodule 不存在: ${repo.submodule} (请先 git submodule update --init)`)
      continue
    }

    // Fetch latest (fall back to local HEAD if remote unreachable)
    const branch = repo.branch || 'main'
    let fetchResult = gitCmd(repoPath, 'fetch', 'origin', branch)
    let useLocal = false
    if (fetchResult === null) {
      console.log(`  ${repo.name}: git fetch 失败，回退到本地 HEAD (离线模式)`)
      useLocal = true
    }

    const lastSHA = repo.last_sync_sha
    const headRef = useLocal ? 'HEAD' : `origin/${branch}`
    const headSHA = gitCmd(repoPath, 'rev-parse', headRef)

    if (!headSHA) {
      results.errors.push(`无法获取 HEAD SHA: ${repo.name}`)
      continue
    }

    if (lastSHA === headSHA) {
      console.log(`  ${repo.name}: 无变更 (${headSHA.substring(0, 8)})`)
      continue
    }

    // Get changed files
    const diffArgs = lastSHA ? ['diff', '--name-only', `${lastSHA}..${headSHA}`] : ['diff', '--name-only', headSHA]
    const diffOutput = gitCmd(repoPath, ...diffArgs)
    if (!diffOutput) {
      console.log(`  ${repo.name}: diff 无输出 (可能首次同步)`)
      // Treat all tracked files as changed for first sync
      const allFiles = gitCmd(repoPath, 'ls-files')
      if (allFiles) {
        for (const f of allFiles.split('\n')) {
          results.changedFiles.push({ repo: repo.name, path: f, type: 'new' })
          mapToModules(f, repo.module_mapping, results.affectedModules)
        }
      }
    } else {
      for (const f of diffOutput.split('\n').filter(Boolean)) {
        results.changedFiles.push({ repo: repo.name, path: f, type: 'changed' })
        mapToModules(f, repo.module_mapping, results.affectedModules)
      }
    }

    // Update sync state
    repo.last_sync_sha = headSHA
    repo.synced_at = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
    const repoChanged = results.changedFiles.filter(c => c.repo === repo.name).length
    results.repoSyncs.push({ repoName: repo.name, fromSHA: lastSHA || '', toSHA: headSHA, changedFiles: repoChanged })
    console.log(`  ${repo.name}: ${repoChanged} 文件变更, SHA ${lastSHA?.substring(0, 8) || 'init'} → ${headSHA.substring(0, 8)}`)
  }

  // Check doc changes
  for (const doc of project.docs || []) {
    const docPath = resolve(PROJECT_ROOT, doc.path)
    if (!existsSync(docPath)) continue

    const hash = createHash('sha256').update(readFileSync(docPath)).digest('hex')
    if (doc.sha256 && doc.sha256 !== hash) {
      results.changedFiles.push({ repo: 'docs', path: doc.path, type: 'modified' })
      results.affectedModules.add(doc.module || project.modules?.[0] || 'unknown')
      console.log(`  文档变更: ${doc.doc_id} (sha256 不匹配)`)
    }
    doc.sha256 = hash
  }

  results.affectedModules = [...results.affectedModules]
  return results
}

function mapToModules(filePath, moduleMapping, affectedModules) {
  if (!moduleMapping) return
  // Longest prefix match
  let bestMatch = null
  let bestLen = 0
  for (const [prefix, moduleId] of Object.entries(moduleMapping)) {
    if (filePath.startsWith(prefix) && prefix.length > bestLen) {
      bestMatch = moduleId
      bestLen = prefix.length
    }
  }
  if (bestMatch) affectedModules.add(bestMatch)
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const allProjects = args.includes('--all')

  const projects = loadRegistry()
  const projectIds = allProjects ? Object.keys(projects) : args.filter(a => !a.startsWith('--'))

  if (!projectIds.length) {
    console.error('用法: node sync-repo.mjs <project-id> [--dry-run]')
    console.error('      node sync-repo.mjs --all [--dry-run]')
    console.error(`\n可用项目: ${Object.keys(projects).join(', ') || '(无)'}`)
    process.exit(1)
  }

  console.log(`=== Project 增量同步 ${dryRun ? '(dry-run)' : ''} ===\n`)

  const allResults = []
  for (const pid of projectIds) {
    const project = projects[pid]
    if (!project) {
      console.error(`项目不存在: ${pid}`)
      continue
    }

    console.log(`项目: ${project.name || pid} (${pid})`)
    const startedAt = Date.now()
    const result = detectChanges(project, pid)
    result.durationMs = Date.now() - startedAt
    allResults.push(result)

    if (result.errors.length) {
      console.log(`  错误: ${result.errors.join('; ')}`)
    }
    if (result.affectedModules.length) {
      console.log(`  受影响模块: ${result.affectedModules.join(', ')}`)
    }
    if (result.changedFiles.length) {
      console.log(`  变更文件: ${result.changedFiles.length} 个`)
      for (const f of result.changedFiles.slice(0, 10)) {
        console.log(`    [${f.type}] ${f.repo}/${f.path}`)
      }
      if (result.changedFiles.length > 10) {
        console.log(`    ... 还有 ${result.changedFiles.length - 10} 个文件`)
      }
    }
    console.log()
  }

  if (!dryRun) {
    saveRegistry(projects)
    console.log('已更新 project-registry.json (lastSyncSHA, synced_at)')

    // Write sync state
    const syncDir = join(PROJECT_ROOT, 'data', 'sync')
    if (!existsSync(syncDir)) {
      mkdirSync(syncDir, { recursive: true })
    }
    for (const r of allResults) {
      if (r.changedFiles.length || r.affectedModules.length) {
        const snapshotPath = join(syncDir, `${r.projectId}-diff-snapshot.json`)
        writeFileSync(snapshotPath, JSON.stringify({
          synced_at: new Date().toISOString(),
          changed_files: r.changedFiles,
          affected_modules: r.affectedModules,
          errors: r.errors
        }, null, 2), 'utf-8')
        console.log(`已写入同步快照: data/sync/${r.projectId}-diff-snapshot.json`)
      }
    }

    // Summary for next steps
    const totalAffected = allResults.flatMap(r => r.affectedModules)
    const uniqueAffected = [...new Set(totalAffected)]
    if (uniqueAffected.length) {
      console.log(`\n=== 下一步 ===`)
      console.log(`受影响模块: ${uniqueAffected.join(', ')}`)
      console.log('请使用 cim-wiki skill 对受影响模块的源文档重新执行 Stage 1-6 流水线')
    } else {
      console.log('\n所有项目均为最新，无需重新摄取。')
    }

    // ── Admin 回写：推送 sync-status（配置 ADMIN_URL + ADMIN_PROJECT_TOKEN 时生效）──
    if (adminEnabled()) {
      let pushed = 0
      for (const r of allResults) {
        const wn = projects[r.projectId]?.wiki_nodes || {}
        const status = r.errors.length && !r.repoSyncs.length ? 'failed' : 'success'
        for (const s of r.repoSyncs) {
          try {
            await pushSyncStatus(r.projectId, {
              repo_name: s.repoName,
              from_sha: s.fromSHA,
              to_sha: s.toSHA,
              changed_files: s.changedFiles,
              affected_modules: r.affectedModules,
              status,
              error_message: r.errors.join('; '),
              duration_ms: r.durationMs || 0,
              wiki_nodes_count: { doc: (wn.doc || []).length, code: (wn.code || []).length },
              bundles: [],
            })
            pushed++
          } catch (err) {
            console.warn(`admin: sync-status 回写失败 (${r.projectId}/${s.repoName}): ${err.message}`)
          }
        }
      }
      if (pushed) console.log(`\nadmin: 已回写 ${pushed} 条 sync-status 记录`)
    }
  }
}

main().catch(e => { console.error(e); process.exit(1) })
