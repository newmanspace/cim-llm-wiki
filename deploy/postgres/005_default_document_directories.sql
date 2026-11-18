-- Standard lifecycle directories from docs/doc/README.md.
-- Keep existing directories and policy overrides unchanged.
-- Empty projects remain removable; audit tables still restrict project deletion.
ALTER TABLE dq_directories DROP CONSTRAINT IF EXISTS dq_directories_project_id_fkey;
ALTER TABLE dq_directories ADD CONSTRAINT dq_directories_project_id_fkey
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION initialize_document_directories(project_key TEXT)
RETURNS void LANGUAGE SQL AS $$
    INSERT INTO dq_directories(project_id,payload,created_by)
    SELECT project_key,jsonb_build_object('path',path),'system:project-initialization'
    FROM (VALUES
        ('doc/00-overview'),
        ('doc/10-planning'),
        ('doc/20-architecture'),
        ('doc/30-standards'),
        ('doc/40-requirements'),
        ('doc/50-designs'),
        ('doc/60-test'),
        ('doc/70-release'),
        ('doc/80-deploy'),
        ('doc/90-guides'),
        ('doc/99-templates')
    ) AS defaults(path)
    ON CONFLICT DO NOTHING;
$$;

CREATE OR REPLACE FUNCTION initialize_new_project_directories()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM initialize_document_directories(NEW.id);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS project_default_document_directories ON projects;
CREATE TRIGGER project_default_document_directories
AFTER INSERT ON projects FOR EACH ROW
EXECUTE FUNCTION initialize_new_project_directories();

SELECT initialize_document_directories(id) FROM projects;
