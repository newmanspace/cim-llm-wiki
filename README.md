# cim-llm-wiki

> **一句话**：Skill 驱动的泛半导体 CIM 文档知识工程流水线——原始文档（SDD/IDD/PRD/运维手册）经服务端解析、Agent 抽取与 7 维评分、HITL 聚合审核后，编译为 `data/wiki/` 原子化知识库，用 VitePress 本地展示。

<p align="center">
  <a href="#"><img alt="Node.js" src="https://img.shields.io/badge/Node.js-%E2%89%A520-339933?style=flat-square&logo=nodedotjs&logoColor=white"></a>
  <a href="#"><img alt="VitePress" src="https://img.shields.io/badge/VitePress-1.x-646cff?style=flat-square"></a>
  <a href="#"><img alt="架构" src="https://img.shields.io/badge/架构-v2·Skill驱动-b8863b?style=flat-square"></a>
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

```bash
cd deploy && docker compose up -d
```

一键拉起 5 大服务组件：

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
      ▼ [Stage 1] 文档解析      ← scripts/parse.mjs：MinerU(:8888, PDF) / Docling(:5001, Office) / MarkItDown(:5002, 备选)，硬性依赖服务在线
      ▼ [Stage 2] 知识抽取      ← Agent 按 skill references/extraction.md 执行
      ▼ [Stage 3] 7 维评分      ← Agent 按 skill references/evaluation.md 执行
      ▼ [Stage 4] 聚合审核 HITL ← data/review/ 变更卡片 + 对话内用户裁决
      ▼ [Stage 5] Wiki 编译     ← scripts/compile.mjs（规范见 skill references/frontmatter.md）
      ▼ [Stage 6] Lint 校验     ← scripts/validate.mjs
      ▼ [Stage 7] VitePress 展示 ← 仓库根即站点根（srcDir 直指 data/wiki）
