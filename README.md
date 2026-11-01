# cim-llm-wiki

> **项目文档集契约**：所有项目必须配置 `data/wiki/<project>/document-contract.json`，声明必交文档、项目/模块数量、附加结构和关联要求；缺失即阻断。参见 [配置说明](docs/document-set-contract.md) 和 [MES 示例](contracts/wiki/examples/mes-document-contract.json)。

> **结构一致性更新（2026-10-28）**：统一契约位于 `contracts/wiki/v1/`，核心运行逻辑位于 `packages/wiki-core/`。所有现有和新增 Wiki 页面必须严格校验；编译先验证候选树，导航、构建和 GitOps 也执行门禁。Go 旧摄取/审核写入接口已停用，返回 410。首次在根目录执行 `npm ci`，详细规则与现有数据迁移要求见 [Wiki 结构一致性修正](docs/wiki-schema-enforcement.md)。

> **一句话**：Skill 驱动的泛半导体 CIM 文档知识工程流水线——原始文档（SDD/IDD/PRD/运维手册）经服务端解析、Agent 抽取与 7 维评分、HITL 聚合审核后，编译为 `data/wiki/` 双平面原子化知识库（`doc/` 领域知识 + `code/` 代码契约），用 VitePress 本地展示，并可经 Admin 管理台登记与知识库 GitOps 独立版本管理。

<p align="center">
  <a href="#"><img alt="Node.js" src="https://img.shields.io/badge/Node.js-%E2%89%A520-339933?style=flat-square&logo=nodedotjs&logoColor=white"></a>
  <a href="#"><img alt="VitePress" src="https://img.shields.io/badge/VitePress-1.x-646cff?style=flat-square"></a>
  <a href="#"><img alt="架构" src="https://img.shields.io/badge/架构-v2.1·Skill驱动·Admin·GitOps-b8863b?style=flat-square"></a>
  <a href="#"><img alt="解析引擎" src="https://img.shields.io/badge/解析引擎-MinerU·Docling·MarkItDown-0a7d6f?style=flat-square"></a>
</p>

<p align="center">
  <a href="#项目介绍">项目介绍</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#架构设计">架构设计</a> ·
  <a href="#功能概览">功能概览</a> ·
  <a href="#已落地内容">已落地内容</a> ·
  <a href="#项目结构">项目结构</a> ·
  <a href="#开发指南">开发指南</a> ·
  <a href="#扩展点">扩展点</a>
</p>

---

## 项目介绍

**cim-llm-wiki** 面向泛半导体 CIM/MES 软件产品的全生命周期知识工程：把团队分散的设计文档（SDD）、接口文档（IDD）、PRD 与运维手册汇集起来，解构为**原子化、可追溯**的知识节点，经质量评分与人工审核后沉淀为结构化 Wiki 知识库，并随资料更新持续维护。

与 v1「完整 Go 服务 + 内置 LLM 调用」不同，v2 转型为 **Skill 驱动的轻量工作流**：

- **LLM 智能环节由 Agent 直接完成**：知识抽取、7 维评分、Markdown 转换校验全部由 `cim-wiki` skill 按规范驱动执行，**无需外部 LLM API Key**。
- **skill 脚本统一 Node.js**：parse / compile / validate 均为 `.mjs`，与站点同栈。
- **本地不做任何文档解析**：所有版面解析引擎均为独立 Docker HTTP server（MinerU / IBM Docling / MarkItDown，对齐方案 §4.2），**无任何本地降级**——服务不可用即摄取失败。纯文本族（.md/.txt/.json/.yaml）由 Node 原生直读，属文件读取而非版面解析。

> 技术选型对比与 Phase 3 检索层建议见 [docs/TECH-STACK.md](docs/TECH-STACK.md)；v1→v2 架构转型全貌见 [docs/HANDOFF.md](docs/HANDOFF.md)。

---

## 快速开始

