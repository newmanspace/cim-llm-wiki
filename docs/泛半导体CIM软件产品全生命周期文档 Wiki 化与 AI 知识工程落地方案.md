# **企业软件产品全生命周期文档 Wiki 化与 AI 知识工程落地方案**

在半导体制造执行系统（MES）等高度复杂、高强工艺约束的工业软件研发与交付过程中，企业通常积累了海量的文档与代码资产。然而，由于资料分散在项目管理、需求定义、系统设计、源代码、测试验证、版本发布、现场部署与运维故障等不同阶段，知识碎片化、版本冲突、重复描述以及“代码与设计脱节”等问题极其严重。传统的检索增强生成（RAG）方案在面对此类长链路、强关联的工业软件资产时，极易因文档切片丢失上下文，导致 AI Agent 产生严重幻觉。  
本方案拒绝将项目简单定义为“文档转 Markdown”或“搭建 RAG 知识库”，而是聚焦于“企业软件产品全生命周期知识工程”**。同时，依托**计算机集成制造（CIM）的整体视图，将 MES 定位为制造信息流的核心枢纽，针对传统知识工程中“AI 要求的原子化碎片”与“人类习惯的聚合化长文”之间的深层矛盾，重构了 **“编译存储原子化（面向 AI），视图审核聚合化（面向 人）”** 的核心机制，并将外部系统集成（PLM/ERP/QMS/EAP）划分为清晰的分层集成架构，实现高可靠、可追溯的产品知识闭环。

## **1\. 总体工程目标与流水线设计**

本方案的目标是将企业在长期项目交付中积累的“隐形项目经验”转化为“显性产品资产”，彻底打通研发与交付全流程的知识孤岛。系统不以文档行数或文件数量为中心，而是以产品知识对象（Product Knowledge Objects）为中心，实现从原始非结构化数据到 Agent 可消费知识网络的自动化提炼。  
整体知识处理流水线（Pipeline）设计如下：  
`原始资料 ↓ 智能解析 ↓ 知识抽取 ↓ 知识评估 ↓ 视图聚合审核(HITL) ↓ Wiki知识编译 ↓ 知识关联 ↓ Hybrid Retrieval ↓ AI Agent / Copilot`

该流水线通过以下几个阶段顺序推进并形成闭环：

> 1. **智能解析（Parse & Normalize）**：多模态剥离版面噪音，保留复杂表格与排版。  
> 2. **知识抽取与解构（Extract & Classify）**：将 SDD/IDD 等长篇文档解构为业务对象、规则矩阵、UI/分层集成 API 及代码映射。  
> 3. **知识评估与冲突检测（Assess & Detect）**：计算可解释质量得分，识别多版本或跨文档矛盾。  
> 4. **视图聚合审核网关（Aggregated HITL Review）**：以“变更提案包（Change Bundle）”与“虚拟合成视图”的形式推送到专家工作台，阻断分散审核难题。  
> 5. **Wiki 知识编译（Wiki Compile）**：自动编译生成原子化 Markdown 页面与 YAML Frontmatter，建立双向链接。  
> 6. **动态关联与巡检（Link & Lint）**：建立全生命周期追溯网络，定期执行 12 维知识质量巡检。  
> 7. **混合检索与 Agent 赋能（Hybrid Retrieval & Agent）**：提供基于意图识别与元数据过滤的精准知识供给。

## **2\. 全生命周期知识源与对象建模**

### **2.1 全生命周期知识源覆盖**

方案完整覆盖半导体 MES 软件从项目立项到现场运维的 8 大类核心知识来源：

