// Mirrors internal/types/types.go + internal/store/postgres.go JSON shapes.

export interface DocSource {
  doc_id: string
  path: string
  type: string
  submodule: string
  sha256: string
  ingested_at: string
  bundles: string[]
}

export interface RepoBinding {
  name: string
  url: string
  branch: string
  submodule: string
  module_mapping: Record<string, string>
  last_sync_sha: string
  synced_at: string
}

export interface ProjectWikiIndex {
  doc: string[]
  code: string[]
}

export interface SyncState {
  last_doc_sync: string
  last_code_sync: string
  pending_changes: string[]
  last_error: string
}

export interface ProjectConfig {
  id: string
  name: string
  product: string
  version: string
  docs: DocSource[]
  repos: RepoBinding[]
  modules: string[]
  wiki_nodes: ProjectWikiIndex
  sync_state: SyncState
  created_at: string
  updated_at: string
}

export interface ProjectSummary {
  id: string
  name: string
  product: string
  version: string
  created_at: string
  updated_at: string
}

export interface SyncLog {
  id: number
  project_id: string
  repo_name: string
  from_sha: string
  to_sha: string
  changed_files: number
  affected_modules: string[]
  status: string
  error_message: string
  duration_ms: number
  synced_at: string
}

export interface WikiNodeEntry {
  plane: string
  path: string
  node_id: string
  bundle_id: string
}

export interface IssuedToken {
  token: string
  project_id: string
  scopes: string[]
  expires_at: string | null
  warning: string
}
