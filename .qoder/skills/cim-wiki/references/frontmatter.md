# Wiki 页面编译规范（Stage 5）

> 迁移自 `internal/pipeline/compiler/compiler.go`。

## 目录映射（type → data/wiki/ 子目录）

| 节点类型 | 子目录 | 文件名示例 |
|----------|--------|-----------|
| business_rule | business/ | br-wip-001.md |
| business_object | business/ | bo-wip-001.md |
| workflow | business/ | wf-wip-001.md |
| api | apis/ | api-wip-ui-001.md / api-int-plm-001.md |
| design | designs/ | des-wip-001.md |
| module | modules/ | mod-wip-001.md |
| requirement / project | requirements/ | req-wip-001.md |
| test_case | tests/ | tc-trackin-001.md |
| release | releases/ | rel-mes-001.md |
| deployment | deployments/ | dep-custa-001.md |
| incident / defect | incidents/ | inc-wip-001.md |
| faq / knowledge_article / 其他 | knowledge/ | kn-wip-001.md |

标准子目录全集：`products, projects, requirements, designs, modules, business, apis, tests, releases, deployments, operations, incidents, knowledge, sources, virtual`。

**文件名规则**：ID 转小写，非 `[a-z0-9-]` 字符替换为 `-`，连续 `-` 合并，首尾去 `-`，加 `.md`。

## 页面模板

```markdown
---
id: BR-WIP-001
type: business_rule
# 仅 api 类型追加以下字段：
# api_type: ui_api | external_integration
# integration_tier: engineering | business | automation | quality | logistics
# integration_system: Siemens_Teamcenter
# isa95_mapping: ProcessSegment / ProductDefinition
# endpoint: "POST /api/v1/wip/lots/track-in"
# protocol: HTTP/REST
product: Semiconductor-MES
version: V5.2
domain: manufacturing-execution
module: wip-management
source: data/raw/wip/idd_wip_v5.2.md
related_requirements:
  - "[[requirements/req-wip-001.md]]"
related_rules:
  - "[[business/br-wip-002.md]]"
related_code:
  - "com.fab.mes.wip.service.impl.TrackInServiceImpl#processLotTrackIn"
related_tests:
  - "[[tests/tc-trackin-001.md]]"
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

路径：`data/wiki/virtual/<module>-<sdd|idd>.md`。
Frontmatter 追加 `virtual: true` 与 `module`。正文按以下顺序缝合该模块原子节点（strip 掉各自 frontmatter，节点间以 `---` 分隔）：

- **SDD 视图**：模块概述(modules) → 架构设计(designs) → 业务流程(business/wf) → 需求(requirements)
- **IDD 视图**：业务对象(business/bo) → 业务规则(business/br) → UI 接口(apis, api_type=ui_api) → CIM 集成接口(apis, api_type=external_integration，按 tier 1→5 排序)

页首注明「Auto-generated from atomic wiki nodes」与渲染时间。