> 1. **项目管理**：项目计划、周报、会议纪要、风险登记册、问题跟踪表、项目总结报告。  
> 2. **需求定义**：客户原始需求、产品需求（PRD）、需求规格说明书、需求变更单、验收标准。  
> 3. **系统设计**：SDD 概要设计、IDD 详细设计、架构设计、数据库 ER 图与脚本、API 接口规范（UI 接口与 CIM 分层集成接口）、技术方案。  
> 4. **软件开发**：源代码、模块与类映射、函数与方法业务逻辑、Module 依赖、接口实现、SQL 查询、配置文件、Git Commit 日志、Release 版本分支。  
> 5. **测试验证**：测试计划、测试用例（Manual/Auto）、测试执行结果、测试报告、缺陷记录（Bug）、性能测试报告。  
> 6. **发布部署**：Release Note、安装部署手册、环境配置规范、数据库升级/回滚脚本、配置参数说明。  
> 7. **项目实施**：客户实施方案、系统配置表、数据初始化脚本、二次开发定制文档、上线方案、培训材料、验收报告。  
> 8. **现场运维**：运维手册、FAQ、故障案例分析（Incident）、性能优化记录、应急预案、客户问题工单。

### **2.2 基于“产品知识对象”的核心知识模型**

方案摒弃“按文件类型分类”的传统模式，建立面向对象的知识模型。整个 Wiki 系统围绕 19 类核心知识对象（Object Types）构建：  
Product | Version | Project | Requirement | Module | Business Object | Business Rule | Workflow | Design | API | Code | Test Case | Defect | Release | Deployment | Configuration | Incident | FAQ | Knowledge Article  
这些知识对象在生命周期中形成**正向追溯**与**反向追溯**的双向图谱链条：

> * **正向追溯链**： Project ↓ Requirement ↓ Design ↓ Code ↓ Test ↓ Release ↓ Deployment ↓ Incident ↓ Knowledge  
> * **反向追溯链**： Knowledge ↓ Incident ↓ Release ↓ Test ↓ Code ↓ Design ↓ Requirement

| 知识对象类型 (Type) | 业务含义与边界 | 典型来源输入 | 代表性关联关系 |
| :---- | :---- | :---- | :---- |
| **Requirement** | 描述 MES 软件“应该做什么”的功能与非功能约束 | PRD、需求规格说明书、客户变更单 | implements\_in: Design, verified\_by: Test Case |
| **Design** | 描述系统“如何实现”的架构与模块逻辑 (来自 SDD) | 概要设计说明书 (SDD)、架构设计 | realized\_by: Code, satisfies: Requirement |
| **Business Rule** | 描述 MES 软件内部的判定矩阵与 Guard 逻辑 (来自 IDD) | 详细设计说明书 (IDD)、业务规则说明 | enforced\_in: API, validated\_by: Test Case |
| **API** | 服务于 UI 交互的内部接口与 CIM 分层外部集成接口 | IDD 详细设计说明书、接口规范文档 | exposes: Code, enforces: Business Rule |
| **Code** | 实际运行的 MES 软件工程代码索引（非全文） | 代码类、函数/方法、API 服务接口 | implements: Design, tested\_by: Test Case |
| **Incident** | 现场生产线或测试阶段出现的真实故障与异常 | 缺陷记录、运维工单、事故分析 | caused\_by: Defect, resolved\_by: Knowledge |

## **3\. Wiki 目录架构、分层设计与 CIM 集成接口分类**

### **3.1 人类友好与机器可读分离的扁平目录**

Wiki 目录设计遵循“**人类阅读简洁扁平，机器理解依靠元数据与链接**”的原则。在目录划分上，重点引入 modules/（宏观模块驾驶舱）与 business/（微观业务领域模型）的分层机制：  
`wiki/`  
`├── products/       # 产品线与主版本概览`  
`├── projects/       # 具体交付项目与客户定制记录`  
`├── requirements/   # 模块化需求项（REQ）`  
`├── designs/        # 架构设计与概要设计（原 SDD 宏观解构）`  
`├── modules/        # 模块总入口页（模块驾驶舱，聚合关联对象）`  
`├── business/       # 微观业务领域模型资产（原 IDD 规则/对象解构）`  
`│   ├── bo-*.md     # 业务对象（Business Objects，如 Wafer Lot、Carrier）`  
`│   ├── br-*.md     # 业务规则（Business Rules，如状态校验判定矩阵）`  
`│   └── wf-*.md     # 业务流程（Workflows，如标准 TrackIn 流程）`  
`├── apis/           # API 接口定义页（明确区分 UI 接口与 CIM 分层集成接口）`  
`├── tests/          # 测试用例与测试集`  
`├── releases/       # 版本发布记录与 Release Notes`  
`├── deployments/    # 客户部署配置与脚本指南`  
`├── operations/     # 运维手册与 SOP`  
`├── incidents/      # 真实故障案例与缺陷分析`  
`├── knowledge/      # 从项目中提炼的产品通用知识与 FAQ`  
`└── sources/        # 原始文档解析后的 AI 摘要存根`

