---
name: cim-wiki
description: 将泛半导体 CIM/MES 原始文档（SDD/IDD/PRD/运维手册，PDF/DOCX/MD 等）转化为原子化 wiki 知识库。流程：本地解析 → LLM 抽取知识节点 → 7 维质量评分 → 聚合审核（HITL）→ 编译写入 data/wiki → Lint 校验 → VitePress 展示。当用户要求摄取/解析文档生成 wiki、审核变更包、校验或展示知识库时使用。
---

# cim-wiki：CIM 文档知识工程流水线

将原始文档转化为 `data/wiki/` 下原子化、可追溯的知识页面。LLM 工作（抽取、评分、校验）由你（agent）按本 skill 的规则直接完成，无需外部 LLM API。

项目根目录：`/docker/cim-llm-wiki`（下文相对路径均基于此）。

## 流水线总览

```
[0]Project 配置 → [1]本地解析 → [2]知识抽取(LLM) → [3]7维评分(LLM) → [4]聚合审核(HITL)
→ [5]编译入 wiki → [6]Lint 校验 → [7]VitePress 展示 → [8]状态回写 Admin
```

## 用户意图路由

| 用户请求 | 执行步骤 |
|---------|---------|
| 摄取/解析某文档 | 步骤 0→6→8 全流程 |
| 增量同步项目 | 步骤 0（sync-repo.mjs）→ 定位变更 → 1→6→8 |
| 查看/审核待审变更包 | 步骤 4（读 `data/review/pending/`） |
| 校验 wiki 质量 | 仅步骤 6 |
| 展示/启动 wiki 站点 | 仅步骤 7 |
| 管理项目配置 | 步骤 0（读写 project-registry.json） |

---

## 步骤 0：Project 配置与 Submodule 检查

**目的**：确定当前操作的项目上下文，确保源数据可用。

### 0.1 获取项目配置

项目配置存储在 `data/documents/project-registry.json`，可通过两种方式获取：

**方式 A — Admin API 下发（生产模式，自动）**：

设定环境变量后，Stage 0 用 `admin-pull.mjs` 从 Admin 拉配置覆盖本地 registry；编译/同步脚本会自动检测 `ADMIN_URL` 决定是否回写 Admin。

```bash
# 环境变量（贯穿 Stage 0→8）
export ADMIN_URL=http://localhost:8080           # 未设置 = 离线模式，全程用本地 JSON
export ADMIN_PROJECT_TOKEN=cimwt_xxx...           # config/sync-status 端点需要
export ADMIN_PROJECT_ID=xinshun-mes               # 可选；不设则按模块归属自动解析目标项目

# 1. 签发 project-token（Admin 管理员操作，一次性；控制台「令牌」Tab 或 curl）
curl -X POST $ADMIN_URL/api/v1/admin/projects/<project-id>/token \
  -H "Content-Type: application/json" \
  -d '{"scopes": ["read_config","write_status"], "expires_in_hours": 720, "created_by": "admin"}'
# 响应: {"token": "cimwt_xxx...", "warning": "store this token securely"}

# 2. skill 拉取最新配置并落地本地 registry
node .agents/skills/cim-wiki/scripts/admin-pull.mjs <project-id>      # 或 --all
```

**方式 B — 离线模式**：不设置 `ADMIN_URL`，`admin-pull.mjs` 会跳过，`compile.mjs` / `sync-repo.mjs` 仅读写本地 `project-registry.json`，零外部依赖。

Admin API 端点一览（`/api/v1/admin/`）：

| 端点 | 方法 | 认证 | 说明 |
|------|------|------|------|
| `/projects` | GET | 无 | 列出所有项目 |
| `/projects` | POST | 无 | 创建/更新项目 |
| `/projects/:id` | GET | 无 | 获取项目详情 |
| `/projects/:id` | DELETE | 无 | 删除项目 |
| `/projects/:id/config` | GET | Bearer token | skill 拉取配置 |
| `/projects/:id/token` | POST | 无 | 签发 token |
| `/projects/:id/token` | DELETE | 无 | 吊销 token |
| `/projects/:id/sync-status` | POST | Bearer token | 回写同步状态 |
| `/projects/:id/sync-logs` | GET | 无 | 查看同步历史 |
| `/projects/:id/wiki-nodes` | GET/POST | 无 | 查看/更新 wiki 索引 |

