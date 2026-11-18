-- Project code repository configuration.
ALTER TABLE project_repos ADD COLUMN source_type TEXT NOT NULL DEFAULT 'git' CHECK(source_type IN ('git','svn'));
ALTER TABLE project_repos ADD COLUMN source_subpath TEXT NOT NULL DEFAULT '';
ALTER TABLE project_repos ADD COLUMN revision_selector TEXT NOT NULL DEFAULT 'HEAD';
ALTER TABLE project_repos ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE project_repos ADD COLUMN config_revision INTEGER NOT NULL DEFAULT 1 CHECK(config_revision>0);
UPDATE project_repos SET revision_selector=CASE WHEN branch<>'' THEN branch ELSE 'HEAD' END;
