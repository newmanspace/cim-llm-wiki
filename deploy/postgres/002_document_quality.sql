-- Issue #26: project-scoped document source and quality ledger.


CREATE TABLE IF NOT EXISTS dq_data_sources (
    sys_id SERIAL PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),
    revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(project_id,sys_id)
);

CREATE INDEX IF NOT EXISTS idx_dq_data_sources_project ON dq_data_sources(project_id,sys_id);

CREATE TABLE IF NOT EXISTS dq_source_revisions (
    sys_id SERIAL PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),
    source_id INTEGER GENERATED ALWAYS AS ((payload->>'source_id')::INTEGER) STORED NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(project_id,sys_id),
    FOREIGN KEY(project_id,source_id) REFERENCES dq_data_sources(project_id,sys_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_dq_source_revisions_project ON dq_source_revisions(project_id,sys_id);

CREATE INDEX IF NOT EXISTS idx_dq_source_revisions_source_id ON dq_source_revisions(project_id,source_id);

CREATE TABLE IF NOT EXISTS dq_ingest_runs (
    sys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),
    source_id INTEGER GENERATED ALWAYS AS ((payload->>'source_id')::INTEGER) STORED NOT NULL,
    source_config_id INTEGER GENERATED ALWAYS AS ((payload->>'source_config_id')::INTEGER) STORED NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(project_id,sys_id),
    FOREIGN KEY(project_id,source_id) REFERENCES dq_data_sources(project_id,sys_id) ON DELETE RESTRICT,
    FOREIGN KEY(project_id,source_config_id) REFERENCES dq_source_revisions(project_id,sys_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_dq_ingest_runs_project ON dq_ingest_runs(project_id,sys_id);

CREATE INDEX IF NOT EXISTS idx_dq_ingest_runs_source_id ON dq_ingest_runs(project_id,source_id);

CREATE INDEX IF NOT EXISTS idx_dq_ingest_runs_source_config_id ON dq_ingest_runs(project_id,source_config_id);

CREATE TABLE IF NOT EXISTS dq_source_versions (
    sys_id SERIAL PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),
    source_id INTEGER GENERATED ALWAYS AS ((payload->>'source_id')::INTEGER) STORED NOT NULL,
    run_id UUID GENERATED ALWAYS AS ((payload->>'run_id')::UUID) STORED NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(project_id,sys_id),
    FOREIGN KEY(project_id,source_id) REFERENCES dq_data_sources(project_id,sys_id) ON DELETE RESTRICT,
    FOREIGN KEY(project_id,run_id) REFERENCES dq_ingest_runs(project_id,sys_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_dq_source_versions_project ON dq_source_versions(project_id,sys_id);

CREATE INDEX IF NOT EXISTS idx_dq_source_versions_source_id ON dq_source_versions(project_id,source_id);

CREATE INDEX IF NOT EXISTS idx_dq_source_versions_run_id ON dq_source_versions(project_id,run_id);

CREATE TABLE IF NOT EXISTS dq_artifact_versions (
    sys_id SERIAL PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),
    run_id UUID GENERATED ALWAYS AS ((payload->>'run_id')::UUID) STORED NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(project_id,sys_id),
    FOREIGN KEY(project_id,run_id) REFERENCES dq_ingest_runs(project_id,sys_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_dq_artifact_versions_project ON dq_artifact_versions(project_id,sys_id);

CREATE INDEX IF NOT EXISTS idx_dq_artifact_versions_run_id ON dq_artifact_versions(project_id,run_id);

CREATE TABLE IF NOT EXISTS dq_ingest_sources (
    sys_id SERIAL PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),
    run_id UUID GENERATED ALWAYS AS ((payload->>'run_id')::UUID) STORED NOT NULL,
    source_version_id INTEGER GENERATED ALWAYS AS ((payload->>'source_version_id')::INTEGER) STORED NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(project_id,sys_id),
    FOREIGN KEY(project_id,run_id) REFERENCES dq_ingest_runs(project_id,sys_id) ON DELETE RESTRICT,
    FOREIGN KEY(project_id,source_version_id) REFERENCES dq_source_versions(project_id,sys_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_dq_ingest_sources_project ON dq_ingest_sources(project_id,sys_id);

CREATE INDEX IF NOT EXISTS idx_dq_ingest_sources_run_id ON dq_ingest_sources(project_id,run_id);

CREATE INDEX IF NOT EXISTS idx_dq_ingest_sources_source_version_id ON dq_ingest_sources(project_id,source_version_id);

CREATE TABLE IF NOT EXISTS dq_ingest_artifacts (
    sys_id SERIAL PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),
    run_id UUID GENERATED ALWAYS AS ((payload->>'run_id')::UUID) STORED NOT NULL,
    artifact_id INTEGER GENERATED ALWAYS AS ((payload->>'artifact_id')::INTEGER) STORED NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(project_id,sys_id),
    FOREIGN KEY(project_id,run_id) REFERENCES dq_ingest_runs(project_id,sys_id) ON DELETE RESTRICT,
    FOREIGN KEY(project_id,artifact_id) REFERENCES dq_artifact_versions(project_id,sys_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_dq_ingest_artifacts_project ON dq_ingest_artifacts(project_id,sys_id);

CREATE INDEX IF NOT EXISTS idx_dq_ingest_artifacts_run_id ON dq_ingest_artifacts(project_id,run_id);

CREATE INDEX IF NOT EXISTS idx_dq_ingest_artifacts_artifact_id ON dq_ingest_artifacts(project_id,artifact_id);

CREATE TABLE IF NOT EXISTS dq_quality_policies (
    sys_id SERIAL PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),
    revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(project_id,sys_id)
);

CREATE INDEX IF NOT EXISTS idx_dq_quality_policies_project ON dq_quality_policies(project_id,sys_id);

CREATE TABLE IF NOT EXISTS dq_evaluations (
    sys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),
    artifact_id INTEGER GENERATED ALWAYS AS ((payload->>'artifact_id')::INTEGER) STORED NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(project_id,sys_id),
    FOREIGN KEY(project_id,artifact_id) REFERENCES dq_artifact_versions(project_id,sys_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_dq_evaluations_project ON dq_evaluations(project_id,sys_id);

CREATE INDEX IF NOT EXISTS idx_dq_evaluations_artifact_id ON dq_evaluations(project_id,artifact_id);

CREATE TABLE IF NOT EXISTS dq_quality_issues (
    sys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),
    evaluation_id UUID GENERATED ALWAYS AS ((payload->>'evaluation_id')::UUID) STORED NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(project_id,sys_id),
    FOREIGN KEY(project_id,evaluation_id) REFERENCES dq_evaluations(project_id,sys_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_dq_quality_issues_project ON dq_quality_issues(project_id,sys_id);

CREATE INDEX IF NOT EXISTS idx_dq_quality_issues_evaluation_id ON dq_quality_issues(project_id,evaluation_id);

CREATE TABLE IF NOT EXISTS dq_review_tasks (
    sys_id SERIAL PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),
    evaluation_id UUID GENERATED ALWAYS AS ((payload->>'evaluation_id')::UUID) STORED NOT NULL,
    artifact_id INTEGER GENERATED ALWAYS AS ((payload->>'artifact_id')::INTEGER) STORED NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(project_id,sys_id),
    FOREIGN KEY(project_id,evaluation_id) REFERENCES dq_evaluations(project_id,sys_id) ON DELETE RESTRICT,
    FOREIGN KEY(project_id,artifact_id) REFERENCES dq_artifact_versions(project_id,sys_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_dq_review_tasks_project ON dq_review_tasks(project_id,sys_id);

CREATE INDEX IF NOT EXISTS idx_dq_review_tasks_evaluation_id ON dq_review_tasks(project_id,evaluation_id);

CREATE INDEX IF NOT EXISTS idx_dq_review_tasks_artifact_id ON dq_review_tasks(project_id,artifact_id);

CREATE TABLE IF NOT EXISTS dq_review_events (
    sys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),
    task_id INTEGER GENERATED ALWAYS AS ((payload->>'task_id')::INTEGER) STORED NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(project_id,sys_id),
    FOREIGN KEY(project_id,task_id) REFERENCES dq_review_tasks(project_id,sys_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_dq_review_events_project ON dq_review_events(project_id,sys_id);

CREATE INDEX IF NOT EXISTS idx_dq_review_events_task_id ON dq_review_events(project_id,task_id);

CREATE TABLE IF NOT EXISTS dq_publications (
    sys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),
    artifact_id INTEGER GENERATED ALWAYS AS ((payload->>'artifact_id')::INTEGER) STORED NOT NULL,
    evaluation_id UUID GENERATED ALWAYS AS ((payload->>'evaluation_id')::UUID) STORED NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(project_id,sys_id),
    FOREIGN KEY(project_id,artifact_id) REFERENCES dq_artifact_versions(project_id,sys_id) ON DELETE RESTRICT,
    FOREIGN KEY(project_id,evaluation_id) REFERENCES dq_evaluations(project_id,sys_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_dq_publications_project ON dq_publications(project_id,sys_id);

CREATE INDEX IF NOT EXISTS idx_dq_publications_artifact_id ON dq_publications(project_id,artifact_id);

CREATE INDEX IF NOT EXISTS idx_dq_publications_evaluation_id ON dq_publications(project_id,evaluation_id);

CREATE TABLE IF NOT EXISTS dq_command_receipts (
    sys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),
    revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(project_id,sys_id)
);

CREATE INDEX IF NOT EXISTS idx_dq_command_receipts_project ON dq_command_receipts(project_id,sys_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_dq_run_source ON dq_ingest_sources(project_id,run_id,source_version_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_dq_run_artifact ON dq_ingest_artifacts(project_id,run_id,artifact_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_dq_data_source_name ON dq_data_sources(project_id,(payload->>'name'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_dq_source_config_version ON dq_source_revisions(project_id,source_id,(payload->>'config_revision'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_dq_source_identity ON dq_source_versions(project_id,source_id,(payload->>'repository_uuid'),(payload->>'repository_path'),(payload->>'operative_revision'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_dq_artifact_version ON dq_artifact_versions(project_id,(payload->>'logical_key'),(payload->>'version'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_dq_policy_version ON dq_quality_policies(project_id,(payload->>'path'),(payload->>'policy_revision'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_dq_review_evaluation ON dq_review_tasks(project_id,evaluation_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_dq_receipt_key ON dq_command_receipts(project_id,(payload->>'operation'),(payload->>'key'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_dq_active_publish ON dq_publications(project_id,(payload->>'target_path')) WHERE payload->>'status'='publishing';

CREATE INDEX IF NOT EXISTS idx_dq_review_queue ON dq_review_tasks(project_id,(payload->>'status'),created_at);

CREATE INDEX IF NOT EXISTS idx_dq_artifact_path ON dq_artifact_versions(project_id,((payload->>'target_path')) text_pattern_ops);

CREATE OR REPLACE FUNCTION dq_reject_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Document history is immutable'; END $$;

DROP TRIGGER IF EXISTS trg_dq_source_revisions_immutable ON dq_source_revisions;

CREATE TRIGGER trg_dq_source_revisions_immutable BEFORE UPDATE OR DELETE ON dq_source_revisions FOR EACH ROW EXECUTE FUNCTION dq_reject_history_mutation();

DROP TRIGGER IF EXISTS trg_dq_source_versions_immutable ON dq_source_versions;

CREATE TRIGGER trg_dq_source_versions_immutable BEFORE UPDATE OR DELETE ON dq_source_versions FOR EACH ROW EXECUTE FUNCTION dq_reject_history_mutation();

DROP TRIGGER IF EXISTS trg_dq_artifact_versions_immutable ON dq_artifact_versions;

CREATE TRIGGER trg_dq_artifact_versions_immutable BEFORE UPDATE OR DELETE ON dq_artifact_versions FOR EACH ROW EXECUTE FUNCTION dq_reject_history_mutation();

DROP TRIGGER IF EXISTS trg_dq_ingest_sources_immutable ON dq_ingest_sources;

CREATE TRIGGER trg_dq_ingest_sources_immutable BEFORE UPDATE OR DELETE ON dq_ingest_sources FOR EACH ROW EXECUTE FUNCTION dq_reject_history_mutation();

DROP TRIGGER IF EXISTS trg_dq_ingest_artifacts_immutable ON dq_ingest_artifacts;

CREATE TRIGGER trg_dq_ingest_artifacts_immutable BEFORE UPDATE OR DELETE ON dq_ingest_artifacts FOR EACH ROW EXECUTE FUNCTION dq_reject_history_mutation();

DROP TRIGGER IF EXISTS trg_dq_quality_policies_immutable ON dq_quality_policies;

CREATE TRIGGER trg_dq_quality_policies_immutable BEFORE UPDATE OR DELETE ON dq_quality_policies FOR EACH ROW EXECUTE FUNCTION dq_reject_history_mutation();

DROP TRIGGER IF EXISTS trg_dq_evaluations_immutable ON dq_evaluations;

CREATE TRIGGER trg_dq_evaluations_immutable BEFORE UPDATE OR DELETE ON dq_evaluations FOR EACH ROW EXECUTE FUNCTION dq_reject_history_mutation();

DROP TRIGGER IF EXISTS trg_dq_quality_issues_immutable ON dq_quality_issues;

CREATE TRIGGER trg_dq_quality_issues_immutable BEFORE UPDATE OR DELETE ON dq_quality_issues FOR EACH ROW EXECUTE FUNCTION dq_reject_history_mutation();

DROP TRIGGER IF EXISTS trg_dq_review_events_immutable ON dq_review_events;

CREATE TRIGGER trg_dq_review_events_immutable BEFORE UPDATE OR DELETE ON dq_review_events FOR EACH ROW EXECUTE FUNCTION dq_reject_history_mutation();

DROP TRIGGER IF EXISTS trg_dq_command_receipts_immutable ON dq_command_receipts;

CREATE TRIGGER trg_dq_command_receipts_immutable BEFORE UPDATE OR DELETE ON dq_command_receipts FOR EACH ROW EXECUTE FUNCTION dq_reject_history_mutation();
