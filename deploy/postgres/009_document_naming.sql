-- Durable identities; numbering and four-part business keys are independent of content versions.
CREATE TABLE IF NOT EXISTS dq_naming_settings (
    sys_id SERIAL PRIMARY KEY,
    project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE RESTRICT,
    payload JSONB NOT NULL,
    short_code TEXT GENERATED ALWAYS AS (payload->>'short_code') STORED NOT NULL UNIQUE,
    revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK(short_code ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

CREATE TABLE IF NOT EXISTS dq_document_counters (
    sys_id SERIAL PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    payload JSONB NOT NULL,
    module_code TEXT GENERATED ALWAYS AS (payload->>'module') STORED NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(project_id,module_code),
    CHECK((payload->>'last_sequence')::BIGINT BETWEEN 1 AND 2147483647)
);

CREATE TABLE IF NOT EXISTS dq_document_identities (
    sys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    payload JSONB NOT NULL,
    doc_type TEXT GENERATED ALWAYS AS (payload->>'doc_type') STORED NOT NULL,
    module_code TEXT GENERATED ALWAYS AS (payload->>'module') STORED NOT NULL,
    topic_code TEXT GENERATED ALWAYS AS (payload->>'topic') STORED NOT NULL,
    sequence_no INTEGER GENERATED ALWAYS AS ((payload->>'sequence')::INTEGER) STORED NOT NULL CHECK(sequence_no > 0),
    filename TEXT GENERATED ALWAYS AS (payload->>'filename') STORED NOT NULL,
    node_id TEXT GENERATED ALWAYS AS (payload->>'node_id') STORED NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(project_id,sys_id),
    UNIQUE(project_id,doc_type,module_code,topic_code),
    UNIQUE(project_id,module_code,sequence_no),
    UNIQUE(project_id,filename),
    UNIQUE(project_id,node_id),
    FOREIGN KEY(project_id,module_code) REFERENCES project_modules(project_id,module_id) DEFERRABLE INITIALLY DEFERRED,
    CHECK(doc_type ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CHECK(module_code ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CHECK(topic_code ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CHECK(length(filename) <= 255)
);

DROP TRIGGER IF EXISTS trg_document_identity_immutable ON dq_document_identities;
CREATE TRIGGER trg_document_identity_immutable BEFORE UPDATE OR DELETE ON dq_document_identities
FOR EACH ROW EXECUTE FUNCTION dq_reject_history_mutation();

ALTER TABLE dq_artifact_versions ADD COLUMN IF NOT EXISTS document_identity_id UUID GENERATED ALWAYS AS ((payload->>'document_id')::UUID) STORED;
DO $$ BEGIN
    IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='dq_artifact_versions'::regclass AND conname='fk_artifact_document_identity') THEN
        ALTER TABLE dq_artifact_versions ADD CONSTRAINT fk_artifact_document_identity
        FOREIGN KEY(project_id,document_identity_id) REFERENCES dq_document_identities(project_id,sys_id) ON DELETE RESTRICT;
    END IF;
END $$;
