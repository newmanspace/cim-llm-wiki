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

export type ProjectBasics = Pick<ProjectConfig, 'name' | 'product' | 'version'>

export async function createProject(project: ProjectBasics & { id: string; wiki_source_directory?: string }): Promise<void> {
  await client.post('/admin/projects', project)
}

export async function updateProject(id: string, patch: Partial<ProjectBasics>): Promise<void> {
  await client.patch(`/admin/projects/${encodeURIComponent(id)}`, patch)
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

export interface ProjectWikiStatus {
  project: string
  sourceDirectory: string
  contentKind: 'strict_nodes' | 'repository_docs'
  storageRoot: string
  siteDirectory: string
  siteUrl: string
  initialized: boolean
  published: boolean
  gitStatus: 'uninitialized' | 'clean' | 'dirty'
}
export async function getProjectWiki(id: string): Promise<ProjectWikiStatus> {
  return (await client.get(`/admin/projects/${encodeURIComponent(id)}/wiki`)).data.data
}
export async function configureProjectWiki(id: string, sourceDirectory: string): Promise<ProjectWikiStatus> {
  return (await client.post(`/admin/projects/${encodeURIComponent(id)}/wiki/configure`, { sourceDirectory })).data.data
}
export async function initializeProjectWiki(id: string): Promise<ProjectWikiStatus> {
  return (await client.post(`/admin/projects/${encodeURIComponent(id)}/wiki/initialize`, {})).data.data
}
