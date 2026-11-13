# 知识抽取规范（Stage 2）

> 迁移自 `internal/pipeline/extractor/extractor.go` 与方案文档 §2/§3/§4.1。

## 角色设定

你是专业的半导体 MES 软件知识工程师，擅长解构 SDD/IDD 设计文档。从文档内容中提取所有知识节点，输出带 schema_version、bundle_id、project 和 nodes 的 Bundle 对象。

## 项目术语与命名

业务术语用于解释概念、别名和命名习惯，以绑定项目已确认的术语表、数据字典或用户明确指定的资料为依据，保留来源、版本和适用范围。当前 `context` 没有专门的项目术语表配置或返回字段，不能假定接口已提供这些资料。

没有术语资料时保留原文用语并标记待确认；资料冲突时记录各自来源，不自行裁定统一含义。展示名称、代码标识和缩写分别遵循项目约定，不套用其他项目的默认规则。需要补充术语时写入项目已确认的资料目录，不写入可分发的 Skill、模板或示例。

项目资料中的产品、客户、版本、人员及内部路径仅在授权范围内使用。业务术语解释含义，节点受控枚举限定结构化字段允许值；枚举读取方式见[服务调用契约](service-api.md#受控枚举与机器契约)，两者不能相互替代。

## 节点字段示例

以下为字段说明，不是可执行的 JSON Schema。机器契约由服务端 context 接口提供（服务内部位于 `contracts/wiki/v1/`），Bundle 必须声明 `schema_version: "1.0"`、`bundle_id`、`project` 和 `nodes`。类型、字段、正文及关联关系均接受严格校验，不能以本说明替代机器门禁。

```json
{
  "id": "TYPE-DOMAIN-SEQ，如 BR-WIP-001、API-INT-PLM-001",
  "type": "business_rule | business_object | frd | api | design | module | requirement | test_case | incident | faq | release | deployment | knowledge_article | data_schema | data_dictionary | code_index",
  "rule_type": "仅 business_rule：business_rule（业务规则/全局政策，入 doc）| contract（功能契约/接口校验，带 applies_to，入 code）；缺省按是否带 applies_to 判定",
  "title": "简洁标题",
  "content": "完整 Markdown 内容（原子化，一个节点只讲一件事）",
  "product": "产品名称，默认 Semiconductor-MES",
  "version": "版本号，如 V5.2，缺省 v1.0",
  "domain": "业务域，如 manufacturing-execution / system-integration",
  "module": "模块名（用户指定或从文档推断）",
  "confidence": 0.0-1.0,
  "source": "shared://team/<project>/parsed/<version>/document.md",
  "source_location": {"sheet": "实际工作表（可选）", "cells": "实际单元格范围（可选）"},
  "api_type": "仅 api 类型：ui_api | external_integration",
  "integration_tier": "仅外部集成 api：engineering(PLM/CAPP) | business(ERP) | automation(EAP) | quality(QMS/SPC/YMS) | logistics(WMS/AGV/MCS)",
  "integration_system": "仅外部集成 api：对接系统，如 Siemens_Teamcenter",
  "endpoint": "仅 api：如 POST /api/v1/wip/lots/track-in",
  "protocol": "仅 api：HTTP/REST | Webhook/REST | gRPC | MQTT",
  "operation": "仅 api（api card）：context.vocabulary.operation 中的受控业务动作",
  "transaction_code": "仅外部集成 api：事务码，如 ODIS0001；全局唯一（compile 写入 data/documents/api-registry.json）",
  "domain_objects": ["仅 api：操作的领域对象名列表，如 [\"Equipment\", \"ControlJob\"]"],
  "preconditions": ["仅 api：生效校验规则的 wikilink 列表，如 [[business/br-wip-001.md]]；无前置时正文槽位显式写 None"],
  "scenario_variants": ["仅 api：调用场景变体名列表，如 B2B Operation 名 \"Offline-1 Case\""],
  "pattern": "仅 frd（功能需求文档，旧称 workflow/scenario）：linear | what-next-driven",
  "related_requirements": ["[[requirements/req-xxx.md]]"],
  "related_designs": ["[[designs/des-xxx.md]]"],
  "related_rules": ["[[business/br-xxx.md]]"],
  "applies_to": ["仅 business_rule（rule card）：规则生效的接口 wikilink 列表（rule → api，图闭合用）"],
  "related_apis": ["[[apis/api-xxx.md]]"],
  "related_code": ["[[code/cls-xxx.md]]"],
  "related_tests": ["[[tests/tc-xxx.md]]"],
  "code_repository": "代码证据（可选）：仓库名",
  "code_class": "代码证据（可选）：完整类路径",
  "code_method": "代码证据（可选）：关键方法签名",
  "git_ref": "代码证据（可选）：commit/tag"
}
```

## ID 前缀规范

| 类型 | 前缀 | 示例 |
|------|------|------|
| business_rule | BR | BR-WIP-001 |
| business_object | BO | BO-WIP-001 |
| frd | FRD | FRD-WIP-001 |
| api（UI） | API-{DOMAIN}-UI | API-WIP-UI-001 |
| api（外部集成） | API-INT-{SYSTEM} | API-INT-PLM-001 |
| design | DES | DES-WIP-001 |
| module | MOD | MOD-WIP-001 |
| requirement | REQ | REQ-WIP-001 |
| test_case | TC | TC-TRACKIN-001 |
| incident | INC | INC-WIP-001 |
| faq / knowledge_article | KN | KN-WIP-001 |
| release | REL | REL-MES-001 |
| deployment | DEP | DEP-CUSTA-001 |
| data_dictionary（数据字典/ER） | DD | DD-WIP-001 |
| data_schema（物理表结构） | DS | DS-WIP-001 |
| code_index（代码索引卡） | CI | CI-WIP-001 |

SEQ 为三位数字，在同一文档批次内递增；DOMAIN 取模块名大写。

## 双平面物理分库（doc / code）

wiki 按消费对象物理分为两库，compile.mjs 按下表自动路由并写入 `plane` Frontmatter（validate 以 `plane_mismatch` error 校验落点）：

| 平面 | 定位 | 类型 → 目录 |
|------|------|-------------|
| `doc/` 领域知识库（Domain Wiki） | 面向人与高层业务导航，沉淀**描述性资产**（PRD、SDD、用户/系统管理手册、测试用例、运维 SOP、数据字典） | frd（功能需求文档，用例/流程级，旧称 workflow/scenario）与 business_rule(rule_type: business_rule) → `business/`；design → `designs/`；module → `modules/`；requirement → `requirements/`；data_dictionary → `dictionaries/`；test_case → `tests/`；release/deployment/incident/faq 等 → 同名目录；人读视图 → `manuals/`（大类 user-manual=用户手册 / admin-manual=系统管理手册） |
| `code/` 代码契约库（Code Wiki） | 面向工程实现与自动化编译，沉淀**物理契约与执行资产** | api → `apis/`；business_rule(rule_type: contract) → `rules/`；business_object（Domain Card）→ `domain/`；data_schema → `schemas/`；code_index → `code-index/` |

规则：
1. **业务规则与功能契约分治**：功能契约 = Conditions of the Service 类接口级校验，必带 `rule_type: contract` + `applies_to` 指向具体 api 卡（`code/rules/`）；业务规则 = 跨模块政策/invariant（`doc/business/`）。同一约束若两层都存在，业务规则卡与功能契约卡互链 `related_rules`。
2. **数据资产三层**：概念实体 = Domain Card（`code/domain/bo-*`，主键/状态机/Reasoning Hint）；概念模型 = 数据字典（`doc/dictionaries/dd-*`，ER mapping、实体-表-业务含义对照）；物理契约 = Schema（`code/schemas/ds-*`，表/字段/类型/键/值域）。三者用 wikilink 串联，不重复内容。
3. **wikilink 一律带平面前缀**：`[[code/apis/api-int-eap-001.md]]`、`[[doc/business/frd-wip-001.md]]`。跨平面双向引用合法且常见（api preconditions→规则卡；frd Steps→api 卡；ds→dd/bo）。compile 会把旧无前缀链接自动规范化，存量 bundle 无需手改。

## SDD/IDD 章节解构映射（方案 §4.1）

| 源文档章节内容 | 抽取为节点类型 |
|----------------|----------------|
| SDD：模块功能概述、组件架构、模块依赖 | module（模块驾驶舱页） |
| SDD：系统架构图、技术方案、扩展性设计 | design |
| SDD：端到端跨模块业务时序图、主流程 | frd |
| IDD：Web/PDA 前端调用的 RESTful API | api（api_type: ui_api） |
| IDD：PLM/ERP/QMS/EAP/WMS 对接报文与协议 | api（api_type: external_integration，必须给出 integration_tier） |
| IDD：数据字典、ER 图 | data_dictionary（doc/dictionaries，含 ER mapping）；其中核心实体另建 Domain Card（code/domain） |
| IDD：表结构、字段值域、键与索引 | data_schema（code/schemas） |
| IDD：业务校验规则、决策矩阵、错误码 | business_rule（绑定接口的功能契约 contract → code/rules；跨模块业务规则 → doc/business） |

## CIM 集成层级判定（方案 §3.2）

| Tier | integration_tier | 对接系统 | 典型内容 |
|------|------------------|----------|----------|
| 1 工程/工艺设计 | engineering | PLM / CAPP | BOM、工艺路线 Route、Recipe 规范、ECO |
| 2 经营管理/计划 | business | ERP | 主生产计划、工单下发、物料主数据、完工反馈 |
| 3 工厂自动化 | automation | EAP | Recipe 加载、设备事件上报、Dispatch 派工 |
| 4 质量与统计 | quality | QMS / SPC / YMS | 质量 HOLD、SPC 越界、良率数据 |
| 5 仓储物流 | logistics | WMS / AGV / MCS | 物料领用、搬运任务、FOUP 位置 |

## 用户手册版面模式抽取（章节编号式 user-manual）

| 版面模式 | 抽取方法 |
|----------|----------|
| **Conditions of the Service**（Check Item / Required Value 校验表） | 按行拆为独立 business_rule；每行 content 必须保留「校验对象 + 约束谓词 + 违反后果」三要素（如 `Reserved Control Job ID must be blank` → subject=Port, constraint=must_be_blank）；行内 "Refer to …" 交叉引用转为 `related_rules` wikilink，不复制被引内容；条件式规则（If…then…）整体保留谓词结构 |
| **Operation Flow**（时序表格：列=参与者泳道 IMS/EAP/TOOL/UI，行=消息事件，`(Transaction)` / `UI Operation` 列=语义标签） | 整表重建为一个 frd 节点（功能需求文档，旧称 workflow）的有序 steps（每步含 actor/action/transaction/ui_hint/B2B Operation 场景名）；每个事务码（如 ODIS0001、OEQP0001、move_in_reserve）单独抽为 api 节点（api_type=external_integration，integration_tier=automation，B2B Operation 名记为调用场景变体），由 frd 的 `related_apis` 引用。**解析注意**：markdown 表格导出会丢失箭头方向，时序判定只依赖行序 + 泳道列位置 + Transaction/UI Operation 文本列，不依赖箭头；原始时序截图由人读视图（manuals）承载，AI 侧不解读图片 |

## business_rule 结构化模板（rule card v2）

business_rule 节点的 content 采用固定分节模板（身份与元数据仍走 frontmatter，不重复进正文）：

```markdown
# <Name：一句话规则名>

## Statement
<规则的完整陈述，忠实原文语义>

## Preconditions
- <规则生效的前提>

## Constraint
<约束谓词：校验对象 + 条件表达式，如 "Recipe must be configured as an allowed Recipe for the target Equipment">

## Violation
<违反后果 + 执行点，如 "TrackIn / ProcessStart must be rejected">

## Related Operations
- <从 context.vocabulary.operation 选择的受控业务动作，非节点引用>

## Test Hint
- <正例 / 反例 / 边界，作为未来 test_case 种子>
```

frontmatter 新增字段（compile.mjs 已支持渲染）：

| 字段 | 含义 | 取值 |
|------|------|------|
| `severity` | 违反影响 | Critical / High / Medium / Low；**Critical 强制 L2_arch 人审** |
| `rule_category` | 规则切面（跨模块聚合用） | 从 context.vocabulary.category 读取允许值 |
| `verification_status` | 展示用核验状态 | 由 review_level 派生：待审=`AI-Candidate`，批准=`Human-Verified`，归档=`Deprecated`。**不是独立状态机**，审核流程仍以 status/review_level 为准 |
| `rule_type` | 双平面路由键 | `contract`=功能契约（接口级校验，入 `code/rules/`，应带 applies_to）；`business_rule`=业务规则（全局政策/invariant，入 `doc/business/`） |
| `applies_to` | 规则生效点（rule → api 图闭合） | 列表；元素必须是 api 节点 wikilink，如 `[[apis/api-int-eap-001.md]]`；一条规则可作用于多个接口 |

抽取纪律：
1. 槽位只填原文可支撑的内容；Violation 在原文未显式给出时不得臆造执行点，改填原文后果或省略并降低 confidence。
2. "规则涉及的其他对象/规则/接口"一律通过 `related_rules`/`related_apis`/`related_tests` wikilink 表达，禁止正文里造自由文本节点引用（lint 无法校验悬空引用）。
3. 多领域规则（如 Equipment+Recipe）：`domain` 取主域，其余关联走 related_* 链接。

## business_object 结构化模板（domain card v1）

核心领域对象（Equipment/Lot/Carrier/Recipe…）建立 domain card：一个对象一张卡，作为该对象全部规则的聚合枢纽（hub 页，豁免「一节点一知识」原子性检查）。跨文档聚合而成，`synthesized: true`，审核等级默认 **L2_arch**（Reasoning Hint 顺序错误会导致 AI 系统性误判）。落点 **`code/domain/`**（Code 契约库实体基座；人读概念视图由 `doc/dictionaries/` 数据字典承载）。

frontmatter 新增字段（compile.mjs 已支持渲染）：

| 字段 | 含义 |
|------|------|
| `domain_object` | 对象名，如 Equipment |
| `primary_key` | 主键（AI 实体解析键），如 EquipmentId |
| `rule_tags` | 列表；取值必须是 context.vocabulary.category 枚举 |
| `synthesized` | true 表示跨文档聚合卡 |

content 固定槽位（lint 校验存在性）：

```markdown
# Domain: <对象名>

## Description
<对象职责概述；动作类描述不写在这里，归 Related Operations>

## Identity
<主键/辅键；唯一性约束写成 "EquipmentId must be unique within Factory" 并链接对应 IDENTITY 规则>

## State Machine
| from | trigger | to | guard |
|------|---------|----|-------|
| OFFLINE | Register | IDLE | … |
禁止用 ASCII 箭头图画状态机（机器不可读）；完整状态迁移规则独立成 STATE 类 business_rule，此处放表 + wikilink。

## Attributes
| name | group | 值域/链接 |
|------|-------|-----------|
| EquipmentState | State | → 状态机规则节点 |
Capability 类属性并入本表（group=Capability），不单独成节。

## Relations
<subject —predicate→ object 三元组列表；predicate 必须是 context.vocabulary.relation 枚举；object 一律 wikilink>

## Reasoning Hint
<有序检查清单，每行：步骤 | 指向的 rule wikilink | reject/warn。这是 AI 排查"为什么不能执行"的决策链>

## Invariants
<摘要 + wikilink；每条 invariant 的完整定义是独立 business_rule，卡片不重复展开>

## Related Operations
<context.vocabulary.operation 中的受控动词；关联的流程/接口走 related_apis/related_rules>
```

抽取纪律：Rule Tags 与 rule card 的 `rule_category` 共用 context.vocabulary.category；动作和关系分别读取 context.vocabulary.operation 与 context.vocabulary.relation，不以 Skill 文本登记枚举。

## data_dictionary 结构化模板（dictionary card v1，doc/dictionaries）

数据字典是**概念层**人读+导航资产：整库/整模块的实体清单、ER 关系 mapping（实体 ↔ 表 ↔ 业务含义）、码表（Reference File）汇总。一模块一卡（hub 页）。

槽位：`## Overview`（范围与约定）→ `## Entities`（| 实体 | 对应表 | 业务含义 | Domain Card 链接 |）→ `## ER Mapping`（mermaid `erDiagram` 或关系表：实体 A —关系— 实体 B，谓词用 vocabulary Relation 枚举）→ `## Code Tables`（码表/参考清单及其值域规则链接）→ `## Change Discipline`（变更流程描述性说明）。

## data_schema 结构化模板（schema card v1，code/schemas）

物理契约资产：**一表一卡**。字段/类型/键/值域是自动化编译（DDL 校验、代码生成、契约测试）的输入。

槽位：
```markdown
# <表名：如 EQPT_MASTER>

## Mapping
| 概念实体 | 数据字典 | Domain Card |
|----------|----------|-------------|
| Equipment | [[doc/dictionaries/dd-sys-001.md]] | [[code/domain/bo-eqp-001.md]] |

## Fields
| 字段 | 类型/长度 | 空否 | 值域/码表 | 业务含义 |
|------|-----------|------|-----------|----------|
<逐字段；值域指向对应 IDENTITY/STATE 类规则卡或码表>

## Keys & Constraints
<主键、唯一键、外键、检查约束；每条约束链接对应 rule card>

## Referenced By
<引用本表的 api/scenario 卡 wikilink 列表>
```

纪律：Schema 卡只登记表级物理事实；实体的生命周期语义、状态机一律回链 Domain Card，不得复制。

## api 结构化模板（api card v1）

api 节点表达"一个可执行动作"= 前置条件 + 效果 + 错误，是 domain/rule 层与 scenario 层之间的可调用原子。外部集成事务（EAP 等）按**事务码一卡**；UI 接口按端点一卡。落点 **`code/apis/`**。

frontmatter 专有字段（compile.mjs 已支持渲染）：

| 字段 | 含义 |
|------|------|
| `operation` | 业务动作词，必须是 context.vocabulary.operation 枚举（lint 校验） |
| `transaction_code` | 事务码（如 ODIS0001）；**全局唯一**，compile 时登记 `data/documents/api-registry.json`，一码一卡冲突即拒绝入库 |
| `domain_objects` | 本动作直接操作的领域对象名列表（与 domain card 的 `domain_object` 对应） |
| `preconditions` | 生效校验规则卡 wikilink 列表；无前置须正文槽位显式写 `None`（lint 校验二者至少居一） |
| `scenario_variants` | 调用场景变体名（如 B2B Operation 名 "Offline-1 Case"），来自原文同一事务的不同执行场景 |

content 固定槽位：

```markdown
# <动作名：如 Move In Reservation>

## Purpose
<一句话：谁调用、做什么>

## Preconditions
- [[business/br-xxx.md]]
<每条校验条件指向 rule card；原文确无前置时填 "None"，禁止留空>

## Request
| param | 语义 | 值约束 |
|-------|------|--------|
只记参数语义与取值约束（指向 rule/对象卡），不贴报文全文。

## Effects
| subject | change |
|---------|--------|
| Equipment | IDLE → RESERVED |
| History | 新增事务记录 |
<成功后的状态变更与副作用，subject—change 形式；无状态变更的查询类接口写可观察输出>

## Errors
| code | 触发条件 | 调用方处理 |
|------|----------|------------|
<错误码表逐行抽取；触发条件指向对应 rule card wikilink>

## Related Scenarios
- [[business/frd-xxx.md]]
```

抽取纪律：
1. `operation` 必须出现在当前 context.vocabulary.operation 中；同一事务码承载多个业务动作时拆为多张 api 卡，不得一卡混装。
2. Preconditions 只接受 rule card wikilink；若校验条件尚无独立规则卡，先抽 business_rule 再引用（保持图闭合，禁止正文造自由文本引用）。
3. Effects 忠实原文状态机；原文未显式给出状态变更时写可观察结果（返回报文、落记录）并降低 confidence。

## frd 结构化模板（功能需求定义 FRD，Functional Requirement Definition，doc/business）

`frd`（功能需求定义，Functional Requirement Definition；旧称 workflow/scenario）定义业务功能规格与用例契约，**面向人类阅读并兼顾机器图谱索引**。必须严格遵循该类型的**生效模板**（按 `data/wiki/<project>/templates/` 项目自定义 > `data/wiki/templates/` 知识仓全局 > `assets/` 内置 解析，骨架模板见 [functional-requirement-template.md](../assets/functional-requirement-template.md)，完整业务工程样例见 [functional-requirement-example.md](../examples/functional-requirement-example.md)）进行结构化填充；抽取前调用 `scripts/client.mjs context --project <id>`，读取返回的 templates.frd 和 template_contracts.frd；模板自定义由服务端配置管理。

frontmatter 专有字段：`pattern`（`linear` | `what-next-driven`；what-next-driven 必含分支表）。

content 固定槽位（参考半导体 12 英寸制造厂《功能需求规格书》标准）：
1. `## 1. 概述 (Overview)`：
   - 1.1 业务背景与目标 (Objective)；
   - 1.2 功能范围 (Function Scope) 与边界 (In-Scope / Out-of-Scope)；
   - 1.3 系统集成范围与边界 (System Scope，MES/EAP/MCS/RTD/SPC 协作矩阵)；
   - 1.4 参考与关联文档 (Reference Documents)；
   - 1.5 用户需求跟踪清单 (User Requirement List)；
   - 1.6 术语与业务缩略词 (Terminology)；
   - 1.7 方案总体概述 (Solution Overview)。
2. `## 2. 需求场景与业务用例规格 (Requirement Scenario)`：
   - 2.1 业务场景描述 (Business Scenario，工艺背景、前置/后置条件与触发源)；
   - 2.2 流程时序与交互泳道 (Workflow & Sequence，Mermaid 时序与典型流转示例)；
   - 2.3 流程执行步骤汇总表（保留带 `(Steps)` 标记的真实编号标题及表格，含 Step, Actor, Action, Target / Transaction, Hint）；
   - 2.4 分支流程与异常决策表（保留带 `(What-Next Branches)` 标记的真实编号标题，what-next-driven 必填）；
   - 2.5 界面与数据项定义 (Data Items & UI Specification，数据项名称、字段标识、类型、值域、来源)；
   - 2.6 业务规则与卡控逻辑 (Business Rules & Validation Logic，时机、计算口径、前置防呆，对齐 `code/rules/`)；
   - 2.7 执行结果与状态流转 (Execution Results & State Transitions，记录生成、机台/Chamber/Header 状态机变迁矩阵)。
3. `## 3. 非功能性需求与系统约束 (Non-Functional Requirements)`：性能要求 (SLA)、并发幂等控制与全链路可追溯性。

## design 结构化模板（system design v2，doc/designs）

`design` 承载系统架构方案与模块设计说明书 (SDD)，**必须严格遵循 [design-template.md](../assets/design-template.md) 编写**。

content 固定槽位：
1. `## 1. 设计背景与业务诉求 (Background & Motivation)`：现状痛点、In-Scope 目标、Out-of-Scope 边界。
2. `## 2. 总体架构与系统上下文 (System Architecture & Context)`：Mermaid 上下文拓扑、核心组件职责矩阵（包含到对应驾驶舱 `[[doc/modules/mod-xxx.md]]` 的链接）。
3. `## 3. 详细设计与机制分析 (Detailed Design)`：Mermaid 数据流时序、核心机制剖析。
4. `## 4. 关键设计决策记录 (Architecture Decision Records - ADR)`：ADR 决策权衡（背景、备选方案、决策理由）。
5. `## 5. 非功能性考量与容错保障 (Non-Functional Requirements)`：高可用、容错、数据一致性。

## 模块与功能规格统一承载说明 (doc/business)

业务模块级与工序级的功能需求规格书统一使用 `frd` 模板（**[functional-requirement-template.md](../assets/functional-requirement-template.md)**）编写，原 `module-template.md`（驾驶舱模板）已全面被其包含并淘汰。

`functional-requirement-template.md` 提供结构骨架；具体章节、术语与业务约束以绑定项目已确认的资料为准：
1. **模块与功能矩阵层（原 module 能力）**：第 1 章节包含业务背景、功能范围与特性矩阵（Feature & Scenario Breakdown）、系统边界（System Scope）、用户需求跟踪清单与专业术语表。
2. **多场景规格层（FRD 核心能力）**：第 2 章节按特性编号下辖多个业务场景（Scenario），提供参与角色、核心业务步骤（Steps）、输入输出参数、卡控业务规则与异常分支处理。

抽取纪律：
1. **人读严谨性**：`doc/` 平面节点绝不可写成仅有十几行三元组的简陋机器打卡页，正文必须具备上下文阐述、图表展示与操作实操指导。
2. **图闭合约束**：正文中凡提及具体 API、规则、模块、领域实体，一律以 `[[plane/dir/file.md]]` 规范显式平面前缀链接。
3. **忠实原文与适度拓展**：基于源文档内容提取业务实质，补充规范的工程结构（如 Troubleshooting、ADR），不得凭空编造虚假业务参数。

## 抽取原则

1. **原子化**：一个节点只表达一条规则/一个对象/一个接口/一个流程。规则矩阵按行拆分为独立 business_rule。
2. **分块**：文档 >6000 字符时分块抽取，块间重叠 500 字符，防止跨块信息丢失；合并各块结果并去重（同 ID 同内容合并，同 ID 不同内容标记冲突）。
3. **忠实原文**：content 保留原文语义，可整理格式但不得臆造；拿不准就降低 confidence。
4. **代码不入 wiki**：涉及实现时只记录代码证据四元组（repository/class/method/git_ref），严禁复制源代码全文。
5. **溯源**：每个节点必须携带 source（解析存根路径）。
