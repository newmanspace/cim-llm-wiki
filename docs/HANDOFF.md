# cim-llm-wiki 项目交接与工程交付文档 (Handoff)

> **版本**: v2.0.0（Skill 驱动架构）  
> **更新时间**: 2026-10-01  
> **项目定位**: 泛半导体 CIM 软件产品全生命周期知识工程，负责将原始设计与规格文档（Raw Documents）经过本地解析、Agent 智能抽取、7 维可解释打分与 HITL 聚合审核，最终生成原子化、具备双向追溯关系的 `data/wiki/` 知识库，并以 VitePress 本地站点展示。

---

## 当前进度与接续任务（供下一个 Agent 接手）

> 本节记录最近一次会话的执行状态，作为增量交接；下方 §0 及以后为项目稳定架构说明。**接手的 Agent 请以本节为准继续任务。**

### 已完成

- **README.md 全量重写**（`/docker/cim-llm-wiki/README.md`）：参照 `/docker/mycim-knora/weknora-core/README_CN.md` 的版式重构为 项目介绍 → 快速开始 → 架构设计 → 功能概览 → 已落地内容 → 设计原则 → 项目结构 → 开发指南 → 扩展点 → 文档。内容全部取自项目实际状态，未虚构（因无 LICENSE/CHANGELOG/git remote，徽章仅保留 Node/VitePress/架构/引擎等事实项）。
- **站点编译**：`npm run docs:build` 成功 —— `gen-sidebar: 10 pages, 3 groups`，产物在 `.vitepress/dist/`。
- **站点预览**：`npm run docs:dev` 已后台运行，5173 被占用自动改用 **http://localhost:5174/**（terminal_id=1，如需停掉用 `GetTerminalOutput` 确认后终止）。
- **解析引擎容器在线**：`cim-wiki-mineru`(:8888)、`cim-wiki-docling`(:5001)、`cim-wiki-markitdown`(:5002) 均 Up。`curl :8888/:5001/:5002` 根路径返回 404 属正常（仅暴露具体 API 端点）。
- **知识库现状**：`data/wiki/` 已有 10 个原子节点（需求 1 `req-ke-001` + 架构设计 7 `des-ke-001..007` + 模块驾驶舱 2 `mod-ke-001..002`），来源于已批准的 `CR-20261001-0001`（对方案自身 MD 的摄取，作为 POC 示范）。

### 阻塞项（未解决）

- **夸克网盘 MES 用户手册摄取失败**：任务原计划「从夸克网盘搜索一份 MES 用户手册」跑端到端流水线。quarkclouddrive CLI 已安装（v1.0.22），但**所有子命令**（含 search / get-user-info / resolve-agent）一律返回：

  ```json
  {"code": -104, "msg": "无法识别当前 Agent 环境，禁止继续使用", "action": "runtime"}
  ```

  根因：夸克 CLI 依赖 agent 渠道环境变量识别运行环境，本机（mesap02）未注入该标识，工具按自身守卫主动拒绝执行。**这不是授权/token 问题，`login` 无法解决，且不允许绕过。** 若下个环境能注入正确渠道标识，可重试搜索。

### 接续任务（下一步）

目标不变：**用 cim-wiki skill 对一份 MES 用户手册跑完整流水线**（Stage 1 解析 → Stage 2 抽取 → Stage 3 评分 → Stage 4 HITL 审核 → Stage 5 编译 → Stage 6 Lint → 刷新展示）。测试文档来源三选一（按优先级）：

1. **本地现成样本**（推荐，零依赖）：`data/samples/idd_wip_sample.docx`（MES 的 WIP IDD 样本，走 Docling :5001）。命令：
   ```bash
   MINERU_ENDPOINT=http://localhost:8888 DOCLING_ENDPOINT=http://localhost:5001 MARKITDOWN_ENDPOINT=http://localhost:5002 \
   node .qoder/skills/cim-wiki/scripts/parse.mjs data/samples/idd_wip_sample.docx --module wip-management
   ```
2. **用户提供的夸克分享链接**：试 `saveas` 转存后 `download`（若同样被 -104 拦截则转方式 1/3）。
3. **用户手动放到本地路径的 PDF/DOCX**：告知路径 + 模块名后用 skill 摄取。

> 抽取与评分环节由 Agent 按 `.qoder/skills/cim-wiki/references/extraction.md`、`evaluation.md` 直接完成，无需外部 LLM API Key；HITL 审核须生成聚合变更卡片等待用户裁决。

### 环境速查