### **3.2 CIM 框架下的 MES API 分层分类定义**

在 MES 知识工程中，API 接口严格划分为两大类，并对外部集成接口按照 CIM 体系进行层级拆解：

> 1. **UI 交互接口（ui\_api）**：  
   * MES 提供给前端 Web UI、PDA 移动端或工位看板调用的内部接口（如批次进站渲染、Hold 弹出框校验）。  
> 2. **外部系统集成接口（external\_integration）**：  
   * 基于 CIM/ISA-95 集成规范，划分为 5 个具体的集成层级（Integration Tiers）：

| CIM 集成层级 (Integration Tier) | 对接外部系统类型 | 交互业务内容与场景 | 典型接口规范 / 对齐标准 |
| :---- | :---- | :---- | :---- |
| **Tier 1: 工程/工艺设计集成** | **PLM / CAPP** | 接收产品 BOM、工艺路线 (Route)、Recipe 规范、ECO 工程变更单 | 对齐 ISA-95 Part 2 产品定义与 ECO 变更规范 |
| **Tier 2: 经营管理/计划集成** | **ERP** | 接收主生产计划、工单 (Work Order) 下发、物料主数据；反馈完工与消耗 | 对齐 ISA-95 B2MML (Business to Manufacturing) |
| **Tier 3: 工厂自动化集成** | **EAP (设备自动化)** | 触发 Recipe 加载指令、响应 EAP 事件上报、下发 Dispatch 派工指令 | 基于 HTTP/gRPC/MQTT 报文（不含设备低层通信协议） |
| **Tier 4: 质量与统计分析集成** | **QMS / SPC / YMS** | 接收质量异常 HOLD 指令、同步 SPC 越界事件、提供良率分析基础数据 | 质量事件与抽检（Inspection）数据映射规范 |
| **Tier 5: 仓储与物流自动化集成** | **WMS / AGV / MCS** | 发起线边仓物料领用、搬运任务请求、FOUP 载具位置更新 | 仓储物料与物流搬运请求规范 |

### **3.3 统一 YAML Frontmatter 规范（含 CIM 属性定义）**

所有编译到 wiki/ 目录下的 Markdown 文件必须包含标准化的 YAML Frontmatter。

#### **样例 1：UI 交互接口 YAML (wiki/apis/api-wip-trackin-ui.md)**

`---`  
`id: API-WIP-UI-001`  
`type: api`  
`api_type: ui_api               # 明确分类：UI 交互接口`  
`product: Semiconductor-MES`  
`version: V5.2`  
`domain: manufacturing-execution`  
`module: wip-management`  
`endpoint: "POST /api/v1/wip/lots/track-in"`  
`protocol: HTTP/REST`  
`source: raw/designs/idd_wip_interfaces_v5.2.pdf`  
`related_rules:`  
  `- "[[business/br-wip-002.md]]"`  
`related_code:`  
  `- "[[code/cls-TrackInController.md]]"`  
`---`

#### **样例 2：CIM 外部集成接口（PLM 工艺集成）YAML (wiki/apis/api-plm-route-sync.md)**

`---`  
`id: API-INT-PLM-001`  
`type: api`  
`api_type: external_integration # 明确分类：外部系统集成接口`  
`integration_tier: engineering  # CIM 层级：工程/工艺设计集成 (PLM/CAPP)`  
`integration_system: Siemens_Teamcenter # 对接外部系统`  
`isa95_mapping: ProcessSegment / ProductDefinition`  
`product: Semiconductor-MES`  
`version: V5.2`  
`domain: system-integration`  
`module: plm-adapter`  
`endpoint: "POST /api/v1/integration/plm/routes/sync"`  
`protocol: Webhook/REST`  
`source: raw/designs/idd_plm_integration_v5.2.pdf`  
`related_requirements:`  
  `- "[[requirements/req-plm-route-sync.md]]"`  
