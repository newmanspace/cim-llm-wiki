-- Git source identity uses repository URL and full commit SHA.
CREATE UNIQUE INDEX IF NOT EXISTS uq_dq_git_source_identity
ON dq_source_versions(project_id,source_id,(payload->>'repository_url'),(payload->>'repository_path'),(payload->>'commit_sha'))
WHERE payload->>'source_type' = 'git';