| 项 | 值 |
|----|----|
| 项目根 | `/docker/cim-llm-wiki` |
| Node.js | ≥ 20（当前 v22.23.1） |
| 站点端口 | dev 5174（5173 占用自动 +1） |
| MinerU / Docling / MarkItDown | :8888 / :5001 / :5002 |
| 流水线 skill | `.qoder/skills/cim-wiki/SKILL.md`（Stage 定义） |
| 启动引擎容器 | `cd deploy && docker compose up -d mineru docling markitdown` |

---

## 0. v2 架构转型说明（当前生效）

v1 是完整 Go 服务（HTTP API + 内置 LLM 调用）；v2 转型为 **Skill 驱动的轻量工作流**：

| 环节 | v1（Go 服务） | v2（当前） |
|------|---------------|-----------|
| 文档解析 | Go 内置 HTTP 客户端（未真正部署引擎） | **主力：MinerU(:8888, PDF) / IBM Docling(:5001, Office) / MarkItDown(:5002, 备选) 独立 Docker server**，`scripts/parse.mjs`（Node）作客户端；**本地不做任何文档解析**——服务不可用即硬失败（unpdf/mammoth 兜底已按决策移除） |
| 知识抽取 | 内置 OpenAI 客户端 | **Agent 按 skill 规范执行**（references/extraction.md），无需 API Key |
| 7 维评分 | evaluator.go | **Agent 按 skill 规范执行**（references/evaluation.md），规则与权重完全一致 |
| HITL 审核 | HTTP 队列 | `data/review/` 变更卡片（pending/approved/rejected/archived）+ 对话内用户裁决 |
| Wiki 编译 | compiler.go | `scripts/compile.mjs`（nodes.json → data/wiki/，规范见 references/frontmatter.md） |
| Lint 校验 | 未实现 | `scripts/validate.mjs`（断链/孤儿/元数据/重复嫌疑/过期） |
| 展示 | 无 | **VitePress**（仓库根即站点根，srcDir=data/wiki，`npm run docs:dev`） |
| Go 代码 | 主体 | **遗留只读**：mineru.go/docling.go 为 HTTP 契约权威参考，不再演进 |

技术选型对比与 Phase 3 检索层建议见 **docs/TECH-STACK.md**。

**目录语义**：`docs/` = 本项目工程文档；`data/wiki/` = LLM 流水线产出的知识库（运行时生成，.gitignore）。

工作流入口：Agent 会话中调用 `cim-wiki` skill（`.qoder/skills/cim-wiki/SKILL.md`），7 阶段流程与规则全部在 skill 内定义。

---

以下为 v1 Go 服务交接内容（遗留参考，仅解析后备场景使用）：

---

## 1. 核心架构与业务全流程

本项目完全基于 Go 语言实现，依据方案架构设计了 5 阶段流式处理管线（Pipeline）：

```
[Raw Document] (PDF / DOCX / MD / 图片)
       │
       ▼
┌────────────────────────────────────────────────────────┐
│ Stage 1: 解析器引擎 (Parser Registry)                  │
│ • MinerU (复杂PDF/双栏/跨页表格/数学公式)               │
│ • Docling (Word/DOCX, PPTX, Excel, HTML)               │
│ • PaddleOCR (历史扫描件/架构图)                         │
│ • Simple (Go 原生纯文本/Markdown/JSON/YAML)            │
└────────────────────────────────────────────────────────┘
       │ ParsedDocument (带结构化表格与排版元数据)
       ▼
┌────────────────────────────────────────────────────────┐
│ Stage 2: 知识抽取器 (Knowledge Extractor)              │
│ • LLM 智能抽取: 基于 OpenAI 规范接口解构半导体 CIM 知识 │
│ • Heuristic 规则兜底: 无网络/无Key时通过标题与模式解析    │
└────────────────────────────────────────────────────────┘
       │ []KnowledgeNode (BR/BO/WF/API/Design/Req...)
       ▼
┌────────────────────────────────────────────────────────┐
│ Stage 3: 7 维质量评分与门限分级 (Evaluator)            │
│ • 7维打分: 来源可信度、完整性、相关性、时效性、结构、复用、风险│
│ • 门限划分:                                            │
│   - L0 (Auto ≥ 0.95): 免审直接自动编译发布              │
│   - L1 (Expert ≥ 0.80): 进入专家复核队列                │
│   - L2 (Arch ≥ 0.55): 进入架构师仲裁队列               │
│   - Archive (< 0.55): 归档废弃，不污染主库              │
└────────────────────────────────────────────────────────┘
       │
       ├─────────────────────────────────┐
       ▼ (L0 自动放行)                    ▼ (L1/L2 需人工确认)
┌───────────────────────────────┐ ┌───────────────────────────────┐
│ Stage 5: Wiki 编译器 (Compiler)│ │ Stage 4: 人机协同审核 (HITL)  │
│ • 原子化 Frontmatter 生成      │ │ • 聚合为 ChangeBundle (CR)    │
│ • 目录规范映射 (wiki/business) │ │ • 支持 Approve / Reject 审核 │
│ • 虚拟长文档合成 (SDD/IDD)    │ │ • 零依赖线程安全持久化队列    │
└───────────────────────────────┘ └───────────────────────────────┘
                                                 │ 审核通过后触发
                                                 └───────────────► 编译入库
```

