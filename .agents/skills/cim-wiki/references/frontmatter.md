# Wiki 页面编译规范（Stage 5）

> 迁移自 `internal/pipeline/compiler/compiler.go`。

## 目录映射（type → 双平面物理分库）

wiki 物理分两库：`data/wiki/doc/`（领域知识库，面向人与高层业务导航）与 `data/wiki/code/`（代码契约库，面向工程实现与自动化编译）。compile.mjs 按下表路由并在 Frontmatter 写入 `plane: doc|code`（validate `plane_mismatch` 校验落点）。

| 节点类型 | 落点 | 文件名示例 |
|----------|------|-----------|
| business_rule（功能契约 contract，带 applies_to） | code/rules/ | br-wip-001.md |
| business_rule（业务规则 business_rule） | doc/business/ | br-wip-001.md |
| business_object（Domain Card） | code/domain/ | bo-wip-001.md |
| frd（功能需求文档，旧称 workflow/scenario，含 What-Next 分支表） | doc/business/ | frd-wip-001.md |
| api | code/apis/ | api-wip-ui-001.md / api-int-plm-001.md |
| data_schema（物理表结构） | code/schemas/ | ds-wip-001.md |
| data_dictionary（数据字典/ER mapping） | doc/dictionaries/ | dd-wip-001.md |
| code_index（代码索引） | code/code-index/ | ci-wip-001.md |
| design | doc/designs/ | des-wip-001.md |
| module | doc/modules/ | mod-wip-001.md |
| requirement / project | doc/requirements/ | req-wip-001.md |
| test_case | doc/tests/ | tc-trackin-001.md |
| release / deployment / incident / faq 等 | doc/ 下同名目录 | rel-mes-001.md |

平面目录全集：`doc/{manuals,business,designs,modules,requirements,dictionaries,tests,releases,deployments,operations,incidents,knowledge,products,projects,sources,virtual}`、`code/{domain,apis,rules,schemas,code-index}`。

**wikilink 一律带平面前缀**：`[[code/apis/api-int-eap-001.md]]`、`[[doc/business/frd-wip-001.md]]`；跨平面双向引用合法。compile 自动规范化旧无前缀链接。

**文件名规则**：ID 转小写，非 `[a-z0-9-]` 字符替换为 `-`，连续 `-` 合并，首尾去 `-`，加 `.md`。

## 页面模板

```markdown
---
id: BR-WIP-001
type: business_rule
plane: code   # compile 按双平面路由自动写入：doc | code
# 仅 api 类型追加以下字段：
# api_type: ui_api | external_integration
# integration_tier: engineering | business | automation | quality | logistics
# integration_system: Siemens_Teamcenter
# isa95_mapping: ProcessSegment / ProductDefinition
# endpoint: "POST /api/v1/wip/lots/track-in"
# protocol: HTTP/REST
# 仅 api（api card v1）追加以下字段：
# operation: MoveInReservation        # vocabulary.md Operation 枚举，lint 校验
# transaction_code: ODIS0001          # 事务码；全局唯一，compile 登记 data/documents/api-registry.json
# domain_objects:                     # 操作的领域对象名列表
#   - "Equipment"
# preconditions:                      # 生效校验规则卡 wikilink；无前置时正文槽位写 None
#   - "[[code/rules/br-eqp-001.md]]"
# scenario_variants:                  # 调用场景变体（如 B2B Operation 名）
#   - "Offline-1 Case"
# content 槽位模板见 extraction.md「api 结构化模板」
# 仅 frd（功能需求文档，旧称 workflow/scenario card）追加以下字段：
# pattern: linear | what-next-driven  # what-next-driven 必须含 What-Next Branches 分支表
# content 槽位模板见 extraction.md「frd 结构化模板」
# 仅 business_rule（rule card v2）追加以下字段：
# rule_type: contract | business_rule   # contract=功能契约（带 applies_to，入 code/rules/）；business_rule=业务规则（入 doc/business/）
# severity: Critical | High | Medium | Low    # Critical 强制 L2_arch 人审
# rule_category: vocabulary.md 登记的 Rule Category 枚举值
# verification_status: AI-Candidate | Human-Verified | Deprecated   # 由 review_level 派生，非独立状态机
# applies_to:                         # 规则生效接口（rule → api 图闭合），元素必须是 api 卡 wikilink
#   - "[[code/apis/api-int-eap-001.md]]"
# content 采用固定槽位模板（见 extraction.md「business_rule 结构化模板」）
# 仅 business_object（domain card v1）追加以下字段：
# domain_object: Equipment          # 核心领域对象名
# primary_key: EquipmentId          # 主键（AI 实体解析键）
# rule_tags: [STATE, RECIPE, …]     # 必须是 vocabulary.md Rule Category 枚举
# synthesized: true                 # 跨文档聚合卡；source 可为列表；默认 L2_arch 人审
# content 槽位模板见 extraction.md「business_object 结构化模板」
product: Semiconductor-MES
version: V5.2
domain: manufacturing-execution
module: wip-management
source: data/raw/wip/idd_wip_v5.2.md
related_requirements:
  - "[[doc/requirements/req-wip-001.md]]"
related_rules:
  - "[[code/rules/br-wip-002.md]]"
related_code:
  - "com.fab.mes.wip.service.impl.TrackInServiceImpl#processLotTrackIn"
related_tests:
  - "[[doc/tests/tc-trackin-001.md]]"
# 代码证据（可选，严禁贴源代码全文）：
# code_repository: mes-backend-core
# code_class: com.fab.mes.wip.service.impl.TrackInServiceImpl
# code_method: processLotTrackIn(TrackInRequestDTO dto)
# git_ref: commit 8f3a12b (tag: v5.2.0)
confidence: 0.8320
review_level: L1_expert
status: published        # draft | published | archived
reviewer: zhangsan       # 经审核的节点必填
review_note: "..."       # 可选
created_at: 2026-10-01T08:00:00Z
updated_at: 2026-10-01T08:00:00Z
---

# <节点标题>

<节点 Markdown 正文>

---
> **来源文档**: `data/raw/wip/idd_wip_v5.2.md`
> **置信度**: 83.20%
> **适用版本**: V5.2
```

## 状态流转

- 新编译且经审核通过 → `status: published`，填 `reviewer`
- L0 自动发布 → `status: published`，`reviewer: auto`
- 被后续版本覆盖的旧页 → `status: archived`（不删除，保留追溯）

## 虚拟长文档（合成视图）

路径：SDD 视图 `data/wiki/doc/virtual/<module>-sdd.md`；IDD 视图 `data/wiki/code/virtual/<module>-idd.md`。
Frontmatter 追加 `virtual: true` 与 `module`。正文按以下顺序缝合该模块原子节点（strip 掉各自 frontmatter，节点间以 `---` 分隔）：

- **SDD 视图**（doc）：模块概述(doc/modules) → 架构设计(doc/designs) → 业务流程(doc/business/wf) → 需求(doc/requirements)
- **IDD 视图**（code）：业务对象(code/domain/bo) → 功能契约与业务规则(code/rules/br 功能契约 + doc/business/br 业务规则) → UI 接口(code/apis, api_type=ui_api) → CIM 集成接口(code/apis, api_type=external_integration，按 tier 1→5 排序) → 数据 Schema(code/schemas) → 数据字典(doc/dictionaries)

页首注明「Auto-generated from atomic wiki nodes」与渲染时间。