`---`

## **4\. 文档智能解析与 SDD/IDD 解构编译机制**

### **4.1 传统 SDD/IDD 文档的解构映射策略**

半导体 MES 领域的研发习惯将知识集中于长篇 SDD（概要设计）与 IDD（详细设计）中。系统通过 AI 编译流水线将其自动“解构”并分流到 Wiki 体系中：

| 传统文档中的具体章节内容 | LLM Wiki 编译解构形态 | 目标 Wiki 目录路径 |
| :---- | :---- | :---- |
| **SDD**：模块功能概述、组件架构、模块依赖 | **模块驾驶舱/总入口页** | wiki/modules/ |
| **SDD**：系统架构图、技术方案、扩展性设计 | **系统设计/架构页** | wiki/designs/ |
| **SDD**：端到端跨模块业务时序图、主流程 | **业务流程页 (Workflow)** | wiki/business/wf-\*.md |
| **IDD**：Web/PDA 前端调用的 RESTful API 说明 | **UI 交互接口定义页** | wiki/apis/ (api\_type: ui\_api) |
| **IDD**：PLM/ERP/QMS 等对接报文与协议定义 | **CIM 分层集成接口定义页** | wiki/apis/ (api\_type: external\_integration) |
| **IDD**：数据字典、ER 图、数据库表结构 | **业务对象页 (Business Object)** | wiki/business/bo-\*.md |
| **IDD**：业务校验规则、决策矩阵、错误码 | **业务规则页 (Business Rule)** | wiki/business/br-\*.md |

### **4.2 文档处理工具链与适用场景**

> * **MinerU**：负责包含复杂表格、数学公式、双列排版的 SDD/IDD 设计说明书。  
> * **Docling**：负责标准 DOCX、PPTX、HTML 格式的 PRD 与需求文档。  
> * **OCR (Paddle/Tesseract)**：负责历史扫描件、现场 SOP 截图。  
> * **LLM 结构化抽取**：基于 JSON Schema 从解析后的 Markdown 中抽取实体、规则矩阵及 Frontmatter。

### **4.3 阶梯式可解释质量评估**

评估模型通过加权求和计算文档与知识片段的综合价值得分：  
Score \= \\sum\_{i=1}^{7} w\_i \\cdot S\_i  
评估因子包含：来源可信度 (S\_{\\text{auth}})、内容完整性 (S\_{\\text{comp}})、产品相关性 (S\_{\\text{rel}})、时效性 (S\_{\\text{fresh}})、结构质量 (S\_{\\text{struct}})、可复用性 (S\_{\\text{reuse}}) 与 冲突风险 (S\_{\\text{risk}})。  
**工程注意**：权重配置（如初始 w\_{\\text{auth}}=0.2, w\_{\\text{risk}}=0.2 等）作为 POC 初始参数，必须通过真实样本库与人工标注的 Golden Dataset 进行回归校对。

> * **High Value (Score \\ge 0.80)**：自动触发编译入库。  
> * **Medium Value (0.55 \\le Score \< 0.80)**：推送到聚合审核网关。  
> * **Low Value (Score \< 0.55)**：归档保存（Archive），不编译入主干。

## **5\. 关键节点人（HITL）“视图聚合化”协同审核与审计流水线**

针对“AI 要求的原子化碎片（br-\*.md, api-\*.md）导致人类专家逐页审核极度分散、认知疲劳”的严重工程痛点，本方案确立了核心架构原则：**“编译存储原子化（面向 AI），视图审核聚合化（面向 人）”**。专家绝对不需要遍历几十个 Markdown 节点，而是通过以下四套聚合控制机制完成高效校验。

### **5.1 聚合式变更提案机制（Batch Change Bundle / PR 模式）**