> Admin API 需要 `ADMIN_ENABLED=true` + PostgreSQL。未启用时 skill 自动回退到本地 JSON 模式。

**配置 schema**：`data/documents/project-registry.json` 结构见 `internal/types/types.go` 中的 `ProjectConfig`（离线模式可直接手动编辑该 JSON）。

### 0.2 Git Submodule 检查与初始化

项目的源文档和代码仓库通过 git submodule 挂载到 `data/sources/<project-id>/` 下：

```
data/sources/<project-id>/
├── docs/    ← 源文档仓库（IDD/SDD/PRD/手册等）
└── code/    ← 代码仓库（仅用于 module_mapping 索引，不复制源码）
```

```bash
# 首次使用：初始化所有 submodule
git submodule update --init --recursive

# 检查特定项目的 submodule 状态
git submodule status data/sources/<project-id>/docs
git submodule status data/sources/<project-id>/code
```

**自动检查**：skill 在步骤 1 解析前自动验证目标文档路径是否存在。若 submodule 未初始化，提示用户执行 `git submodule update --init`。

### 0.3 增量同步（可选）

当需要检测外部仓库变更并触发增量摄取时：

```bash
# 同步指定项目：检测 submodule 变更，定位受影响模块
node .agents/skills/cim-wiki/scripts/sync-repo.mjs <project-id>

# 仅检测变更，不更新状态
node .agents/skills/cim-wiki/scripts/sync-repo.mjs <project-id> --dry-run

# 同步所有项目
node .agents/skills/cim-wiki/scripts/sync-repo.mjs --all
```

同步脚本输出：
- 变更文件清单（按 module_mapping 映射到业务模块）
- 受影响模块列表
- `data/sync/<project-id>-diff-snapshot.json` 快照文件

**增量工作流**：sync-repo.mjs 检测变更 → 定位受影响模块 → 对变更文档重新执行步骤 1→6 → 步骤 8 回写状态。

---

## 步骤 1：文档解析（Parse）

**本地不做任何文档解析**——所有解析引擎均为独立 Docker HTTP server（对齐方案 §4.2，deploy/docker-compose.yml 编排），skill 脚本仅作 HTTP 客户端：

| 文件类型 | 主力引擎 | 服务 |
|----------|----------|------|
| .pdf（SDD/IDD，双栏/跨页表格/公式） | **MinerU** | `MINERU_ENDPOINT`（默认 http://localhost:8888） |
| .docx/.pptx/.xlsx/.html | **IBM Docling** | `DOCLING_ENDPOINT`（默认 http://localhost:5001） |
| 备选服务端引擎（Office/PDF/HTML） | **MarkItDown** | `MARKITDOWN_ENDPOINT`（默认 http://localhost:5002，需 `--engine markitdown` 显式指定） |
| .md/.txt/.json/.yaml | simple（Node 原生直读纯文本，非版面解析） | 无需服务 |
| 扫描件图片 | PaddleOCR（待接入） | — |

```bash
cd deploy && docker compose up -d mineru docling markitdown   # 首次启动解析服务
MINERU_ENDPOINT=http://localhost:8888 \
DOCLING_ENDPOINT=http://localhost:5001 \
MARKITDOWN_ENDPOINT=http://localhost:5002 \
node .agents/skills/cim-wiki/scripts/parse.mjs <输入文档> \
  --system <系统: MES|SPC|EAP|CIM…> --version <版本号: V2.22.4> --category <文档大类> [--subcategory <子类>] [--name <不含版本号的名称>] \
  [--engine mineru|docling|markitdown]
```