---

## 2. 目录结构与代码职责

```
/docker/cim-llm-wiki
├── bin/
│   └── cim-wiki-server             # 编译生成的独立服务二进制文件
├── cmd/
│   └── server/
│       └── main.go                 # 服务主入口、配置加载、路由装配与优雅停机
├── deploy/
│   ├── docker-compose.yml          # MinerU、Docling、MarkItDown、Qdrant、Meilisearch 支撑服务
│   ├── docling/                    # IBM Docling FastAPI 包装（deploy/docling/Dockerfile + docling_app.py）
│   └── markitdown/                 # MarkItDown FastAPI 服务端引擎（deploy/markitdown/Dockerfile + markitdown_app.py）
├── docs/
│   └── HANDOFF.md                  # 本交接文档
├── internal/
│   ├── config/
│   │   └── config.go               # 统一环境变量读取与配置中心（7维权重与服务参数）
│   ├── handler/
│   │   ├── ingest.go               # POST /api/v1/ingest (文件上传与 Pipeline 执行)
│   │   ├── review.go               # GET/POST /api/v1/review (HITL 审核工作流)
│   │   └── wiki.go                 # GET /api/v1/wiki (知识查询与虚拟文档合成)
│   ├── hitl/
│   │   └── queue.go                # 人机协同审核队列，支持原子安全持久化存储
│   ├── pipeline/
│   │   ├── compiler/
│   │   │   └── compiler.go         # 写入 wiki/ 规范文件，生成 YAML Frontmatter
│   │   ├── evaluator/
│   │   │   ├── evaluator.go        # 7 维评分数学模型与分类器
│   │   │   └── evaluator_test.go   # 评分与分级单元测试
│   │   ├── extractor/
│   │   │   └── extractor.go        # LLM 结构化抽取与规则启发兜底
│   │   ├── parser/
│   │   │   ├── parser.go           # DocParser 基础接口
│   │   │   ├── registry.go         # 引擎注册与根据后缀自动路由
│   │   │   ├── docling.go          # Docling HTTP 客户端
│   │   │   ├── mineru.go           # MinerU HTTP 客户端
│   │   │   ├── ocr.go              # OCR 解析适配
│   │   │   └── simple.go           # 原生 Markdown / 文本解析
│   │   ├── pipeline.go             # 核心流式协同编排器
│   │   └── pipeline_test.go        # 端到端 Pipeline 完整单元测试
│   └── types/
│       └── types.go                # 领域核心类型定义（KnowledgeNode, QualityScore 等）
├── data/                           # 运行时动态数据目录（已加入 .gitignore）
│   ├── raw/                        # 原始文档存储
│   └── wiki/                       # 编译生成的原子化知识库
├── go.mod / go.sum                 # Go 模块依赖规范
└── README.md                       # 项目概览与快速启动说明
```

---

## 3. 核心机制详解

### 3.1 7 维质量评分与门限（Evaluator）
综合得分计算公式：
$$\text{Total} = \sum_{i \in \{auth, comp, rel, fresh, struct, reuse\}} (w_i \cdot S_i) + w_{risk} \cdot (1 - S_{risk})$$

- **来源可信度 ($S_{auth}$)**: 官方 SDD/IDD 标准设计文档为 1.0，草稿/会议纪要按规则降权。
- **完整性 ($S_{comp}$)**: 必须包含明确的规则触发条件、执行逻辑或前置校验。
- **产品相关性 ($S_{rel}$)**: 包含核心业务域关键词（Lot, Wafer, Chamber, Carrier, Track-in, Hold）。
- **时效性 ($S_{fresh}$)**: 基于半衰期模型计算，一年内新文档得分 $\ge 0.8$。
- **结构化规范 ($S_{struct}$)**: 检查是否有代码追溯、关联需求或二级标题组织。
- **可复用性 ($S_{reuse}$)**: 包含跨模块通用业务逻辑或标准参数。
- **冲突风险 ($S_{risk}$)**: 冲突惩罚项，若同批次内存在 ID 重复但内容不一致，提高风险分。

