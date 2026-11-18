-- Project document catalog, independent of quality-policy overrides.
CREATE TABLE IF NOT EXISTS dq_directories (
    sys_id SERIAL PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),
    revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(project_id,sys_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dq_directory_path ON dq_directories(project_id,(payload->>'path'));