当系统读取并解析一份新的 SDD 或 IDD 文档时，底层虽解构出 10\~15 个原子 Wiki 节点，但在审核工作台上，系统将本次解析涉及的所有修改加工成一份统一的“变更决策卡片（Change Bundle）”。

#### **聚合审核卡片样例：CR-20260920-001 \[IDD V5.2 状态变更模块解析提案\]**

> * **源文档**：idd\_wip\_interfaces\_v5.2.pdf（调出原件对比）  
> * **解构影响**：影响模块 wip-management；提取规则 3 条（新增 2，冲突 1）；关联更新 UI 接口 1 个。  
> * **重点审核项（Diff 聚合高亮）**：

| 校验类型 | 提取项目 | Wiki 既有版本 (V5.1) | AI 拟更新提案 (V5.2) | 风险判定 | 专家操作 |
| :---- | :---- | :---- | :---- | :---- | :---- |
| **新增规则** | BR-WIP-003 | *无* | 进站前必须检查 Carrier 载具状态 | 低风险 | \[ \] 勾选确认 |
| **冲突规则** | BR-WIP-001 | HOLD 状态允许强行 TrackIn | **禁止强行进站！** 必须先解挂 | **高风险 (冲突)** | **\[待选择\]** 保留旧版 / 覆盖新版 |
| **UI 接口** | API-WIP-UI-001 | 请求体无 carrier\_id | 新增必填字段 carrier\_id | 中风险 | \[ \] 勾选确认 |

> * **专家决策**：\[一键批准并发布全组\] | \[修正冲突项后批准\] | \[驳回整个文档\]

### **5.2 SDD/IDD “动态虚拟合成视图”（Virtual Document View）**

为了满足专家阅读连贯长文档的习惯，系统基于 related\_\* 索引链提供“虚拟合成长视图”：

> * **底层存储**：wiki/business/br-\*.md 与 wiki/apis/api-\*.md 保持独立的原子化存储。  
> * **合成渲染**：专家点击 wiki/modules/wip-management.md 页面上的 **“生成完整 SDD/IDD 视图”**，系统按“1. 模块概述 2\. 业务规则 3\. UI接口 4\. CIM外部集成”等传统目录实时缝合渲染出长文档。  
> * **Diff 渲染**：合成视图中用红色标注“将被替换的旧规则”，用绿色标注“新 IDD 提炼的新规则”，专家可直接在长视图中批注。

### **5.3 基于风险等级的例外拦截与分级控制（Exception-Based Review）**

系统不应进行无差别的繁重审核，而是基于后果边界实施分级拦截：

> 1. **自动发布区（L0 免审）**：置信度 Confidence \\ge 0.95、无语法错误且**未对既有业务规则产生修改/冲突**的新增 UI API 节点或 FAQ，系统直接自动入库（零人工干预）。  
> 2. **增量聚焦区（L1 专家审）**：系统自动屏蔽 90% 未变动的规则，仅将产生增量变更、规则更新或冲突警告（Contradiction Tag）的 10% 提炼为卡片推送给领域专家。  
> 3. **架构师裁决区（L2 升级审）**：涉及半导体制造核心业务逻辑（如 Hold/Release 状态机校验、QTime 约束）变更或外部 PLM/ERP 关键集成接口变动，自动升级至主系统架构师裁决。

### **5.4 Git 事务性批处理提交与一键回滚（Atomic Commit & Rollback）**

> * **原子提交**：当专家在聚合卡片上点击“批准”时，系统在后台执行一次性原子 Commit： git commit \-m "feat(wip): batch update from IDD\_v5.2 by @david.po (CR-20260920-001)" 同时更新该提案涉及的所有原子 Markdown 文件。  
> * **一键回滚**：若事后发现某次 SDD/IDD 解析有误，专家直接在控制台找到该 CR 记录点击“撤销”，系统自动执行 git revert，整体将涉及的所有原子 Wiki 节点安全回滚。全过程保留审计日志（Reviewer, Timestamp, Diff, Comments）。

## **6\. 全生命周期知识关联与代码知识工程化**

