#!/usr/bin/env node
// admin-pull.mjs — Stage 0：从 Admin 拉取项目配置并落地到本地 project-registry.json
//
// 用法:
//   ADMIN_URL=... ADMIN_PROJECT_TOKEN=... node admin-pull.mjs <project-id>
//   ADMIN_URL=... ADMIN_PROJECT_TOKEN=... node admin-pull.mjs --all
//
// 行为:
//   GET /api/v1/admin/projects/:id/config → 覆盖写入本地 registry 对应项目条目
//   未配置 ADMIN_URL 时直接退出（离线模式由调用方使用本地 JSON，无需本脚本）。
//   注意: --all 需枚举项目，本脚本仅支持按 id 拉取；--all 时从本地 registry 现有 id 集合逐个拉取。

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { adminEnabled, fetchProjectConfig } from './admin-client.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..', '..')
const REGISTRY_PATH = join(PROJECT_ROOT, 'data', 'documents', 'project-registry.json')

function loadRegistry() {
  if (!existsSync(REGISTRY_PATH)) return { projects: {} }
  const reg = JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'))
  if (!reg.projects) reg.projects = {}
  return reg
}

function saveRegistry(reg) {
  writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2) + '\n', 'utf-8')
}

async function main() {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'))
  const all = process.argv.includes('--all')
  const reg = loadRegistry()

  let ids = args
  if (all) ids = Object.keys(reg.projects)
  if (!ids.length) {
    console.error('用法: ADMIN_URL=... node admin-pull.mjs <project-id> | --all')
    process.exit(1)
  }

  if (!adminEnabled()) {
    console.log('未配置 ADMIN_URL → 离线模式，使用本地 project-registry.json，跳过 Admin 拉取。')
    return
  }

  console.log(`=== Stage 0: 从 Admin 拉取项目配置 (${ADMIN_HINT()}) ===\n`)
  for (const id of ids) {
    try {
      const cfg = await fetchProjectConfig(id)
      reg.projects[id] = cfg
      console.log(`  ✓ ${id}: ${cfg.name || ''} docs=${(cfg.docs || []).length} repos=${(cfg.repos || []).length} modules=${(cfg.modules || []).length}`)
    } catch (err) {
      console.warn(`  ✗ ${id}: 拉取失败 (${err.message})${err.status === 401 ? ' — 检查 ADMIN_PROJECT_TOKEN' : ''}`)
    }
  }
  saveRegistry(reg)
  console.log(`\n已写入 data/documents/project-registry.json`)
}

function ADMIN_HINT() {
  return (process.env.ADMIN_URL || '').replace(/\/+$/, '')
}

main().catch(e => { console.error(e); process.exit(1) })