### 3.2 动态 Wiki 结构输出与虚拟长文档（Compiler）
`wiki/` 目录为运行时生成，具备以下能力：
1. **原子化分类存储**：
   - 业务规则: `wiki/business/br-{id}.md`
   - 接口契约: `wiki/apis/api-{id}.md`
   - 需求追踪: `wiki/requirements/req-{id}.md`
   - 架构设计: `wiki/designs/des-{id}.md`
2. **虚拟长文档动态合成**：
   - 传统工程师习惯阅读长篇 SDD/IDD，通过 `GET /api/v1/wiki/virtual/:module?type=sdd`，编译器即时汇总分散的原子知识节点，拼装出包含目录与完整正文的合成视图。

---

## 4. API 接口使用说明

服务默认监听端口：`8080`

### 4.1 原始文档摄取流水线
```bash
POST /api/v1/ingest
Content-Type: multipart/form-data

# 表单参数：
# file: 原始文档二进制文件 (如 sdd_wip.docx / idd_mes.pdf)
# module: 业务模块标识 (如 WIP)
# engine: 可选，指定解析引擎 (docling / mineru / simple)

# 响应示例：
{
  "source_doc": "data/raw/sdd_wip.md",
  "module": "WIP",
  "engine": "simple",
  "total_nodes": 4,
  "auto_published": 1,
  "pending_review": 3,
  "bundle_id": "CR-20261001-0001",
  "duration_ms": 3254000
}
```

### 4.2 HITL 人机审核工作流
```bash
# 1. 查询待审核列表
GET /api/v1/review?status=pending

# 2. 查看某个变更包详情（包含提取的节点明细、评分各维度拆解、冲突项）
GET /api/v1/review/CR-20261001-0001

# 3. 审核批准（自动触发 Stage 5 编译写入 wiki/ 目录）
POST /api/v1/review/CR-20261001-0001/approve
{
  "reviewer": "zhangsan",
  "note": "规则核对无误，准予入库"
}

# 4. 审核驳回
POST /api/v1/review/CR-20261001-0001/reject
{
  "reviewer": "lisi",
  "note": "缺少超时异常处理分支"
}
```

### 4.3 知识节点与虚拟文档查询
```bash
# 1. 获取指定原子节点 Markdown
GET /api/v1/wiki/BR-WIP-001

# 2. 获取某模块虚拟合成 SDD 长文档
GET /api/v1/wiki/virtual/WIP?type=sdd

# 3. 查询各解析引擎健康状态与可用性
GET /api/v1/parsers
```

---

## 5. 本地构建与日常运维

### 5.1 编译与测试
```bash
cd /docker/cim-llm-wiki

# 运行所有单元测试（包含端到端测试与质量打分测试）
go test -v ./...

# 编译生成可执行文件
go build -o bin/cim-wiki-server ./cmd/server
```

### 5.2 启动服务
```bash
# 1. 采用默认配置启动（无外部依赖，零 CGO，直接运行）
./bin/cim-wiki-server

# 2. 配置自定义环境变量启动
SERVER_PORT=8080 \
WIKI_OUTPUT_DIR=./data/wiki \
LLM_BASE_URL="http://10.0.0.10:11434/v1" \
LLM_MODEL="qwen2.5-72b-instruct" \
LLM_API_KEY="sk-xxx" \
./bin/cim-wiki-server
```

### 5.3 启动支撑服务容器（可选生产配套）
```bash
cd /docker/cim-llm-wiki/deploy
docker compose up -d
# 启动 Qdrant(6333), Meilisearch(7700), MinerU(8888), Docling(5001), MarkItDown(5002)
```

---

## 6. 后续迭代建议 (Next Steps)

1. **向量与全文双路检索落地**：
   - 目前工程结构中已预留 `internal/retrieval` 模块位置，可接入 `Qdrant`（稠密向量）与 `Meilisearch`（BM25 关键词），实现混合检索与 Rerank。
2. **黄金测试集（Golden Dataset）标定**：
   - 提取 50 篇典型历史文档，人工标注业务规则与得分，校准 `EvaluatorConfig` 的权重比例。
3. **Web 端 HITL 审核控制台**：
   - 基于现有 `/api/v1/review` RESTful API，开发专用的 Diff 对比与审批可视化前端界面。
4. **GitOps 自动提交流水线**：
   - 在 `compiler.go` 中挂载 git commit/push 钩子，审核通过时自动推送到团队的 GitLab/GitHub 知识仓库。
