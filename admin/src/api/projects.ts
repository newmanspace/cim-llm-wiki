import client from './client'
import type {
  ProjectConfig,
  ProjectSummary,
  SyncLog,
  WikiNodeEntry,
  IssuedToken,
} from './types'

export async function listProjects(): Promise<ProjectSummary[]> {
  const res = await client.get('/admin/projects')
  return res.data.projects || []
}

export async function getProject(id: string): Promise<ProjectConfig> {
  const res = await client.get(`/admin/projects/${id}`)
  return res.data
}

export async function upsertProject(project: ProjectConfig): Promise<void> {
  await client.post('/admin/projects', project)
}

export async function deleteProject(id: string): Promise<void> {
  await client.delete(`/admin/projects/${id}`)
}

export async function issueToken(
  id: string,
  scopes: string[],
  expiresHours: number,
): Promise<IssuedToken> {
  const res = await client.post(`/admin/projects/${id}/token`, {
    project_id: id,
    scopes,
    expires_in_hours: expiresHours,
  })
  return res.data
}

export async function revokeToken(id: string, token: string): Promise<void> {
  await client.delete(`/admin/projects/${id}/token`, { data: { token } })
}

export async function getSyncLogs(id: string, limit = 20): Promise<SyncLog[]> {
  const res = await client.get(`/admin/projects/${id}/sync-logs`, { params: { limit } })
  return res.data.logs || []
}

export async function getWikiNodes(id: string): Promise<WikiNodeEntry[]> {
  const res = await client.get(`/admin/projects/${id}/wiki-nodes`)
  return res.data.nodes || []
}