### **6.1 跨生命周期知识穿透实例**

以 MES 核心的“进站卡批（TrackIn）”为例，系统通过对象关联将分散在各个阶段的资产串联成完整网络：  
`需求：[REQ-001 TrackIn]`   
  `↓ (implements_in)`  
`设计：[TrackIn SDD Engine Design]`   
  `↓ (enforces)`  
`规则：[BR-WIP-002 TrackIn Validation Matrix (IDD)]`   
  `↓ (realized_by)`  
`代码：[TrackInServiceImpl]`   
  `↓ (exposes)`  
`API：[/api/v1/wip/lots/track-in (UI API)]`   
  `↓ (verified_by)`  
`测试：[TC-TRACKIN-001]`   
  `↓ (included_in)`  
`版本：[MES Release V5.2]`   
  `↓ (deployed_at)`  
`部署：[Customer A V5.2 Deployment]`   
  `↓ (triggered)`  
`故障：[BUG-123 TrackIn Timeout Incident]`   
  `↓ (crystallized_to)`  
`经验：[TrackIn 高并发超时处理 FAQ]`

当运维工程师面对 BUG-123 时，Agent 可顺藤摸瓜直接定位到对应的实现代码、IDD 中的业务规则、UI/集成 API 定义、测试用例及部署配置。

### **6.2 代码知识的工程化管理策略**

**方案严禁将源代码全文复制并堆砌进 Wiki 页面**。代码管理策略为：**“代码留在 Git，Wiki 建立轻量级索引与图谱映射”**。

> 1. **静态结构化索引**：使用 Tree-sitter / LSP / Code Parser 提取 Repository、Module、Package、Class、Method/Function、Controller/Handler 及 Git Commit。  
> 2. **实现证据（Implementation Evidence）**：在 Wiki 的 apis/ 或 business/ 页面中，仅嵌入代码索引引用：  
   * **Repository**: mes-backend-core  
   * **Module/Class**: com.fab.mes.wip.service.impl.TrackInServiceImpl  
   * **Key Method**: processLotTrackIn(TrackInRequestDTO dto)  
   * **Git Ref**: commit 8f3a12b (tag: v5.2.0)  
> 3. **应用价值**：证明需求/规则已真正代码化，辅助变更时的**影响分析（Impact Analysis）**。

## **7\. 混合检索架构与周期性 Lint 质量治理**

### **7.1 面向 Agent 的混合检索流水线**

`User Query ↓ Intent Detection ↓ Metadata Filter ↓ Wiki Navigation ↓ BM25 + Vector Search + Relationship Search ↓ Source Verification ↓ LLM Answer`

> 1. **Intent Detection**：判定意图（如“排查前端 500 报错”、“查找 PLM 工艺路线同步接口”、“追溯进站校验规则”）。  
> 2. **Metadata Filter**：基于 YAML 元数据硬过滤（如限定 product: MES，version: V5.2，及 integration\_tier: engineering）。  
> 3. **Wiki Navigation**：优先调取 wiki/modules/ 驾驶舱页定位目标路径。  
> 4. **Hybrid Search**：BM25（精准错误码/API） \+ Vector Search（语义） \+ Relationship Search（沿 related\_\* 穿透）。  
> 5. **Source Verification**：对检索到的片段与 sources/ 原始凭证进行版本与真实性校验。  
> 6. **LLM Answer**：合成回答，强制包含：\[结论\] \+ \[来源出处\] \+ \[适用版本\] \+ \[关联规则/API\] \+ \[关联代码/测试\]。

### **7.2 周期性 12 维 Lint 质量治理机制**

后台 Agent 定期执行 Lint 巡检，扫描并解决知识库的“腐烂”问题：

