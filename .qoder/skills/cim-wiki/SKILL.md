---
name: cim-wiki
description: 将泛半导体 CIM/MES 原始文档（SDD/IDD/PRD/运维手册，PDF/DOCX/MD 等）转化为原子化 wiki 知识库。流程：本地解析 → LLM 抽取知识节点 → 7 维质量评分 → 聚合审核（HITL）→ 编译写入 data/wiki → Lint 校验 → VitePress 展示。当用户要求摄取/解析文档生成 wiki、审核变更包、校验或展示知识库时使用。
---

# cim-wiki：CIM 文档知识工程流水线

将原始文档转化为 `data/wiki/` 下原子化、可追溯的知识页面。LLM 工作（抽取、评分、校验）由你（agent）按本 skill 的规则直接完成，无需外部 LLM API。

项目根目录：`/docker/cim-llm-wiki`（下文相对路径均基于此）。

## 流水线总览

```
原始文档 → [1]本地解析 → [2]知识抽取(LLM) → [3]7维评分(LLM) → [4]聚合审核(HITL)
        → [5]编译入 wiki → [6]Lint 校验 → [7]VitePress 展示
```

## 用户意图路由

| 用户请求 | 执行步骤 |
|---------|---------|
| 摄取/解析某文档 | 步骤 1→6 全流程 |
| 查看/审核待审变更包 | 步骤 4（读 `data/review/pending/`） |
| 校验 wiki 质量 | 仅步骤 6 |
| 展示/启动 wiki 站点 | 仅步骤 7 |

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
node .qoder/skills/cim-wiki/scripts/parse.mjs <输入文档> \
  --system <系统: MES|SPC|EAP|CIM…> --version <版本号: V2.22.4> --category <文档大类> [--subcategory <子类>] [--name <不含版本号的名称>] \
  [--engine mineru|docling|markitdown]
```

- **路径规约（推荐）**：输出 `data/raw/<系统>/<版本号>/<文档大类>/<文档子类（如有）>/<文档名>.md`；**文档名不允许包含版本号**（版本由路径段承载，脚本自动剥离 `V2.22.4` 类后缀，剥离失败则硬报错，用 `--name` 显式指定）。文档大类枚举：`user-manual` / `design`（SDD/IDD，子类如 `idd`/`sdd`）/ `prd` / `ops-manual` / `release` / `solution`。
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
node .qoder/skills/cim-wiki/scripts/doc-state.mjs list
node .qoder/skills/cim-wiki/scripts/doc-state.mjs freeze <doc_id> --note "修正完成说明"   # draft → frozen
node .qoder/skills/cim-wiki/scripts/doc-state.mjs unfreeze <doc_id>                      # 重新开放修正
node .qoder/skills/cim-wiki/scripts/doc-state.mjs activate <doc_id>                      # 一般由 compile 自动完成
node .qoder/skills/cim-wiki/scripts/doc-state.mjs verify                                 # 全量 hash/存在性校验
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
node .qoder/skills/cim-wiki/scripts/compile.mjs <bundle_id>
```

- 脚本读取 `data/work/<bundle_id>/nodes.json`，按目录映射（type → `data/wiki/<subdir>/`）与文件名规则（ID 小写 slug + `.md`）生成页面，自动附加 YAML Frontmatter 与来源页脚；`archive` 节点分流到 `data/review/archived/`。
- 关联节点用 wikilink 风格 `[[business/br-wip-001.md]]`。
- **虚拟长文档**：若用户要求某模块的完整 SDD/IDD 视图，将该模块所有原子节点按「模块概述 → 业务规则 → 业务对象 → 流程 → UI 接口 → CIM 集成接口 → 设计」顺序合成，写入 `data/wiki/virtual/<module>-<sdd|idd>.md`（Frontmatter 加 `virtual: true`）。

## 步骤 6：Lint 校验

```bash
node .qoder/skills/cim-wiki/scripts/validate.mjs data/wiki
```

校验 Frontmatter 必填字段、文件名与 ID 一致性、wikilink 断链、孤立页面、语义重复嫌疑（同模块同类型标题相似），以及文档状态管控：非 draft 文档 sha256 漂移（`doc_drift`）、登记文件缺失（`doc_missing`）、draft 文档已发布页面（`doc_state`）。将问题清单报告给用户；断链与元数据错误可直接修复，冲突与重复需用户裁决。

## 步骤 7：VitePress 展示

```bash
npm run docs:dev     # 开发预览（仓库根目录执行，默认 http://localhost:5173）
npm run docs:build   # 静态构建
```

- 站点根为仓库根，`srcDir` 直接指向 `data/wiki`，无需复制。
- 每次编译入库后侧边栏自动刷新（docs:dev/build 已通过 `gen` 前置脚本执行 `scripts/gen-sidebar.mjs`）。
- 注意区分：`docs/` 是本项目自身的工程文档（如 HANDOFF.md）；`data/wiki/` 才是 LLM 流水线产出的知识库。

## 注意事项

- 运行环境：Node.js ≥ 20（脚本与站点统一 Node 技术栈）；首次使用在仓库根执行 `npm install`。
- 解析服务：正式摄取前确保 `deploy/` 下 MinerU、Docling、MarkItDown 容器已启动，并配置 `MINERU_ENDPOINT` / `DOCLING_ENDPOINT` / `MARKITDOWN_ENDPOINT` 环境变量。**本地不做任何文档解析**，所有解析均经服务端 HTTP 调用。
- 严禁将源代码全文写入 wiki，代码只保留索引证据（repository/class/method/git_ref）。
- 所有时间戳用 UTC ISO8601。
- 抽取与评分时保持保守：拿不准的置信度打低，让门限机制去分流，不要臆造关联关系。
