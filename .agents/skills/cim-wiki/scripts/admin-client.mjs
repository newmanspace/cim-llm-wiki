// admin-client.mjs — Admin API 回写/拉取客户端（供 compile.mjs / sync-repo.mjs 复用）
//
// 环境变量：
//   ADMIN_URL            Admin 服务基址，如 http://localhost:8080（未设置 = 离线模式，全部 no-op）
//   ADMIN_PROJECT_TOKEN  project-token 明文（cimwt_...），用于 token 保护端点 config / sync-status
//   ADMIN_PROJECT_ID     可选，显式指定回写目标项目；未设置时按模块归属自动解析
//
// 设计原则：admin 不可达时仅告警、绝不阻断流水线；离线模式零外部依赖。

const ADMIN_URL = (process.env.ADMIN_URL || '').replace(/\/+$/, '')
const TOKEN = process.env.ADMIN_PROJECT_TOKEN || ''

export function adminEnabled() {
  return !!ADMIN_URL
}

function apiBase() {
  return `${ADMIN_URL}/api/v1/admin`
}

async function adminFetch(path, { method = 'GET', body, useToken = false } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (useToken && TOKEN) headers.Authorization = `Bearer ${TOKEN}`
  const res = await fetch(`${apiBase()}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data = null
  if (text) {
    try { data = JSON.parse(text) } catch { data = { raw: text } }
  }
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`)
    err.status = res.status
    throw err
  }
  return data
}

// POST /projects/:id/wiki-nodes —— 编译产物索引回写（开放端点）
export async function pushWikiNodes(projectId, nodes) {
  return adminFetch(`/projects/${encodeURIComponent(projectId)}/wiki-nodes`, {
    method: 'POST',
    body: { nodes },
  })
}

// POST /projects/:id/sync-status —— 增量同步状态回写（token 保护）
export async function pushSyncStatus(projectId, payload) {
  return adminFetch(`/projects/${encodeURIComponent(projectId)}/sync-status`, {
    method: 'POST',
    body: payload,
    useToken: true,
  })
}

// GET /projects/:id/config —— 拉取项目配置（token 保护）
export async function fetchProjectConfig(projectId) {
  return adminFetch(`/projects/${encodeURIComponent(projectId)}/config`, { useToken: true })
}

// 依据模块归属解析回写目标项目 ID 列表。
// 优先级：ADMIN_PROJECT_ID 显式指定 > 模块命中 project.modules / repo.module_mapping > 单项目兜底 > 全部
export function resolveProjectIds(projects, modules) {
  if (process.env.ADMIN_PROJECT_ID) return [process.env.ADMIN_PROJECT_ID]
  const ids = Object.keys(projects || {})
  if (!ids.length) return []
  const modSet = new Set((modules || []).filter(Boolean))
  if (modSet.size) {
    const matched = ids.filter((id) => {
      const p = projects[id] || {}
      const owned = new Set(p.modules || [])
      for (const r of p.repos || []) {
        for (const v of Object.values(r.module_mapping || {})) owned.add(v)
      }
      for (const m of modSet) if (owned.has(m)) return true
      return false
    })
    if (matched.length) return matched
  }
  return ids
}