需要 [Node.js](https://nodejs.org/) ≥ 20、[Docker](https://www.docker.com/) 与 [Docker Compose](https://docs.docker.com/compose/)。

### 1. 安装依赖

```bash
npm install          # 仓库根执行
```

### 2. 启动解析引擎（首次需拉取镜像）

国内网络建议使用华为云 SWR 镜像 pull + tag：

```bash
# MinerU（复杂 PDF 主力）
docker pull swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/alexsuntop/mineru:3.4.2
docker tag  swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/alexsuntop/mineru:3.4.2 alexsuntop/mineru:3.4.2
# Docling（Office 主力）
docker pull swr.cn-north-4.myhuaweicloud.com/ddn-k8s/quay.io/docling-project/docling-serve:latest
docker tag  swr.cn-north-4.myhuaweicloud.com/ddn-k8s/quay.io/docling-project/docling-serve:latest \
            quay.io/docling-project/docling-serve:latest
```

```bash
cd deploy && docker compose up -d
```

一键拉起核心服务（Wiki 站点 + 流水线 API + 3 解析引擎；检索层为 Phase 3 预留）：

| 服务容器 | 内部/外部端口 | 角色与说明 |
|---------|-------------|-----------|
| `cim-wiki-wiki` | `:5174` | VitePress 知识库 Wiki 交互站点（对外访问） |
| `cim-wiki-server` | `:8080` | 5 阶段知识处理流水线 Go API 服务 |
| `cim-wiki-mineru` | `:8888` | 复杂 PDF 解析引擎（双栏/跨页表格/公式，SDD/IDD 主力） |
| `cim-wiki-docling` | `:5001` | DOCX/PPTX/XLSX/HTML 解析引擎（IBM 开源） |
| `cim-wiki-markitdown` | `:5002` | 备选服务端通用文档解析引擎（微软开源） |
| `cim-wiki-qdrant` | `:6333` | 向量检索（Phase 3 预留，通过 `--profile retrieval` 启用） |
| `cim-wiki-meili` | `:7700` | BM25 全文检索（Phase 3 预留，通过 `--profile retrieval` 启用） |

### 3. 摄取文档（Agent 会话）

```
用 cim-wiki 摄取 /path/to/idd_wip_v5.2.pdf，模块 wip-management
```

Agent 自动执行：解析 → 抽取 → 评分 → 呈现聚合审核卡片；你批准后，节点编译入 `data/wiki/` 并通过 Lint 校验。

### 4. 浏览知识库

```bash
cd wiki
npm run gen          # 仅扫描 data/wiki 刷新侧边栏与首页（.vitepress/sidebar-data.mjs）
npm run docs:dev     # 开发预览 http://localhost:5174（自动先执行 gen）
npm run docs:build   # 静态构建到 wiki/.vitepress/dist/（自动先执行 gen）
npm run docs:preview # 预览静态构建产物
```

---

## 架构设计

```
raw 原始文档（PDF/DOCX/MD）
      │
      ▼ [Stage 0] 项目配置拉取  ← skill scripts/admin-pull.mjs · sync-repo.mjs：从 Admin 拉 Project Registry（未配 ADMIN_URL=离线本地 registry）
      ▼ [Stage 1] 文档解析      ← skill scripts/parse.mjs：MinerU(:8888, PDF) / Docling(:5001, Office) / MarkItDown(:5002, 备选)，硬性依赖服务在线
      ▼ [Stage 1.5] 文档状态管控 ← skill scripts/doc-state.mjs：源文档 draft → frozen → active 漂移门禁
      ▼ [Stage 2] 知识抽取      ← Agent 按 skill references/extraction.md + assets/ 标准人读模板执行
      ▼ [Stage 3] 7 维评分      ← Agent 按 skill references/evaluation.md 执行
      ▼ [Stage 4] 聚合审核 HITL ← data/review/ 变更卡片 + 对话内用户裁决
      ▼ [Stage 5] Wiki 编译     ← skill scripts/compile.mjs：双平面写入 data/wiki/<project>/{doc,code}/（WIKI_GITOPS_ENABLED 时自动对独立知识仓 commit/push）
      ▼ [Stage 6] Lint 校验     ← skill scripts/validate.mjs
      ▼ [Stage 7] VitePress 展示 ← wiki/（srcDir 指向 data/wiki）
      ▼ [Stage 8] 状态回写      ← skill scripts/admin-client.mjs：编译/同步结果 POST 回 Admin（wiki-nodes / sync-status）
```

> 表中 `skill scripts/` 均位于 `.agents/skills/cim-wiki/scripts/`。各环节模块化解耦、组件可替换：解析引擎以独立 Docker server 形式插拔（Phase 2+ 可增 PaddleOCR），LLM 智能环节完全由 skill 规范（`references/*.md` + `assets/*.md` 模板）定义——改规范即改行为，存储层是 Markdown + YAML Frontmatter + Git（天然支持原子提交/回滚）。

### 用户意图路由

| 用户请求 | 执行阶段 |
|---------|---------|
| 摄取/解析某文档 | Stage 0→8 全流程 |
| 查看/审核待审变更包 | Stage 4（读 `data/review/pending/`） |
| 校验 wiki 质量 | 仅 Stage 6 |
| 展示/启动 wiki 站点 | 仅 Stage 7 |

---

## 功能概览

| 领域 | 要点 |
|------|------|
| 文档解析 | 按文件类型路由主力引擎（PDF→MinerU，Office→Docling）；`--engine` 可强制指定；MinerU 协议自适应（3.x `/file_parse` 同步 → V1 → 3.x 异步） |
| 知识抽取 | 长文档分块（>6000 字符，块间 500 字符重叠）；节点 ID 规范 `TYPE-DOMAIN-SEQ`；CIM 集成五层分类 |
| 质量评分 | 7 维加权：来源可信度 / 完整性 / 相关性 / 时效性 / 结构 / 复用 / 风险（反向） |
| 门限分级 | `L0_auto`(≥0.95) 免审发布 / `L1_expert`(≥0.80) 专家审 / `L2_arch`(≥0.55) 架构师裁决 / `archive`(<0.55) 归档 |
| HITL 审核 | 存储原子化、审核聚合化——一次文档生成一份 Change Bundle 卡片，绝不逐节点提问 |
| Wiki 编译 | nodes.json → 双平面 `data/wiki/<project>/{doc,code}/`，自动 YAML Frontmatter + 带平面前缀的 wikilink + 虚拟长文档合成 |
| Lint 校验 | Frontmatter 必填、文件名/ID 一致性、断链、孤立页、语义重复嫌疑、双平面路由 `plane_mismatch`、`transaction_code` 全局唯一、文档状态漂移 |
| 标准人读模板 | `assets/` 提供 frd（功能需求文档）/ design / module / user-manual 四类骨架，Stage 2 抽取时强制结构化填充，杜绝空洞提纲 |
| 自定义文档模板 | 模板纳入知识仓版本管理，按 **项目 `data/wiki/<project>/templates/` > 全局 `data/wiki/templates/` > skill 内置 `assets/`** 三级解析覆盖（`templates.mjs list/get/init/check [--project]`）；各级 `manifest.json` 声明 type→模板→必填槽位，新增类型无需改代码，Stage 6 Lint 按声明校验结构（`template_section_missing`） |
| 文档状态管控 | 源文档 `draft → frozen → active`，非 draft 内容 sha256 漂移即 `doc_drift` 阻断（Stage 1.5，`doc-state.mjs`） |
| Project Registry & Admin | 多项目登记（`project-registry.json`）+ TDesign 管理台（`admin/`）+ `project-token` 鉴权，Admin API + PostgreSQL 为可选在线后端 |
| GitOps 版本管理 | `compile.mjs` 编译后可对独立知识仓自动 `commit`/`push`（`WIKI_GITOPS_ENABLED`，env 未设=完全 no-op，失败仅告警不阻断） |
| 人读手册视图 | `gen-manuals.mjs <bundle.json>` 经统一严格门禁发布 `doc/manuals/` 用户/系统管理手册 |
| 展示 | VitePress 1.x，srcDir=data/wiki，本地全文搜索，零后端 |

### 节点类型 → 双平面目录映射

wiki 物理分库为两平面：**`doc/`（领域知识库，面向人与高层业务导航）** 与 **`code/`（代码契约库，面向工程实现与自动化）**。关联 wikilink 必须带平面前缀（如 `[[code/apis/api-int-eap-001.md]]`）。

| 节点类型 | 平面 / 目录 | 文件名示例 |
|----------|------------|-----------|
| api（ui_api & external_integration） | `code/apis/` | `api-int-eap-001.md` |
| 功能契约（`rule_type: contract`，带 `applies_to`） | `code/rules/` | `br-pipe-txcode-unique.md` |
| domain / business_object | `code/domain/` | `bo-*.md` |
| data_schema（物理表结构） | `code/schemas/` | `sch-*.md` |
| 代码索引 | `code/code-index/` | `ci-*.md` |
| frd（功能需求文档，含 What-Next 分支表，旧称 scenario/workflow） | `doc/business/` | `frd-wip-001.md` |
| 业务规则（`rule_type: business_rule`） | `doc/business/` | `br-wip-001.md` |
| design | `doc/designs/` | `des-wip-001.md` |
| module（驾驶舱） | `doc/modules/` | `mod-wip-001.md` |
| requirement / project | `doc/requirements/` | `req-wip-001.md` |
| data_dictionary（数据字典/ER mapping） | `doc/dictionaries/` | `dd-*.md` |
| test_case | `doc/tests/` | `tc-trackin-001.md` |
| 运维 SOP | `doc/runbooks/` | `rb-*.md` |
| 手册视图（user/admin-manual） | `doc/manuals/` | 由统一编译器发布已审核手册 Bundle |

> 另有 `doc/` 下 `products/`（产品线）、`projects/`（项目）、`releases/`、`deployments/`、`incidents/`、`knowledge/`、`sources/`（源文档索引）、`virtual/`（模块级 SDD/IDD 合成长视图）等目录，侧边栏标签见 `wiki/scripts/gen-sidebar.mjs` 的 `DIR_META`。

### 支持的解析引擎

| 引擎 | 形态 | 优势 | 适用 |
|------|------|------|------|
| **MinerU 3.4.2** | Docker server :8888 | 复杂工程 PDF 最强，表格/公式/双栏 | SDD/IDD 正式摄取 |
| **IBM Docling** | Docker server :5001 | Office 全格式，结构化好 | DOCX/PPTX/XLSX/HTML |
| **MarkItDown**（微软） | Docker server :5002 | 轻量 Office/PDF/HTML → MD | 备选服务端引擎 |
| **PaddleOCR / Surya** | 待接入 | 扫描件 OCR | Phase 2+ 历史扫描件 |

---

## 已落地内容

仓库已跑通 Stage 0→8 全流程，并具备多项目登记、Admin 管理台与知识库 GitOps 版本管理：

- **Project Registry + Admin 管理台**：`data/documents/project-registry.json` 多项目登记，`admin/`（TDesign Vue Next SPA）+ Go Admin API + PostgreSQL，`project-token`（`cimwt_...`）鉴权，网关统一登录门控 wiki/admin 访问。
- **wiki 产出**：`data/wiki/cim-llm-wiki/` 双平面共 **24** 个原子节点——`doc/`（需求/设计/模块/业务流程/数据字典等）+ `code/`（api 卡、功能契约、领域实体、schema、代码索引），首页与三棵树侧边栏由 `npm run gen` 自动生成，`gen-manuals.mjs <bundle.json>` 发布已审核人读手册。
- **知识库 GitOps 独立版本管理**（Issue #1）：`data/wiki/` 作为独立 git 仓库，`compile.mjs` 编译入库后可自动 `commit`（env 未设=完全 no-op），已对接私有知识仓 `newmanspace/cim-llm-wiki-knowledge`（main 分支），赋予版本追溯/diff/回滚，主仓仍因 `.gitignore` 忽略 `data/` 不被产物污染。
- **标准人读文档模板**：`assets/` 四类骨架（frd 功能需求文档/design/module/user-manual）纳入 Stage 2 抽取强约束，杜绝退化为空洞提纲。

> 试业务链路：用 cim-wiki skill 摄取一个 PDF/DOCX（如 `data/samples/idd_wip_sample.docx`，模块 `wip-management`），需先启动 MinerU/Docling 容器。

---

## 设计原则

- **编译存储原子化（面向 AI），视图审核聚合化（面向人）**：wiki 页面保持原子节点；审核走聚合变更卡片（Change Bundle）；阅读走 `virtual/` 合成长视图。
- **代码留在 Git，Wiki 只建索引**：严禁源代码全文入库，仅保留 repository/class/method/git_ref 证据。
- **门限分级**：L0(≥0.95) 自动发布 / L1(≥0.80) 专家审 / L2(≥0.55) 架构师裁决 / 其余归档。
- **保守打分**：拿不准的置信度打低，让门限机制去分流，绝不臆造关联关系；所有时间戳用 UTC ISO8601。

---

## 项目结构

```
cim-llm-wiki/
├── contracts/wiki/v1/           ← 版本化节点/Bundle/模板 Schema、目录与正文结构契约
├── packages/wiki-core/          ← 唯一编译、全库校验与发布实现（npm test / wiki:validate）
├── .agents/skills/cim-wiki/       ← ★ 核心：知识工程流水线 skill
│   ├── SKILL.md                  ← Stage 0→8 工作流定义（含引擎路由与命令）
│   ├── references/
│   │   ├── extraction.md         ← 知识抽取规范（节点 schema/ID/双平面/CIM 分层）
│   │   ├── evaluation.md         ← 7 维评分与门限规则
│   │   ├── frontmatter.md        ← wiki 页面编译规范与目录映射
│   │   └── vocabulary.md         ← 词表与卡片槽位约束
│   ├── assets/                   ← ★ 标准人读文档模板（frd 功能需求文档/design/module/user-manual 骨架）
│   └── scripts/
│       ├── parse.mjs             ← Stage 1 解析客户端（MinerU/Docling/MarkItDown，本地不做任何文档解析）
│       ├── doc-state.mjs         ← Stage 1.5 源文档 draft/frozen/active 状态门禁
│       ├── docstore.mjs          ← 文档源存储与 sha256 漂移检测
│       ├── compile.mjs           ← Stage 5 编译 nodes.json → 双平面 wiki 页面
│       ├── wiki-gitops.mjs       ← Stage 5 后置：独立知识仓自动 commit/push（env 驱动）
│       ├── validate.mjs          ← Stage 6 Lint 校验
│       ├── gen-manuals.mjs       ← 经统一编译门禁发布已审核手册 Bundle
│       ├── admin-client.mjs      ← Stage 8 状态回写客户端（pushWikiNodes/pushSyncStatus）
│       ├── admin-pull.mjs        ← Stage 0 从 Admin 拉取 Project Registry 配置
│       ├── sync-repo.mjs         ← Stage 0 代码仓增量同步与状态回写
│       └── templates.mjs         ← 文档模板自定义：解析(项目>全局>内置)/list/get/init/check [--project]
├── admin/                        ← ★ 管理台（TDesign Vue Next SPA：项目登记/Token/审核/进度）
├── scripts/
│   └── register-admin.mjs        ← 一次性 Admin 引导：登记项目/发 Token/同步 wiki 节点
├── wiki/                         ← ★ 独立 Wiki 知识库展示工程
│   ├── .vitepress/config.mjs     ← VitePress 站点配置（srcDir=../data/wiki）
│   ├── scripts/gen-sidebar.mjs   ← 扫描 data/wiki 自动生成侧边栏与首页
│   └── package.json              ← npm run gen / docs:dev / docs:build / docs:preview
├── .env.example                  ← 解析服务端点、Admin URL/Token、GitOps 开关等环境变量样例
├── docs/                         ← 本项目自身的工程文档
│   ├── HANDOFF.md                ← 项目交接与工程交付文档（v1→v2 架构转型）
│   ├── TECH-STACK.md             ← 技术框架选型建议
│   └── 泛半导体CIM…落地方案.md   ← 方案原文
├── data/                         ← 运行时数据（.gitignore）
│   ├── raw/<module>/             ← 解析后的 Markdown 存根 + 原始文件副本
│   ├── work/<bundle_id>/         ← 抽取中间产物（nodes.json）
│   ├── review/                   ← HITL 变更卡片（pending/approved/rejected/archived）
│   ├── documents/                ← project-registry.json / api-registry.json 等登记文件
│   ├── samples/                  ← 测试样本文档
│   └── wiki/                     ← ★ LLM 流水线产出的双平面知识库（独立 git 仓，GitOps 自动提交）
│       ├── templates/            ← 知识仓全局自定义文档模板（可选，覆盖 skill assets 内置默认）
│       │   └── manifest.json     ← 模板契约：type → 生效文件 / 落点目录 / 必填槽位(供 Stage 6 校验)
│       └── <project>/templates/  ← 项目级自定义模板（可选，逐 type 覆盖全局模板）
├── deploy/                       ← 解析引擎、检索基础设施与后端服务（Docker Compose）
│   └── docker-compose.yml        ← Wiki+Server+MinerU(:8888)+Docling(:5001)+MarkItDown(:5002)[+Qdrant/Meili]
└── cmd/ internal/ bin/ go.mod    ← [遗留 v1] Go 服务；parser/mineru.go、docling.go 为 HTTP 契约参考，不再演进
```

> **目录语义辨析**：`docs/` 是本项目自身的工程文档；`data/wiki/` 才是 LLM 流水线产出的知识库。

---

## 开发指南

流水线由 `cim-wiki` skill 驱动，工作流入口在 Agent 会话中调用该 skill（`.agents/skills/cim-wiki/SKILL.md`），各阶段规则全部在 skill 的 `references/*.md` 内定义——调整行为即编辑规范文件，无需改代码。

单阶段脚本可独立运行：

```bash
# Stage 1 解析（服务须在线）
node .agents/skills/cim-wiki/scripts/parse.mjs <输入文档> [--module <模块名>] [--engine mineru|docling|markitdown]

# Stage 1.5 文档状态管控（draft → frozen → active）
node .agents/skills/cim-wiki/scripts/doc-state.mjs verify

# Stage 5 编译（读取 data/work/<bundle_id>/nodes.json；配 WIKI_GITOPS_ENABLED 时对知识仓自动提交）
node .agents/skills/cim-wiki/scripts/compile.mjs <bundle_id>

# Stage 6 Lint 校验
node .agents/skills/cim-wiki/scripts/validate.mjs data/wiki

# Stage 7 展示
cd wiki && npm run docs:dev
```

> Stage 0/8 的 Admin 拉取与回写由 `ADMIN_URL` 环境变量驱动；未设置即为离线模式，`compile.mjs` / `sync-repo.mjs` 仅更新本地 `project-registry.json`，Admin 不可达只告警不阻断流水线。

关键约束：

- 正式摄取前确保 MinerU / Docling / MarkItDown 容器已启动并配好对应 `*_ENDPOINT` 环境变量；**本地不做任何文档解析**，服务不可达即硬失败，绝不产出低保真内容入库。
- 严禁将源代码全文写入 wiki，代码只保留索引证据（repository/class/method/git_ref）。

---

## 扩展点

- **评分权重校准**：编辑 `references/evaluation.md`（Golden Dataset 标定后调整）。
- **新增节点类型/目录**：更新 `references/frontmatter.md` 与 `scripts/gen-sidebar.mjs` 的 `DIR_META`。
- **扫描件 OCR**：`deploy/` 增加 PaddleOCR 服务（镜像即服务端引擎），`parse.mjs` 接入 `--engine ocr`。
- **Phase 3 混合检索**：Qdrant(:6333) + Meilisearch(:7700) 已在 compose 编排，见 [docs/TECH-STACK.md](docs/TECH-STACK.md) §4。
- **Web 端 HITL 审核控制台 / 知识仓 submodule 指针**：Admin 管理台与 GitOps 自动提交已落地（见「已落地内容」），团队共享可进一步以 `git submodule` 挂载知识仓，见 [docs/HANDOFF.md](docs/HANDOFF.md) §6。

## 文档

| 从这里开始 | 说明 |
|------------|------|
| [docs/HANDOFF.md](docs/HANDOFF.md) | 项目交接、v1→v2 架构转型、核心机制与遗留 API |
| [docs/TECH-STACK.md](docs/TECH-STACK.md) | 技术选型对比、引擎/站点备选、Phase 3 检索层建议 |
| [泛半导体CIM…落地方案.md](docs/泛半导体CIM软件产品全生命周期文档%20Wiki%20化与%20AI%20知识工程落地方案.md) | 方案原文（§4.2 引擎路由、§8.1 存储与检索） |
