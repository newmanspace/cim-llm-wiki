# 技术框架选型建议（v2 Skill 驱动架构）

> 更新时间：2026-10-01。原则：**主力对齐方案文档 §4.2/§8.1，解析引擎非 Go/Node 原生的一律以独立 Docker HTTP server 提供接口，skill 脚本统一 Node.js 实现，不做任何本地降级（服务不可用即摄取失败）。**

## 1. 当前选定（已落地）

| 环节 | 选定 | 形态 | 说明 |
|------|------|------|------|
| Skill 脚本运行时 | **Node.js ≥ 20** | 本地进程 | parse/compile/validate 全部 .mjs，与站点同栈 |
| 复杂 PDF 解析 | **MinerU 3.4.2**（OpenDataLab） | Docker server :8888 | SDD/IDD 主力：双栏、跨页表格、公式保真；CPU 可跑，GPU 更快；协议自适应（3.x `/file_parse` 同步 → V1 `/v1/file-urls/batch` → 3.x `/tasks` 异步轮询）；镜像 `alexsuntop/mineru:3.4.2`（华为云 SWR） |
| Office 文档解析 | **IBM Docling** | Docker server :5001 | docling-serve 基础镜像 + FastAPI 包装（deploy/docling/），对齐项目契约 `POST /v1/convert/file` |
| 备选服务端解析 | **MarkItDown**（微软） | Docker server :5002 | 轻量 Office/PDF/HTML → MD；`--engine markitdown` 显式指定；**仍为服务端引擎，本地不做任何文档解析** |
| ~~本地兜底解析~~ | **已移除** | — | 按决策不做任何本地降级：服务不可达即硬失败，杜绝低保真内容静默入库 |
| Wiki 存储 | Markdown + YAML Frontmatter + Git | 文件 | 方案 §8.1 指定，天然支持原子提交/回滚 |
| 站点展示 | **VitePress 1.x** | 本地 dev server | srcDir=data/wiki，本地全文搜索，零后端 |

## 2. 解析引擎备选对比

| 引擎 | 优势 | 劣势 | 适用 |
|------|------|------|------|
| **MinerU**（选定） | 复杂学术/工程 PDF 最强，表格/公式/双栏 | 依赖重（含模型），首次拉镜像大 | SDD/IDD 正式摄取 |
| **Docling**（选定） | IBM 开源，Office 全格式，结构化好，生态活跃 | 复杂版面 PDF 弱于 MinerU | DOCX/PPTX/XLSX/HTML |
| markitdown（微软） | 纯 pip 安装，轻量 | 无版面理解，表格易散 | 已改为服务端引擎（deploy/markitdown/，:5002），`--engine markitdown` 显式指定 |
| unstructured | 格式覆盖最广，分块策略多 | 商业版功能阉割，依赖臃肿 | 不推荐 |
| PaddleOCR / Surya | 扫描件 OCR | 需 GPU 才有速度 | Phase 2+ 接入历史扫描件 |

## 3. 站点展示备选对比

| 框架 | 优势 | 劣势 |
|------|------|------|
| **VitePress**（选定） | Vite 原生、Markdown 即站点、frontmatter 直接可用、本地搜索内置、构建快 | 定制复杂交互需写 Vue |
| Docusaurus | React 生态、版本化文档强 | 需要把 md 复制进 docs/，与 data/wiki 目录耦合重 |
| Rspress | Rust 构建更快，字节开源 | 生态与插件少于 VitePress |
| MkDocs Material | Python 系、插件多 | 与 Node 技术栈割裂 |

## 4. Phase 3+ 检索层建议（预留，未落地）

| 环节 | 首选 | 备选 | 理由 |
|------|------|------|------|
| 向量库 | **Qdrant**（compose 已编排 :6333） | Milvus / pgvector / LanceDB | Payload metadata 过滤能力最强，完美匹配 YAML Frontmatter 硬过滤（方案 §8.1 指定） |
| BM25 全文 | **Meilisearch**（compose 已编排 :7700） | Elasticsearch / OpenSearch / Typesense | 轻量、中文分词可用、运维成本低 |
| Embedding | **bge-m3**（本地，中英混排强） | text-embedding-3-large（API）/ Qwen3-Embedding | 半导体术语中英混杂，bge-m3 多语言+稀疏混合检索一体 |
| Rerank | bge-reranker-v2-m3 | Cohere Rerank | 与 bge-m3 同族，本地部署 |
| 图结构 | Markdown Links + Metadata Index（现方案） | Neo4j（节点 >10 万再引入） | 方案 §8.1 明确的延迟决策 |
| 混合检索编排 | Node.js（与 skill 同栈，调 Qdrant/Meili REST） | Python（生态多但引入第二栈） | 保持单栈 |

## 5. 遗留组件处置

| 组件 | 处置建议 |
|------|----------|
| Go 服务（cmd/ internal/ bin/） | 保留只读参考：其 mineru.go/docling.go 是 HTTP 契约的权威定义；不再演进，可在 v3 移除 |
| .venv（曾用于本地 markitdown） | 已按"本地不做任何文档解析"决策移出项目（暂存 /tmp/cim-wiki-venv-unused，可彻底删除） |
| deploy 中 Qdrant/Meilisearch | Phase 3 检索落地时启用 |

## 参考

- MinerU Docker 部署：https://opendatalab.github.io/MinerU/quick_start/docker_deployment/
- MinerU API 文档：https://mineru.net/apiManage/docs
- Docling Serve：https://github.com/docling-project/docling-serve
- Docling REST API：https://docling-project.github.io/docling/usage/api_server/rest_api/
