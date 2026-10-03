# DBA 列顺序速查表 (Column Ordering Quick Reference)

本文件是 `dba-review` 技能审查建表 SQL 时的核心参照物。

## 强制列顺序规范

所有新建或修改的数据库表，字段排列**必须**遵循以下语义分组顺序：

| 顺序 | 分组名称 | 示例字段 |
|------|----------|----------|
| 1️⃣ | 主键与业务外键 (Identifiers) | `sys_id`, `project_id`, `issue_id` |
| 2️⃣ | 基础信息 (Basic Info) | `name`, `identifier`, `subject` |
| 3️⃣ | 核心配置与载荷 (Core Config / Payload) | `query_sql`, `params_json`, `template_code` |
| 4️⃣ | 权限与可见性 (Access Control) | `is_public`, `owner_id`, `visibility` |
| 5️⃣ | 状态机与版本计数 (Version & State) | `current_version`, `is_active`, `execution_count` |
| 6️⃣ | 追踪审计字段 (Audit Trail) — **必须垫底** | `created_by`, `created_at`, `updated_at` |

## 违规示例 vs 正确示例

```sql
-- ❌ 违规：审计字段出现在中间，载荷字段散落
CREATE TABLE rpt_templates (
    sys_id UUID PRIMARY KEY,
    created_at TIMESTAMPTZ,     -- 审计字段不应出现在此
    name VARCHAR(200),
    query_sql TEXT,
    is_public BOOLEAN,
    updated_at TIMESTAMPTZ      -- 审计字段不应出现在此
);

-- ✅ 正确：严格遵循语义分组顺序
CREATE TABLE rpt_templates (
    sys_id UUID PRIMARY KEY,           -- 1️⃣ Identifiers
    name VARCHAR(200),                 -- 2️⃣ Basic Info
    query_sql TEXT,                    -- 3️⃣ Core Config
    is_public BOOLEAN DEFAULT FALSE,   -- 4️⃣ Access Control
    current_version INTEGER DEFAULT 1, -- 5️⃣ Version & State
    created_by VARCHAR(100),           -- 6️⃣ Audit Trail
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
);
```

## 主键选型速查

| 表类型 | 主键命名 | 数据类型 |
|--------|----------|----------|
| 业务实体表 (issues, projects 等) | `sys_id` | `SERIAL` |
| 日志/审计/订阅等非业务表 | `sys_id` | `UUID` |