| Lint 检查规则类型 | 扫描逻辑与判定标准 | AI 自动处置建议 | 人工干预边界 |
| :---- | :---- | :---- | :---- |
| **1\. Broken Link** | 检出指向不存在路径的 \[\[wikilink\]\] | 自动定位重命名文件并修正路径 | 无需人工 |
| **2\. Orphan Knowledge** | 检出孤立页面（无 incoming/outgoing 引用） | 推荐挂载的父模块或驾驶舱节点 | 人工确认挂载 |
| **3\. Duplicate Knowledge** | 两页面语义重合度 Cosine \> 0.90 | 生成合并提案与 Diff 卡片 | 需人工确认合并 |
| **4\. Version Conflict** | 同一概念在不同版本页面中规则机制冲突 | 标记 Contradiction Tag | 触发 HITL 裁决 |
| **5\. Req without Design** | 状态为 Published 的需求无相关设计关联 | 提示“设计缺失” | 通知架构师 |
| **6\. Req without Test** | 需求/规则缺乏关联的测试用例 | 标记“测试覆盖缺口” | 通知测试负责人 |
| **7\. Rule without Code** | IDD 中的业务规则缺乏代码实现映射 | 扫描 Git 提取对应验证方法 | 人工确认映射 |
| **8\. API without Test** | 已发布的 UI 或 CIM 集成 API 缺失测试用例 | 自动生成默认测试用例草稿 | 测试工程师审核 |
| **9\. Release without Deploy** | 已发布版本缺乏客户现场部署记录 | 标记部署文档缺失 | 实施团队补全 |
| **10\. Outdated Knowledge** | verified\_at 超过 365 天未更新 | 降低置信度，发起复审提醒 | 专家重新核验 |
| **11\. Missing Source** | Wiki 页面缺少 sources/ 溯源依据 | 标红警告“不可信知识” | 补全源文件或删除 |
| **12\. Metadata Error** | YAML Frontmatter 不符合 Schema | 根据正文内容自动补齐标准元数据 | 无需人工 |

## **8\. 技术架构选型与 Agent 接口标准**

### **8.1 技术架构选型**

> * **解析引擎**：MinerU（复杂 PDF/表格/公式） \+ Docling（DOCX/PPTX/标准文档）。  
> * **代码解析**：Tree-sitter / Language Server Protocol (LSP) / Code Parser / Git CLI。  
> * **知识存储与版本控制**：Markdown \+ YAML Frontmatter \+ Git 仓库。  
> * **搜索引擎**：BM25 (Meilisearch/ElasticSearch) \+ 向量数据库。  
> * **向量数据库**：首选 **Qdrant**（原生支持极其丰富的 Payload Metadata 过滤，完美匹配 YAML 属性）；备选 Milvus / PGvector。  
> * **图结构策略**：**优先选用“Markdown Links \+ Metadata Index”模式**。仅当节点数突破 10 万级且多跳图查询出现性能瓶颈时，再同步导入 Graph DB。

### **8.2 Agent 通信协议（MCP / REST API）**

向 MES AI Agent / Copilot 开放的标准化 MCP 工具接口：

> 1. **SearchKnowledge(query, filters)**：基于元数据硬过滤与向量语义的混合检索（支持按 api\_type: ui\_api 或 integration\_tier: engineering/business/quality 过滤）。  
> 2. **GetKnowledgeNode(id)**：精准获取特定 Wiki 节点的 Markdown 与 Frontmatter。  
> 3. **GetVirtualDocument(module\_id, doc\_type)**：调取按传统 SDD/IDD 格式动态合成的长文档视图。  
> 4. **GetSourceEvidence(source\_path)**：调取 sources/ 原件片段进行交叉核对。  
> 5. **GetRelatedNodes(id, relation\_type)**：沿正向或反向追溯链拓扑节点。  
> 6. **AnalyzeImpact(node\_id)**：输入需求/规则变更点，递归输出受影响的设计、UI/CIM 集成 API、代码类、测试用例及客户列表。

## **9\. 工程化 POC 实施方案与 Golden Dataset 评估体系**

### **9.1 POC 验证范围与落地设计**