```

各环节模块化解耦、组件可替换：解析引擎以独立 Docker server 形式插拔（Phase 2+ 可增 PaddleOCR），LLM 智能环节完全由 skill 规范定义（改 `references/*.md` 即改行为），存储层是 Markdown + YAML Frontmatter + Git（天然支持原子提交/回滚）。

### 用户意图路由

| 用户请求 | 执行阶段 |
|---------|---------|
| 摄取/解析某文档 | Stage 1→6 全流程 |
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
| Wiki 编译 | nodes.json → `data/wiki/<子目录>/`，自动 YAML Frontmatter + wikilink 关联 + 虚拟长文档合成 |
| Lint 校验 | Frontmatter 必填、文件名/ID 一致性、断链、孤立页、语义重复嫌疑、过期 |
| 展示 | VitePress 1.x，srcDir=data/wiki，本地全文搜索，零后端 |

### 节点类型 → 目录映射

| 节点类型 | 子目录 | 文件名示例 |
|----------|--------|-----------|
| business_rule / business_object | `business/` | `br-wip-001.md` `bo-*.md` |
| scenario | `doc/scenarios/` | `sc-wip-001.md` |
| interaction | `code/interactions/` | `it-wip-001.md` |
| api（ui_api & external_integration） | `apis/` | `api-wip-ui-001.md` |
| design | `designs/` | `des-wip-001.md` |
| module | `modules/` | `mod-wip-001.md` |
| requirement / project | `requirements/` | `req-wip-001.md` |
| test_case | `tests/` | `tc-trackin-001.md` |
| release | `releases/` | `rel-mes-001.md` |
| deployment | `deployments/` | `dep-custa-001.md` |
| incident / defect | `incidents/` | `inc-wip-001.md` |
| faq / knowledge_article / 其他 | `knowledge/` | `kn-wip-001.md` |

> 另有 `products/`（产品线）、`projects/`（项目）、`sources/`（源文档索引）、`runbooks/`（运维手册）、`virtual/`（模块级 SDD/IDD 合成长视图）等目录，侧边栏标签见 `scripts/gen-sidebar.mjs` 的 `DIR_META`。

### 支持的解析引擎

| 引擎 | 形态 | 优势 | 适用 |
|------|------|------|------|
| **MinerU 3.4.2** | Docker server :8888 | 复杂工程 PDF 最强，表格/公式/双栏 | SDD/IDD 正式摄取 |
| **IBM Docling** | Docker server :5001 | Office 全格式，结构化好 | DOCX/PPTX/XLSX/HTML |
| **MarkItDown**（微软） | Docker server :5002 | 轻量 Office/PDF/HTML → MD | 备选服务端引擎 |
| **PaddleOCR / Surya** | 待接入 | 扫描件 OCR | Phase 2+ 历史扫描件 |

---

## 已落地内容

仓库当前已跑通一次完整流水线，作为示范（源码级知识库尚未摄取业务 SDD/IDD）：

- **源文档**：`data/raw/knowledge-engineering/泛半导体CIM…落地方案.md`（本方案自身 MD，由 simple 直读）。
- **变更包**：`CR-20261001-0001` 已经 HITL 批准（`data/review/approved/`），中间产物见 `data/work/CR-20261001-0001/nodes.json`。
- **wiki 产出**：`data/wiki/` 共 10 个原子节点——需求 1（`req-ke-001`）、架构设计 7（`des-ke-001..007`）、模块驾驶舱 2（`mod-ke-001..002`）；首页与侧边栏由 `npm run gen` 自动生成。

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
├── .qoder/skills/cim-wiki/       ← ★ 核心：知识工程流水线 skill
│   ├── SKILL.md                  ← 7 阶段工作流定义（含引擎路由与命令）
│   ├── references/
│   │   ├── extraction.md         ← 知识抽取规范（节点 schema/ID/CIM 分层）
│   │   ├── evaluation.md         ← 7 维评分与门限规则
│   │   └── frontmatter.md        ← wiki 页面编译规范与目录映射
│   └── scripts/
│       ├── parse.mjs             ← Stage 1 解析客户端（MinerU/Docling/MarkItDown，本地不做任何文档解析）
│       ├── compile.mjs           ← Stage 5 编译 nodes.json → wiki 页面
│       └── validate.mjs          ← Stage 6 Lint 校验
├── wiki/                         ← ★ 独立 Wiki 知识库展示工程
│   ├── .vitepress/config.mjs     ← VitePress 站点配置（srcDir=../data/wiki）
│   ├── scripts/gen-sidebar.mjs   ← 扫描 data/wiki 自动生成侧边栏与首页
│   └── package.json              ← npm run gen / docs:dev / docs:build / docs:preview
├── .env.example                  ← 解析服务端点等环境变量样例
├── docs/                         ← 本项目自身的工程文档
│   ├── HANDOFF.md                ← 项目交接与工程交付文档（v1→v2 架构转型）
│   ├── TECH-STACK.md             ← 技术框架选型建议
│   └── 泛半导体CIM…落地方案.md   ← 方案原文
├── data/                         ← 运行时数据（.gitignore）
│   ├── raw/<module>/             ← 解析后的 Markdown 存根 + 原始文件副本
│   ├── work/<bundle_id>/         ← 抽取中间产物（nodes.json）
│   ├── review/                   ← HITL 变更卡片（pending/approved/rejected/archived）
│   ├── samples/                  ← 测试样本文档
│   └── wiki/                     ← ★ LLM 流水线产出的原子化知识库
├── deploy/                       ← 解析引擎与检索基础设施（Docker）
│   ├── docker-compose.yml        ← MinerU(:8888)+Docling(:5001)+MarkItDown(:5002)+Qdrant(:6333)+Meilisearch(:7700)
│   ├── docling/                  ← Docling 服务镜像（docling-serve + FastAPI 契约包装）
│   └── markitdown/               ← MarkItDown 服务镜像（python:3.11-slim + markitdown + FastAPI）
└── cmd/ internal/ bin/ go.mod    ← [遗留 v1] Go 服务；parser/mineru.go、docling.go 为 HTTP 契约参考，不再演进
```

> **目录语义辨析**：`docs/` 是本项目自身的工程文档；`data/wiki/` 才是 LLM 流水线产出的知识库。

---

## 开发指南

流水线由 `cim-wiki` skill 驱动，工作流入口在 Agent 会话中调用该 skill（`.qoder/skills/cim-wiki/SKILL.md`），各阶段规则全部在 skill 的 `references/*.md` 内定义——调整行为即编辑规范文件，无需改代码。

单阶段脚本可独立运行：

```bash
# Stage 1 解析（服务须在线）
node .qoder/skills/cim-wiki/scripts/parse.mjs <输入文档> [--module <模块名>] [--engine mineru|docling|markitdown]

# Stage 5 编译（读取 data/work/<bundle_id>/nodes.json）
node .qoder/skills/cim-wiki/scripts/compile.mjs <bundle_id>

# Stage 6 Lint 校验
node .qoder/skills/cim-wiki/scripts/validate.mjs data/wiki

# Stage 7 展示
npm run docs:dev
```

关键约束：

- 正式摄取前确保 MinerU / Docling / MarkItDown 容器已启动并配好对应 `*_ENDPOINT` 环境变量；**本地不做任何文档解析**，服务不可达即硬失败，绝不产出低保真内容入库。
- 严禁将源代码全文写入 wiki，代码只保留索引证据（repository/class/method/git_ref）。

---

## 扩展点

- **评分权重校准**：编辑 `references/evaluation.md`（Golden Dataset 标定后调整）。
- **新增节点类型/目录**：更新 `references/frontmatter.md` 与 `scripts/gen-sidebar.mjs` 的 `DIR_META`。
- **扫描件 OCR**：`deploy/` 增加 PaddleOCR 服务（镜像即服务端引擎），`parse.mjs` 接入 `--engine ocr`。
- **Phase 3 混合检索**：Qdrant(:6333) + Meilisearch(:7700) 已在 compose 编排，见 [docs/TECH-STACK.md](docs/TECH-STACK.md) §4。
- **Web 端 HITL 审核控制台 / GitOps 自动提交**：详见 [docs/HANDOFF.md](docs/HANDOFF.md) §6 后续迭代建议。

## 文档

| 从这里开始 | 说明 |
|------------|------|
| [docs/HANDOFF.md](docs/HANDOFF.md) | 项目交接、v1→v2 架构转型、核心机制与遗留 API |
| [docs/TECH-STACK.md](docs/TECH-STACK.md) | 技术选型对比、引擎/站点备选、Phase 3 检索层建议 |
| [泛半导体CIM…落地方案.md](docs/泛半导体CIM软件产品全生命周期文档%20Wiki%20化与%20AI%20知识工程落地方案.md) | 方案原文（§4.2 引擎路由、§8.1 存储与检索） |