- **路径规约（推荐）**：输出 `data/raw/<系统>/<版本号>/<文档大类>/<文档子类（如有）>/<文档名>.md`；**文档名不允许包含版本号**（版本由路径段承载，脚本自动剥离 `V2.22.4` 类后缀，剥离失败则硬报错，用 `--name` 显式指定）。文档大类枚举：`user-manual`（用户手册）/ `admin-manual`（系统管理手册）/ `design`（SDD/IDD，子类如 `idd`/`sdd`）/ `prd` / `ops-manual` / `release` / `solution`。
- **图片还原**：Docling/MarkItDown 契约响应含 `images` 数组（按文档流顺序），脚本落盘 `<文档名>_assets/img-NNN.<ext>` 并将 `<!-- image -->` 占位原位重写为 `![图N](<文档名>_assets/…)`。
- 解析完成后自动在 `data/documents/manifest.json` 登记该文档为 **draft** 状态（唯一状态源）。
- 兼容旧用法：不提供 `--system/--version/--category` 时回退 `data/raw/<module>/<name>.md` 布局。
- **无任何本地降级**：PDF/Office 文档只允许经服务端引擎（MinerU/Docling/MarkItDown）解析，服务未配置或不可达时脚本以非零码硬失败，绝不产出低保真结果入库。
- `--engine` 可强制指定服务端引擎（仍为 HTTP 调用，无本地执行）；未指定时按文件类型路由到主力引擎（PDF→MinerU，Office→Docling）。
- MinerU 协议自适应（按部署版本）：优先 3.x 同步端点（`POST /file_parse`，字段 `files` + `return_md=true`，响应 `results.<文件名>.md_content`）；404/405/415 时依次尝试 V1 端点（`/v1/file-urls/batch`）与 3.x 异步端点（`POST /tasks` → 轮询 `GET /tasks/{id}` → `GET /tasks/{id}/result`）。协议自适应仅发生在 MinerU 引擎内部，≠引擎切换。
- 强制本地解析复杂 PDF 无意义——保真度不足会被质量评分阶段惩罚，正式摄取必须确保服务在线。

## 步骤 1.5：文档状态管控（draft → frozen → active）

每篇原始文档在 `data/documents/manifest.json` 中有一条状态记录，由 `doc-state.mjs` 管控：

```
draft ──修正定稿(freeze，记录 sha256)──▶ frozen ──编译入库(compile 自动激活)──▶ active ──同族新版本 active──▶ superseded
```

| 状态 | 含义 | 约束 |
|------|------|------|
| draft | 原始文档，抽取/修正中 | **禁止提交编译入库、不出人读视图** |
| frozen | 正文定稿 | sha256 锁定，改动会被 Lint 报 `doc_drift`；须先 `unfreeze` |
| active | 已发布 | 其引用 bundle 必须均已编译入库 |
| superseded | 被新版本取代 | 保留存档，不删除 |

```bash
node .agents/skills/cim-wiki/scripts/doc-state.mjs list
node .agents/skills/cim-wiki/scripts/doc-state.mjs freeze <doc_id> --note "修正完成说明"   # draft → frozen
node .agents/skills/cim-wiki/scripts/doc-state.mjs unfreeze <doc_id>                      # 重新开放修正
node .agents/skills/cim-wiki/scripts/doc-state.mjs activate <doc_id>                      # 一般由 compile 自动完成
node .agents/skills/cim-wiki/scripts/doc-state.mjs verify                                 # 全量 hash/存在性校验
```

- 抽取（步骤 2）应基于 **frozen** 文档进行；文档修正 = `unfreeze` → 修改解析稿 → 重新 `freeze`。
- `compile.mjs` 有状态门禁：源文档为 draft 时拒绝编译（`--allow-draft` 仅用于预演，不激活状态）；frozen 文档编译入库后自动激活为 active，并将同 doc_id 旧版本置为 superseded。

## 步骤 2：知识抽取（Extract，由你完成）

读取解析产物，按 **[references/extraction.md](references/extraction.md)** 的规则将文档解构为原子知识节点（KnowledgeNode）：

