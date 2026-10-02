-- ============================================================================
-- cim-llm-wiki Admin System — PostgreSQL Schema
-- Migration: 001_init.sql
-- ============================================================================

-- Projects: 核心注册表，对应 project-registry.json 中的每个 project 条目
CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,           -- 如 xinshun-mes
    name        TEXT NOT NULL,              -- 人读名称
    product     TEXT NOT NULL DEFAULT 'Semiconductor-MES',
    version     TEXT NOT NULL DEFAULT 'v1.0',
    description TEXT,
    status      TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'archived', 'suspended')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Project Documents: 项目关联的源文档
CREATE TABLE IF NOT EXISTS project_docs (
    id          SERIAL PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    doc_id      TEXT NOT NULL,              -- 如 IDD-WIP-V2.22.4
    path        TEXT NOT NULL,              -- 本地路径
    type        TEXT NOT NULL,              -- IDD / SDD / PRD / user-manual / admin-manual
    submodule   TEXT,                       -- git submodule 路径
    sha256      TEXT,
    ingested_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, doc_id)
);

-- Document-Bundle 关联（多对多）
CREATE TABLE IF NOT EXISTS doc_bundles (
    doc_id      TEXT NOT NULL,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    bundle_id   TEXT NOT NULL,              -- CR-YYYYMMDD-NNNN
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, doc_id, bundle_id)
);

-- Project Repos: 项目关联的代码仓库
CREATE TABLE IF NOT EXISTS project_repos (
    id              SERIAL PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    url             TEXT NOT NULL,
    branch          TEXT NOT NULL DEFAULT 'main',
    submodule       TEXT,
    last_sync_sha   TEXT,
    synced_at       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, name)
);

-- Repo Module Mapping: 代码路径前缀 → 业务模块
CREATE TABLE IF NOT EXISTS repo_module_mappings (
    id          SERIAL PRIMARY KEY,
    repo_id     INTEGER NOT NULL REFERENCES project_repos(id) ON DELETE CASCADE,
    path_prefix TEXT NOT NULL,              -- 如 mycim-wip/mycim-wip-server/src/
    module_id   TEXT NOT NULL,              -- 如 wip-management
    UNIQUE (repo_id, path_prefix)
);

-- Project Modules: 项目的业务模块列表
CREATE TABLE IF NOT EXISTS project_modules (
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    module_id   TEXT NOT NULL,
    PRIMARY KEY (project_id, module_id)
);

-- Project Tokens: Admin 签发的访问凭证
CREATE TABLE IF NOT EXISTS project_tokens (
    id          SERIAL PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL UNIQUE,       -- SHA256(token)，不存明文
    scopes      TEXT[] NOT NULL DEFAULT '{read_config}',
    expires_at  TIMESTAMPTZ,
    revoked_at  TIMESTAMPTZ,
    created_by  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sync Logs: 增量同步历史
CREATE TABLE IF NOT EXISTS sync_logs (
    id              SERIAL PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    repo_name       TEXT,
    from_sha        TEXT,
    to_sha          TEXT,
    changed_files   INTEGER NOT NULL DEFAULT 0,
    affected_modules TEXT[],
    status          TEXT NOT NULL DEFAULT 'success'
                    CHECK (status IN ('success', 'partial', 'failed')),
    error_message   TEXT,
    duration_ms     INTEGER,
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Wiki Nodes Index: 项目已生成的 wiki 页面索引
CREATE TABLE IF NOT EXISTS project_wiki_nodes (
    id          SERIAL PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    plane       TEXT NOT NULL CHECK (plane IN ('doc', 'code')),
    path        TEXT NOT NULL,              -- data/wiki/doc/business/br-wip-001.md
    node_id     TEXT,
    bundle_id   TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, path)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_project_docs_project ON project_docs(project_id);
CREATE INDEX IF NOT EXISTS idx_project_repos_project ON project_repos(project_id);
CREATE INDEX IF NOT EXISTS idx_project_tokens_project ON project_tokens(project_id);
CREATE INDEX IF NOT EXISTS idx_project_tokens_hash ON project_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_sync_logs_project ON sync_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_sync_logs_time ON sync_logs(synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_wiki_nodes_project ON project_wiki_nodes(project_id);
CREATE INDEX IF NOT EXISTS idx_wiki_nodes_plane ON project_wiki_nodes(project_id, plane);

-- updated_at 自动更新触发器
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_projects_updated
    BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_project_docs_updated
    BEFORE UPDATE ON project_docs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_project_repos_updated
    BEFORE UPDATE ON project_repos
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
