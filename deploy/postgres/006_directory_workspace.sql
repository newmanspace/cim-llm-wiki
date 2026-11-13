-- Persist directory names and append-only maintenance history.
DROP INDEX IF EXISTS uq_dq_directory_path;
CREATE UNIQUE INDEX uq_dq_directory_path ON dq_directories(project_id,(payload->>'path')) WHERE COALESCE(payload->>'deleted','false') <> 'true';
CREATE TABLE IF NOT EXISTS dq_directory_events (
 sys_id SERIAL PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
 payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),
 directory_id INTEGER GENERATED ALWAYS AS ((payload->>'directory_id')::INTEGER) STORED NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 created_by TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(project_id,sys_id),
 FOREIGN KEY(project_id,directory_id) REFERENCES dq_directories(project_id,sys_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_dq_directory_events_directory ON dq_directory_events(project_id,directory_id);
CREATE TRIGGER trg_dq_directory_events_immutable BEFORE UPDATE OR DELETE ON dq_directory_events FOR EACH ROW EXECUTE FUNCTION dq_reject_history_mutation();

CREATE OR REPLACE FUNCTION initialize_document_directories(project_key TEXT)
RETURNS void LANGUAGE SQL AS $$
 INSERT INTO dq_directories(project_id,payload,created_by)
 SELECT project_key,jsonb_build_object('path',path,'display_name',name),'system:project-initialization'
 FROM (VALUES
 ('doc','产品文档'),('code','代码契约'),
 ('doc/00-overview','产品总览'),('doc/10-planning','产品规划'),('doc/20-architecture','系统架构'),
 ('doc/30-standards','工程规范'),('doc/40-requirements','业务需求'),('doc/50-designs','设计方案'),
 ('doc/60-test','测试验证'),('doc/70-release','版本发布'),('doc/80-deploy','部署运维'),
 ('doc/90-guides','使用指南'),('doc/99-templates','文档模板')
 ) AS defaults(path,name) ON CONFLICT DO NOTHING;
$$;
SELECT initialize_document_directories(id) FROM projects;
UPDATE dq_directories SET payload=payload || jsonb_build_object('display_name',
 CASE payload->>'path'
 WHEN 'doc' THEN '产品文档' WHEN 'code' THEN '代码契约'
 WHEN 'doc/00-overview' THEN '产品总览' WHEN 'doc/10-planning' THEN '产品规划'
 WHEN 'doc/20-architecture' THEN '系统架构' WHEN 'doc/30-standards' THEN '工程规范'
 WHEN 'doc/40-requirements' THEN '业务需求' WHEN 'doc/50-designs' THEN '设计方案'
 WHEN 'doc/60-test' THEN '测试验证' WHEN 'doc/70-release' THEN '版本发布'
 WHEN 'doc/80-deploy' THEN '部署运维' WHEN 'doc/90-guides' THEN '使用指南'
 WHEN 'doc/99-templates' THEN '文档模板'
 ELSE regexp_replace(payload->>'path','^.*/','') END)
 WHERE NOT (payload ? 'display_name');