- 节点类型、ID 命名规范（`TYPE-DOMAIN-SEQ`）、JSON 字段、分块策略、CIM 集成层级分类均在该文件中定义。
- 长文档（>6000 字符）分块处理，块间保留 500 字符重叠。
- 将抽取结果（JSON 数组）写入 `data/work/<bundle_id>/nodes.json`，其中 `bundle_id` 格式为 `CR-YYYYMMDD-NNNN`（当日递增）。

## 步骤 3：7 维质量评分（Evaluate，由你完成）

对每个节点按 **[references/evaluation.md](references/evaluation.md)** 打分：

- 7 维：来源可信度 / 完整性 / 相关性 / 时效性 / 结构 / 复用 / 风险（反向）。
- 计算加权总分，划分审核等级：`L0_auto`(≥0.95) / `L1_expert`(≥0.80) / `L2_arch`(≥0.55) / `archive`(<0.55)。
- 同批次 ID 重复但内容不一致 → 标记冲突，提升风险分。
- 将得分写回 `nodes.json` 每个节点的 `qscore` 与 `review_level` 字段。

## 步骤 4：聚合审核（HITL）

核心原则：**编译存储原子化（面向 AI），视图审核聚合化（面向人）**。绝不逐个节点向用户提问。

1. **L0 节点**：自动放行，直接进入步骤 5。
2. **L1/L2 节点**：生成一份聚合变更卡片（Change Bundle），写入 `data/review/pending/<bundle_id>.md`，格式：

```markdown
# <bundle_id> [<源文档名> 解析提案]
- 源文档: data/raw/...
- 模块: <module> | 节点总数: N | 自动发布: n0 | 待审: n1 | 归档: n2
## 审核明细
| 等级 | ID | 类型 | 标题 | 总分 | 风险点 | 决策 |
|------|----|------|------|------|--------|------|
| L1 | BR-WIP-001 | business_rule | ... | 0.83 | 涉及 Hold/Release 状态机 | 待确认 |
```

3. 在对话中向用户展示该卡片摘要（重点突出冲突项与高风险项），**等待用户批准/驳回/逐项裁决**。
4. 用户批准后：将卡片移入 `data/review/approved/`，在卡片末尾追加审核记录（reviewer、时间、备注），放行的节点进入步骤 5；驳回则移入 `data/review/rejected/` 并终止。
5. `archive` 节点写入 `data/review/archived/<bundle_id>/`，不入主库。

## 步骤 5：编译入 wiki（Compile）

对放行的节点执行编译脚本（页面格式规范见 **[references/frontmatter.md](references/frontmatter.md)**）：

```bash
node .agents/skills/cim-wiki/scripts/compile.mjs <bundle_id>
```

- 脚本读取 `data/work/<bundle_id>/nodes.json`，按**双平面物理分库**路由与文件名规则（ID 小写 slug + `.md`）生成页面，自动附加 YAML Frontmatter（含 `plane: doc|code`）与来源页脚；`archive` 节点分流到 `data/review/archived/`。
- **双平面路由**（判据见 references/extraction.md「双平面物理分库」）：
  - `data/wiki/code/`（**代码契约库**，面向工程实现与自动化编译）：`apis/`（api card）、`rules/`（功能契约，`rule_type: contract` 或带 `applies_to`）、`domain/`（Domain Card / business_object——契约层实体基座）、`schemas/`（data_schema 物理表结构）、`code-index/`（代码索引）。
  - `data/wiki/doc/`（**领域知识库**，面向人与高层业务导航）：`business/`（scenario wf-*（含 What-Next 分支表）与业务规则 `rule_type: business_rule`）、`designs/`、`modules/`、`requirements/`、`dictionaries/`（data_dictionary 数据字典/ER mapping）、`tests/`、`operations/`（运维 SOP）、`manuals/`（文档视图：用户手册 user-manual / 系统管理手册 admin-manual，由 gen-manuals.mjs 生成）、其余 products/projects/releases/deployments/incidents/knowledge/sources/virtual。
