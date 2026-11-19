-- Document review can be requested without a quality score. Existing evaluation
-- review tasks keep their foreign key and must still identify an evaluation.
ALTER TABLE dq_review_tasks ALTER COLUMN evaluation_id DROP NOT NULL;
ALTER TABLE dq_review_tasks ADD CONSTRAINT dq_review_tasks_scope_check CHECK (
    evaluation_id IS NOT NULL OR
    COALESCE((payload->>'scope' = 'document' AND payload->>'approval_mode' = 'manual'
     AND length(payload->>'artifact_digest') = 64), false)
);

-- Keep content versions immutable; lifecycle changes are append-only events.
CREATE TABLE dq_document_states (
    sys_id SERIAL PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),
    artifact_id INTEGER GENERATED ALWAYS AS ((payload->>'artifact_id')::INTEGER) STORED NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(project_id,sys_id),
    FOREIGN KEY(project_id,artifact_id) REFERENCES dq_artifact_versions(project_id,sys_id) ON DELETE RESTRICT,
    CHECK (payload ?& ARRAY['artifact_digest','state','state_revision'] AND length(payload->>'artifact_digest')=64 AND payload->>'state' IN ('draft','submitted','frozen')),
    CHECK ((payload->>'state_revision')::INTEGER > 0)
);
CREATE UNIQUE INDEX idx_dq_document_states_revision ON dq_document_states(project_id,artifact_id,((payload->>'state_revision')::INTEGER));
CREATE INDEX idx_dq_document_states_artifact ON dq_document_states(project_id,artifact_id,sys_id);
CREATE TRIGGER trg_document_states_immutable BEFORE UPDATE OR DELETE ON dq_document_states
FOR EACH ROW EXECUTE FUNCTION dq_reject_history_mutation();
