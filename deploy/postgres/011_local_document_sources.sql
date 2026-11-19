-- Local files are explicit evidence, never invented Git/SVN revisions.
-- Projects with configured repositories continue to require repository evidence.
ALTER TABLE dq_ingest_runs ALTER COLUMN source_id DROP NOT NULL;
ALTER TABLE dq_ingest_runs ALTER COLUMN source_config_id DROP NOT NULL;
ALTER TABLE dq_source_versions ALTER COLUMN source_id DROP NOT NULL;
ALTER TABLE dq_ingest_runs ADD CONSTRAINT dq_ingest_run_source_kind CHECK (
  (COALESCE(payload->>'source_type','svn') = 'local_file' AND source_id IS NULL AND source_config_id IS NULL)
  OR (COALESCE(payload->>'source_type','svn') IN ('git','svn') AND source_id IS NOT NULL AND source_config_id IS NOT NULL)
);
ALTER TABLE dq_source_versions ADD CONSTRAINT dq_source_version_source_kind CHECK (
  (COALESCE(payload->>'source_type','svn') = 'local_file' AND source_id IS NULL)
  OR (COALESCE(payload->>'source_type','svn') IN ('git','svn') AND source_id IS NOT NULL)
);
CREATE UNIQUE INDEX uq_dq_local_source_identity ON dq_source_versions(project_id,run_id,(payload->>'repository_path')) WHERE payload->>'source_type'='local_file';