- 关联节点 wikilink **必须带平面前缀**：`[[code/apis/api-int-eap-001.md]]`、`[[doc/business/wf-wip-001.md]]`（compile 会把旧无前缀链接自动规范化，存量 bundle 无需手改）。
- **事务码注册表**：api card 的 `transaction_code` 全局唯一，compile 时登记 `data/documents/api-registry.json`，一码一卡，冲突拒绝整批入库。
- **虚拟长文档**：SDD 视图写入 `data/wiki/doc/virtual/<module>-sdd.md`，IDD 视图写入 `data/wiki/code/virtual/<module>-idd.md`（Frontmatter 加 `virtual: true`；合成顺序：模块概述 → 业务规则与契约 → 业务对象 → 流程 → UI 接口 → CIM 集成接口 → 设计）。
- **GitOps 自动提交**（可选，默认关闭）：`data/wiki/` 作为**独立 git 仓库**，每次编译入库自动产生一条 `chore(wiki): <project> <bundle> — N node(s)` commit，赋予知识库 diff/回溯/`git revert` 能力，主仓仍因 `data/` 被 `.gitignore` 而不被产物污染。由环境变量驱动（详见 `scripts/wiki-gitops.mjs`）：
  - `WIKI_GITOPS_ENABLED`（`1/true/yes` 生效；**未设 = 完全 no-op，零副作用**）
  - `WIKI_GITOPS_ROOT`（知识仓库根，默认 `data/wiki`；首次启用自动 `git init` 为独立嵌套仓）
  - `WIKI_GIT_REMOTE` / `WIKI_GIT_BRANCH`（设置后 commit 完成尝试 `push`；**push 失败仅告警、绝不阻断本地编译**）
  - `WIKI_GIT_AUTHOR_NAME` / `WIKI_GIT_AUTHOR_EMAIL`（流水线提交身份，默认 `cim-wiki-pipeline`）
  > 与团队知识仓库对接（`git submodule` 化，主仓跟踪 submodule 指针）需先有远端知识仓库地址，属生产部署步骤，当前以本地独立仓 + 可选 push 落地。

## 步骤 6：Lint 校验

```bash
node .agents/skills/cim-wiki/scripts/validate.mjs data/wiki
```

校验 Frontmatter 必填字段、文件名与 ID 一致性、wikilink 断链、孤立页面、语义重复嫌疑（同模块同类型标题相似），文档状态管控：非 draft 文档 sha256 漂移（`doc_drift`）、登记文件缺失（`doc_missing`）、draft 文档已发布页面（`doc_state`）；rule/domain/api/scenario card 槽位与词表（`vocabulary_violation`、`*_card_incomplete`）；**双平面路由**（`plane_mismatch`：页面落点与类型路由不符为 error，如 api 落进 doc、功能契约落进 doc、业务规则落进 code）；图闭合（`transaction_code` 全库唯一、`applies_to` 指向非 api）。将问题清单报告给用户；断链与元数据错误可直接修复，冲突与重复需用户裁决。

## 步骤 7：VitePress 展示

```bash
npm run docs:dev     # 开发预览（仓库根目录执行，默认 http://localhost:5173）
npm run docs:build   # 静态构建
```

- 站点根为仓库根，`srcDir` 直接指向 `data/wiki`，无需复制。侧边栏为三棵树：**用户手册 / 系统管理手册**（doc/manuals 人读视图，按文档大类分组）、**领域知识库 (Domain Wiki)**（doc/）、**代码契约库 (Code Wiki)**（code/）。
- 每次编译入库后侧边栏自动刷新（docs:dev/build 已通过 `gen` 前置脚本执行 `scripts/gen-sidebar.mjs`）。
- 注意区分：`docs/` 是本项目自身的工程文档（如 HANDOFF.md）；`data/wiki/` 才是 LLM 流水线产出的知识库。

## 步骤 8：状态回写（Status Writeback）

编译/同步完成后自动回写，形成闭环。**回写由脚本自动触发，无需手动 curl**——只要设定了环境变量：

