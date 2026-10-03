---
name: dba-review
description: 执行数据库设计规范审查
---

# 数据库设计与查询审查 (DBA Review)

本技能以项目 DBA 的视角，对涉及新增数据库表、修改表结构（Schema）或新编写的复杂 SQL 查询和存取代码进行规范审查。

## 审查检查点 (DBA Checkpoints)

1. **主键与 ID 类型选型**
   - 所有数据库表的主键命名，是否严格统一定义为 `sys_id`。
   - 数据类型审查：业务实体表是否正确使用了 `SERIAL`；而日志、审计、订阅等非业务强关联表是否正确使用了 `UUID`。

2. **列顺序逻辑 (Column Ordering 高内聚原则)**
   - 拒绝随意丢弃的字段排列，建表 SQL 必须满足系统要求的语义分组顺序（详见 `dba-review/references/column-ordering-standard.md`）：
     1. 主键与业务外键（Identifiers）
     2. 基础信息（Basic Info）
     3. 核心配置与载荷（Core Config / Payload）
     4. 权限可见性（Access Control）
     5. 状态机与计数（Version & State）
     6. **最后垫底**：追踪审计字段（`created_by`, `created_at`, `updated_at`）。

3. **数据读取规范 (Dictionary Cursor 铁律)**
   - 审查所对应的 Python 处理脚本。当使用字典游标时，**绝对禁止**代码中使用物理索引（如 `row[0]`, `row[1]`）去读取执行结果，必须使用确切列名 `row['column_name']`。
   - 要求所有聚合查询必须在 SQL 使用 `AS alias_name` 并在应用代码中对应获取。

## 数据库设计规范详述

### 主键命名
- 所有表主键统一使用 `sys_id`

### ID 类型选择
| 类型 | 使用场景 |
|------|----------|
| `SERIAL` | 业务实体表（如主数据、交易数据等） |
| `UUID` | 日志表、订阅表、审计表等需要全局唯一标识的场景 |

**Why:** 统一规范便于 ORM 映射和跨表查询，UUID 适用于分布式场景。

### 列顺序设计规范 (Column Ordering)
**原则**：列顺序应基于**业务用途和逻辑关系**进行高内聚分组（语义紧密型），而非单纯追求物理存储字节对齐。

**标准分组推荐顺序**：
1. **主键与业务标识 (Identifiers)**: `sys_id` (PK), `xxx_id` (业务外键) 等
2. **基础信息 (Basic Info)**: `name`, `description`, `title`, 维度属性等
3. **核心配置与负载 (Core Config/Payload)**: `query_params`, `display_config`, `content` 等
4. **权限与可见性 (Access Control)**: `is_public`, `allowed_users` 等
5. **版本与动态状态 (Version & Dynamic State)**: `current_version`, `status`, `run_count`, `last_run_at` 等
6. **审计追踪 (Audit)**: `created_by`, `created_at`, `updated_at` (统一置于表尾作为兜底)

### 游标使用示例

**正确示例**：
```python
# 正确 - 使用列名
row = cur.fetchone()
count = row['count']
total = row['total_members']
status = row['status']
```

**错误示例**：
```python
# 错误 - 禁止使用索引
row = cur.fetchone()
count = row[0]  # KeyError!
total = row[1]  # KeyError!
status = row[2] # KeyError!
```

**SQL 别名建议**：
```python
cur.execute("""
    SELECT COUNT(*) AS cnt, MAX(updated_at) AS last_update
    FROM table_name
""")
row = cur.fetchone()
count = row['cnt']
last_update = row['last_update']
```

## 输出动作
对于投喂的建表脚本和应用侧代码，一旦发现违规，直接出具 **DBA 驳回报告**（参见 `dba-review/assets/dba-review-report-template.md`），并提供重新排版、重构完备的标准 SQL / Python 代码供替换。