> * **样本规模**：100\~500 份真实项目文档 \+ 关联后端代码库。  
> * **试点模块**：MES 核心“在制品管理与进站卡批（WIP & TrackIn/TrackOut）”与“PLM/ERP 集成适配”模块。  
> * **输入资产**：PRD、SDD、IDD、后端源码、测试用例、 Release Note、部署配置及故障工单。  
> * **POC 核心产出**：  
  1. 自动化解构 SDD/IDD，生成 modules/ 驾驶舱与 business/ 规则节点网络，精准区分 UI 接口与 CIM 分层集成接口。  
  2. 演示“聚合审核卡片（Change Bundle）”与“虚拟合成长视图”的专家审核流程。  
  3. 展示从“外部 PLM 工艺变更同步异常”到“IDD 规则与代码实现精准追溯”的 Copilot 交互 Demo。

### **9.2 基于 Golden Dataset 的量化验收指标**

| 评估维度 | 细分量化指标 | POC 阶段验收标准 | 最终产品化标准 |
| :---- | :---- | :---- | :---- |
| **文档解析 (Parse)** | Parse Success Rate (解析成功率) | \\ge 90\\% | \\ge 98\\% |
|  | Table Preservation (复杂表格还原率) | \\ge 85\\% | \\ge 95\\% |
| **知识解构 (Extract)** | Rule Matrix Precision (规则矩阵提取准确率) | \\ge 85\\% | \\ge 93\\% |
|  | CIM Tier Classification Precision (CIM 集成层级分类准确率) | \\ge 90\\% | \\ge 98\\% |
| **知识关联 (Link)** | Req → Design/Rule Recall (需求-规则召回率) | \\ge 85\\% | \\ge 95\\% |
|  | Rule → Code Recall (规则-代码关联召回率) | \\ge 75\\% | \\ge 90\\% |
| **混合检索 (Retrieval)** | Recall@K (K=5) | \\ge 85\\% | \\ge 95\\% |
|  | Precision@K (K=5) | \\ge 80\\% | \\ge 90\\% |
| **Agent 问答 (Agent)** | Answer Accuracy (回答准确率) | \\ge 80\\% | \\ge 92\\% |
|  | Hallucination Rate (幻觉率) | \\le 8\\% | \\le 2\\% |
| **工程效率 (Efficiency)** | 专家审核耗时降低率 (对比逐页审核) | 降低 75\\% | 降低 85\\% |
|  | 新员工知识 onboarding 周期 | 缩短 40\\% | 缩短 70\\% |

## **10\. 四阶段实施路线图与企业级落地方略**

`Phase 1: 知识盘点与模式奠基 (Month 1-2)`  
  `├── 资产梳理：全量清洗项目管理、需求、SDD/IDD、代码等历史资料`  
  `└── 标准制定：确立 YAML Schema、分类标签体系（明确 ui_api 与 CIM 分层集成接口）`

`Phase 2: SDD/IDD 解构与 POC 验证 (Month 3-4)`  
  `├── 试点运行：运行 WIP 及 PLM/ERP 集成模块 POC，跑通文档解构与 Wiki 编译`  
  `└── 机制搭建：上线“聚合变更卡片”与“虚拟合成视图”审核工作台`

`Phase 3: 全生命周期关联与 Lint 激活 (Month 5-6)`  
  `├── 关系打通：构建 Requirement → Rule → UI/CIM Integration API → Code → Incident 全链关联`  
  `└── 巡检运行：激活周期性 12 维 Lint 自动化治理与冲突预警`

`Phase 4: Agent 产品化深度赋能 (Month 7+)`  
  `├── 接口开放：向研发 Copilot、运维 Agent 暴露 MCP/API 接口`  
  `└── 机制持续：建立基于 Git 的批处理事务提交与全员知识复用文化`

### **总结**

本方案通过“编译存储原子化，视图审核聚合化”的技术突破，完美弥合了 AI Agent 对精准解构节点的依赖与人类专家对连贯聚合视图需求之间的矛盾。同时，基于 **CIM（计算机集成制造）** 的集成思想，将 MES 外部接口细分为 5 个清晰的工程/业务集成层级（Tier 1\~5），使 MES 软件全生命周期知识库既保持了自身产品研发链路的纯粹性，又具备了与外部 CIM 生态无缝挂钩的能力，为企业软件资产复用与 AI 赋能奠定了坚实的技术底座。