- `compile.mjs`（Stage 5）编译入库后 → 自动 `POST /projects/:id/wiki-nodes`（按模块归属解析目标项目，`ADMIN_PROJECT_ID` 可显式覆盖）。
- `sync-repo.mjs`（Stage 0 增量）检测到仓库变更后 → 自动 `POST /projects/:id/sync-status`（需 `ADMIN_PROJECT_TOKEN`）。
- **未设置 `ADMIN_URL` 时两者都跳过 Admin 回写，仅更新本地 `project-registry.json`**（离线模式）。Admin 不可达仅打印 `admin: ... 回写失败` 告警，不阻断流水线。

### 8.1 本地 project-registry.json（始终更新）

`compile.mjs` 编译时更新 `wiki_nodes` 索引；`sync-repo.mjs` 更新 `last_sync_sha` / `synced_at`。手动标记文档摄取完成时编辑对应 doc 的 `ingested_at` / `bundles`。

### 8.2 手动回写 Admin（可选，脚本失败或补录时）

```bash
# 回写同步状态（token 保护）
curl -X POST -H "Authorization: Bearer cimwt_xxx..." -H "Content-Type: application/json" \
  $ADMIN_URL/api/v1/admin/projects/<project-id>/sync-status \
  -d '{ "repo_name":"mycim-mes","from_sha":"6792989f4c","to_sha":"e09417e18f",
        "changed_files":3,"affected_modules":["webapp"],"status":"success",
        "duration_ms":1200,"wiki_nodes_count":{"doc":12,"code":8},"bundles":["CR-20261002-0001"] }'

# 回写 wiki 节点索引（开放端点）
curl -X POST -H "Content-Type: application/json" \
  $ADMIN_URL/api/v1/admin/projects/<project-id>/wiki-nodes \
  -d '{"nodes":[{"plane":"doc","path":"data/wiki/doc/business/br-wip-001.md","node_id":"BR-WIP-001","bundle_id":"CR-20261002-0001"}]}'
```

### 8.3 Admin API 端点（已实现）

所有端点前缀 `/api/v1/admin/`，需 `ADMIN_ENABLED=true` + PostgreSQL：

| 端点 | 方法 | 认证 | 说明 |
|------|------|------|------|
| `/projects` | GET | 无 | 列出所有项目 |
| `/projects` | POST | 无 | 创建/更新项目（含 docs、repos、modules） |
| `/projects/:id` | GET | 无 | 获取项目完整详情 |
| `/projects/:id` | DELETE | 无 | 删除项目（级联删除关联数据） |
| `/projects/:id/config` | GET | Bearer token | skill 拉取项目配置 |
| `/projects/:id/token` | POST | 无 | 签发 project token（返回明文，仅一次） |
| `/projects/:id/token` | DELETE | 无 | 吊销 token |
| `/projects/:id/sync-status` | POST | Bearer token | 回写同步状态（记录 sync_logs） |
| `/projects/:id/sync-logs` | GET | 无 | 查看同步历史（?limit=20） |
| `/projects/:id/wiki-nodes` | GET | 无 | 查看已编译 wiki 索引 |
| `/projects/:id/wiki-nodes` | POST | 无 | 更新 wiki 索引 |

> **离线模式**：未启用 Admin 时，skill 以本地 `data/documents/project-registry.json` 为唯一配置源，步骤 8 仅更新本地 JSON。
> **PostgreSQL schema**：`deploy/postgres/001_init.sql`，容器首次启动自动执行 migration。

## 注意事项

- 运行环境：Node.js ≥ 20（脚本与站点统一 Node 技术栈）；首次使用在仓库根执行 `npm install`。
- 解析服务：正式摄取前确保 `deploy/` 下 MinerU、Docling、MarkItDown 容器已启动，并配置 `MINERU_ENDPOINT` / `DOCLING_ENDPOINT` / `MARKITDOWN_ENDPOINT` 环境变量。**本地不做任何文档解析**，所有解析均经服务端 HTTP 调用。
- 严禁将源代码全文写入 wiki，代码只保留索引证据（repository/class/method/git_ref）。
- 所有时间戳用 UTC ISO8601。
- 抽取与评分时保持保守：拿不准的置信度打低，让门限机制去分流，不要臆造关联关系。
