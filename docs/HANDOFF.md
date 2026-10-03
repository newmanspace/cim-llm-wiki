# cim-llm-wiki 项目交接与工程交付文档 (Handoff)

> **版本**: v2.1.0（Project Registry 架构）  
> **更新时间**: 2026-10-02  
> **项目定位**: 泛半导体 CIM 软件产品全生命周期知识工程，负责将原始设计与规格文档（Raw Documents）经过本地解析、Agent 智能抽取、7 维可解释打分与 HITL 聚合审核，最终生成原子化、具备双向追溯关系的 `data/wiki/` 知识库，并以 VitePress 本地站点展示。v2.1 新增 Project Registry 层，建立 Project ↔ Documents ↔ Code Repos 关联，支持 git submodule 增量同步与 Admin 系统集中管控。

---

## 当前进度与接续任务（供下一个 Agent 接手）

> 本节记录最近一次会话的执行状态，作为增量交接；下方 §0 及以后为项目稳定架构说明。**接手的 Agent 请以本节为准继续任务。**

### 已完成

- **知识库 GitOps 独立版本管理**（新增，对应 Issue #1）：
  - `data/wiki/` 作为**独立 git 仓库**，`compile.mjs`（Stage 5）编译入库后自动 `git add -A && git commit`，提交信息 `chore(wiki): <project> <bundle> — N node(s)`，赋予知识库版本追溯/diff/回滚（`git revert`）能力；主仓仍因 `.gitignore` 忽略 `data/` 而不被编译产物污染。
  - 新增 `scripts/wiki-gitops.mjs`（env 驱动，风格对齐 `admin-client.mjs`）：`WIKI_GITOPS_ENABLED`（未设=完全 no-op）+ `WIKI_GITOPS_ROOT`（默认 `data/wiki`，首次启用自动 `git init` 为独立嵌套仓）+ `WIKI_GIT_REMOTE`/`WIKI_GIT_BRANCH`（配置后 push）+ `WIKI_GIT_AUTHOR_NAME/EMAIL`（流水线身份，默认 `cim-wiki-pipeline`）。
  - 容错：commit 后 push 失败仅告警、**绝不阻断本地编译**（实测假远端 push 失败 exit 仍 0、commit 保留）。端到端验证：启用后 `data/wiki` 生成首条 commit、25 文件入库、主仓 `git status` 无 `data/wiki` 噪声。
  - 待生产部署：如需团队共享，再建独立知识仓库远端并 `git submodule` 挂载，主仓跟踪 submodule 指针（当前以本地独立仓 + env 开关形式落地）。

- **统一 Docker Compose 一键部署**（`deploy/docker-compose.yml`）：
  - 将原宿主机分散执行的 Go 后端服务与 VitePress Web 前端统一容器化交付，形成包含 5 大服务的统一编排架构：
    1. `cim-wiki-server`（Alpine 静态二进制 42.6MB，`:8080`，内部直连解析引擎 DNS）
    2. `cim-wiki-wiki`（Node 22-alpine，`:5174`，挂载 `/data/wiki` 自动刷新侧边栏）
    3. `cim-wiki-mineru`（复杂 PDF 解析引擎，`:8888`）
    4. `cim-wiki-docling`（Office/Word 解析引擎，`:5001`）
    5. `cim-wiki-markitdown`（通用文档解析引擎，`:5002`）
  - 检索层 `qdrant` 与 `meilisearch` 采用 `profiles: ["retrieval"]` 隔离，避免常规拉起时因外部网络拉取大镜像卡顿。
  - 彻底解决容器内 Vitepress `spawn git ENOENT` 问题（`lastUpdated: false`）并自适应 Docker 卷挂载路径。
- **README.md 全量重写**（`/docker/cim-llm-wiki/README.md`）：参照最佳实践重构为 项目介绍 → 快速开始 → 架构设计 → 功能概览 → 已落地内容 → 设计原则 → 项目结构 → 开发指南 → 扩展点 → 文档。
- **解析引擎与后端在线就绪**：`curl :8080/healthz` 响应 `status: ok`，`/api/v1/parsers` 显示 `docling` 与 `mineru` 均 `available: true`。
- **前端知识库站点在线**：对外访问 **http://10.243.251.204:5174/**（或本地 **http://localhost:5174/**），50 篇原子文档及文档视图（手册）导航完全渲染。
- **Wiki 双轨架构目录命名优化**：彻底消除了 `doc` 平面与 `code` 平面之间的语义冲突：
  - `doc` 侧：原 `business` 改为 `scenarios` (业务场景)，原 `operations` 改为 `runbooks` (运维预案)。
  - `code` 侧：新增 `interactions` (交互时序流)，替代冗长的 `operation-flows` 及易产生数据库歧义的 `sequences`。
  - 同步更新了 `compiler.go`, `types.go`, `extractor.go`, `gen-sidebar.mjs` 映射及 `README.md`。
- **Project Registry 架构落地**（v2.1 新增）：
  - 新增 `ProjectConfig` / `DocSource` / `RepoBinding` / `ProjectToken` / `SyncState` 等 Go 类型定义（`internal/types/types.go`）。
  - 创建 `data/documents/project-registry.json` 注册表（与 `manifest.json`、`api-registry.json` 并列的第三类全局注册表）。
  - 建立 `data/sources/<project-id>/docs|code/` git submodule 目录结构，支持源文档与代码仓库的本地挂载。
  - 新增 `scripts/sync-repo.mjs` 增量同步脚本：git fetch → diff lastSyncSHA..HEAD → module_mapping 路径匹配 → 输出受影响模块 + 变更文件清单。
  - `compiler.go` 中 `ObjProject` 路由从 `requirements/` 修正为 `projects/`；`compile.mjs` 同步更新 JS 侧映射。
  - `compile.mjs` 新增编译后自动回写 `project-registry.json` 的 `wiki_nodes` 索引。
  - SKILL.md 新增 **步骤 0**（Project 配置获取 + submodule 检查 + 增量同步）与 **步骤 8**（状态回写 Admin），流水线从 7 阶段扩展为 9 阶段（0→8）。
  - 规划 Admin API 端点（`/api/v1/projects/:id/config`、`/sync-status`、`/token`），当前以本地 JSON 为配置源，Admin 上线后无缝切换。
- **Admin 系统落地（PostgreSQL）**（v2.1 新增）：
  - PostgreSQL 16-alpine 加入 docker-compose（`deploy/docker-compose.yml`），端口 5432，自动执行 `deploy/postgres/001_init.sql` migration。
  - Schema 设计：9 张表（projects / project_docs / doc_bundles / project_repos / repo_module_mappings / project_modules / project_tokens / sync_logs / project_wiki_nodes），含外键级联、唯一约束、自动 updated_at 触发器。
  - Go 存储层 `internal/store/postgres.go`：基于 pgx/v5 连接池，实现 Project CRUD、Token 签发/验证/吊销、Sync 记录、Wiki 索引 upsert。
  - Admin API handler `internal/handler/admin.go`：12 个 REST 端点（`/api/v1/admin/*`），含 Bearer token 认证中间件。
  - `cmd/server/main.go` 新增 Admin 模块：`ADMIN_ENABLED=true` 时连接 PostgreSQL、自动 migration、注册路由；未启用时零影响。
  - `internal/config/config.go` 新增 `AdminConfig`（Enabled / PostgresDSN / MigrationDir / TokenDefaultExpiryHours）。
  - 真实项目数据录入：`xinshun-mes`（新顺 MES）已写入 `project-registry.json`，含 54 个模块映射、6 份关联文档、GitLab 仓库绑定。
  - `sync-repo.mjs` 增量检测验证通过：离线回退本地 HEAD、diff 3 文件变更正确映射到 `webapp` 模块。

### 阻塞项（未解决）

- **夸克网盘 MES 用户手册摄取失败**：任务原计划「从夸克网盘搜索一份 MES 用户手册」跑端到端流水线。quarkclouddrive CLI 已安装（v1.0.22），但**所有子命令**（含 search / get-user-info / resolve-agent）一律返回：

  ```json
  {"code": -104, "msg": "无法识别当前 Agent 环境，禁止继续使用", "action": "runtime"}
  ```

  根因：夸克 CLI 依赖 agent 渠道环境变量识别运行环境，本机（mesap02）未注入该标识，工具按自身守卫主动拒绝执行。**这不是授权/token 问题，`login` 无法解决，且不允许绕过。** 若下个环境能注入正确渠道标识，可重试搜索。

### 接续任务（下一步）

**优先级 1 — 端到端流水线验证**：用 cim-wiki skill 对一份 MES 用户手册跑完整流水线（Stage 0 配置 → Stage 1 解析 → Stage 2 抽取 → Stage 3 评分 → Stage 4 HITL 审核 → Stage 5 编译 → Stage 6 Lint → Stage 7 展示 → Stage 8 回写）。测试文档来源三选一（按优先级）：

1. **本地现成样本**（推荐，零依赖）：`data/samples/idd_wip_sample.docx`（MES 的 WIP IDD 样本，走 Docling :5001）。命令：
   ```bash
   MINERU_ENDPOINT=http://localhost:8888 DOCLING_ENDPOINT=http://localhost:5001 MARKITDOWN_ENDPOINT=http://localhost:5002 \
   node .agents/skills/cim-wiki/scripts/parse.mjs data/samples/idd_wip_sample.docx --module wip-management
   ```
2. **用户提供的夸克分享链接**：试 `saveas` 转存后 `download`（若同样被 -104 拦截则转方式 1/3）。
3. **用户手动放到本地路径的 PDF/DOCX**：告知路径 + 模块名后用 skill 摄取。

> 抽取与评分环节由 Agent 按 `.agents/skills/cim-wiki/references/extraction.md`、`evaluation.md` 直接完成，无需外部 LLM API Key；HITL 审核须生成聚合变更卡片等待用户裁决。

**优先级 2 — Project Registry 实战验证**：
- 为 `mes-wip` 项目创建首个 `project-registry.json` 条目（含 docs、repos、module_mapping）。
- 配置 git submodule 指向实际文档/代码仓库（或 mock 仓库）。
- 运行 `sync-repo.mjs mes-wip --dry-run` 验证增量检测逻辑。
- 跑一次完整 Stage 0→8 流水线，验证 project-registry 回写。

**优先级 3 — Admin 前端 + Docker 统一编排 + wiki↔admin 打通**（全部完成）：
- ✅ **Admin 前端 SPA 已实现**（`admin/`，Vue 3.5 + TypeScript + Vite 7 + **TDesign Vue Next 1.19** + Pinia + vue-i18n）：概览 Dashboard、项目列表 CRUD、项目详情（文档/仓库/模块/令牌/同步日志/Wiki 节点 6 个 Tab）。对标 `weknora-custom/frontend` 约定（axios `/api/v1` 客户端 + Bearer 拦截器、`createWebHistory('/admin/')` 路由、Pinia setup-store、`t-table`/`t-dialog`/`t-form` CRUD 配方、`MessagePlugin`/`DialogPlugin`/`NotifyPlugin` 交互、`theme-mode` 深浅色、品牌绿 `#07c05f`）。**框架选型最终定为 TDesign**：曾一度迁移到 Element Plus，但因后续 admin 需与 weknora 深度整合（weknora 前端主库即 tdesign-vue-next），已**整体回退到 TDesign** 以统一组件体系、token 主题与集成契约。已通过 `vue-tsc` 类型检查 + `vite build` 产物验证 + 镜像重建（`vendor-tdesign` chunk，无 element-plus 残留，:8099/:8095 `/admin/` 均 200）。
  - ✅ **UI/交互打磨（2026-10，随回退保留）**：抽出共享基座 `admin/src/components/PageHeader.vue`（统一页头/操作区，移动端换行占满）与 `admin/src/composables/useBreakpoint.ts`（单一 `<768px` 断点，替换各视图散落的 resize 监听）；`theme.css` 采用 weknora 的 `--td-*` token 体系 + 间距刻度 `--cim-space-{xs..xl}` + 移动端对话框近似全屏。AdminLayout：自定义 `.admin-sidebar` 桌面可折叠、`<768px` 转遮罩抽屉 + 顶栏汉堡、`t-breadcrumb`、语言切换 + `theme-mode` 深浅色。Dashboard：统计卡语义色图标 + `t-skeleton` 骨架、最近项目 `t-empty` 空态并限显。ProjectManagement：`t-table` 分页 + `t-empty`（含新建引导）+ 行操作「编辑内联 + `t-dropdown` ⋯（详情/删除，danger）」+ 移动端隐藏次要列 + `t-form` rules 校验（ID 实时清洗、`close-on-overlay-click=false`）。ProjectDetail：**令牌「仅显示一次」独立弹窗**（只读 `t-textarea` + 复制 + `t-alert` warning，确认即销毁明文，禁遮罩/ESC 误关）、各表 `t-empty`、Wiki plane 语义 `t-tag`、`t-link` 深链新标签、异步错误统一 `NotifyPlugin`（优先展示后端 message）。
- ✅ **Docker 统一编排**：`deploy/admin/{Dockerfile,nginx.conf}`（node 构建 → nginx 静态托管 + `/api` 反代 server:8080）；admin 服务纳入默认 `docker compose up -d`（不再用 profile 隔离）；server 默认 `ADMIN_ENABLED=true`，`depends_on postgres: service_healthy`（必选）。`deploy/server/Dockerfile` 仅 `COPY bin/cim-wiki-server`（**需先本地 `go build`**，见下）。访问 `http://<宿主机IP>:8095/admin/`。
- ✅ **wiki↔admin 自动回写链路已接通**（此前仅 API/数据模型层通，脚本未接线）：
  - 新增 `scripts/admin-client.mjs`：统一 Admin HTTP 客户端，env 驱动（`ADMIN_URL` 未设=离线全 no-op；`ADMIN_PROJECT_TOKEN` 用于 config/sync-status 保护端点；`ADMIN_PROJECT_ID` 显式指定目标项目，否则按模块归属解析）。
  - `scripts/admin-pull.mjs`（**Stage 0**）：`GET /config` 拉取覆盖本地 `project-registry.json`。
  - `compile.mjs`（**Stage 5**）：编译后 `POST /wiki-nodes` 回写索引；失败仅告警不阻断。
  - `sync-repo.mjs`（**Stage 0 增量**）：检出变更后 `POST /sync-status` 记录 sync_logs。
  - SKILL.md 步骤 0/8 已改写为"脚本自动回写 + env 开关"模型。
- ✅ **端到端验证**（全 docker 栈）：Stage 0 pull 落地 6 文档/1 仓库/38 模块；sync-status 回写使 `sync_logs` 增长并含 to_sha/changed_files/duration；compile 回写使 `project_wiki_nodes` doc/code 各 +1；测试数据与令牌均已清理回基线。
- ✅ **展示级深链闭环 + 按项目分树**：wiki 物理树改为 `data/wiki/<project>/{doc,code}/...`（VitePress `base=/wiki/`），完整访问 URL 形如 `/wiki/xinshun-mes/doc/business/br-wip-001`。流水线三处同步改造：`compile.mjs`（写入 `<wikiRoot>/<project>/...`，回写路径带 project 段，project 由 `ADMIN_PROJECT_ID` > 单项目 registry > bundle.project 解析）、`gen-sidebar.mjs`（按项目子目录扫描并生成 `/<project>/...` 链接）、`gen-manuals.mjs`（人读视图同分树）。`GetProject` 从 `project_wiki_nodes` 表回填 `wiki_nodes`；Admin「Wiki 节点」Tab 每条 path 渲染为可点击外链，路径按 `data/wiki/<project>/<rel>.md → /wiki/<project>/<rel>`（cleanUrls 无扩展名）转换，经统一网关直达（新标签打开）。网关根 `/` 相对 302 → `/wiki/`（`absolute_redirect off` 保留 `:8099` 端口）。
- ✅ **网关统一会话登录鉴权（wiki + admin，2026-10）**：`/wiki/` 与 `/admin/` 不再裸奔，由 gateway 统一门控（选型理由：admin 后续须与 weknora 整合，两处浏览面共享同一会话）。机制——后端 `internal/handler/auth.go` 签发 **无状态 HMAC-SHA256 会话 cookie**（`<base64url(user|exp)>.<hexHMAC>`，HttpOnly + SameSite=Lax，`AUTH_COOKIE_SECURE` 上 HTTPS 后置 true）；gateway nginx 对 `/wiki/`、`/admin/` 加 `auth_request /_auth`（internal 子请求打后端 `GET /api/v1/auth/verify`，转发 `$http_cookie`），401 经 `error_page … = @need_login` 跳 `GET /login`（登录页 `deploy/gateway/login.html`，内联 CSS/JS、自包含）并带 `?next=` 回填原目标；登录 JS 仅接受站内相对 `next`，拒 `//host` 开放重定向。`/api/` **不门控**（流水线 project-token 走 Bearer；login/verify 本身须公开可达）。`AUTH_ENABLED=false` 时 `verify` 恒返回 200（透明门控、绝不误锁，便于灰度/回退）。**凭证来源=机制先行**：暂由 env 提供单一口令（`AUTH_USERNAME`/`AUTH_PASSWORD`，或更安全用 `AUTH_PASSWORD_SHA256`=sha256(pw) 小写十六进制；`authenticate()` 为待替换的 seam，后续接 Postgres users/LDAP/SSO 只改此处）。`authenticate` 走 `subtle.ConstantTimeCompare`。**默认口令为占位值，上线前务必覆盖 `AUTH_SESSION_SECRET` 与口令**。`deploy/docker-compose.yml` server 段已注入 `AUTH_*`（默认开启）。全链路 curl 验证：未登录 `/wiki/`→302 `/login?next=/wiki/`；`/login`→200；错误口令→401；正确口令→200 且 `Set-Cookie`；带 cookie `/wiki/`+`/admin/`→200、`verify`→200 authenticated；`logout`→200 清 cookie 后 `/wiki/` 复回 302；`AUTH_ENABLED=false` 起服务 verify 恒 200。`nginx -t` 通过，server+gateway 镜像重建、`:8099` 端到端复验。
- ⏳ **待人工清理（需 sudo，root 属主）**：迁移后 `data/wiki/` 顶层残留两个平面化前的废弃目录 `business/`、`operations/`（早期容器以 root 写入、已被 `xinshun-mes/` 分树取代、不被侧边栏引用、不影响 `/wiki/` 深链）。请在宿主机执行：`sudo rm -rf data/wiki/business data/wiki/operations`。
- ⏳ **后续（生产加固）**：HTTPS、RBAC；凭证来源从 env 单口令升级为 Postgres users 表 / LDAP / SSO（改 `AuthHandler.authenticate` 即可，会话机制无需变动）；`/api/v1/admin/*` 管理端点可选纳入同一会话校验（当前仍靠 `ADMIN_ENABLED` + 网络策略 + project-token）；登录失败暂无限流/锁定。token 明文仅签发时返回一次，控制台与 DB 均不存明文（存 SHA256）。



### 环境速查

| 项 | 值 |
|----|----|
| 项目根 | `/docker/cim-llm-wiki` |
| Node.js | ≥ 20（当前 v22.23.1） |
| 站点端口 | dev 5174（固定绑定，与主机防火墙对齐） |
| 统一入口 Gateway | `:8099` → `/wiki/` 知识库、`/admin/` 控制台、`/api/` 后端、`/login` 登录页；`/` 302→`/wiki/`（`deploy/gateway/`，对外只需开此端口）。`/wiki/`+`/admin/` 经 `auth_request` 会话门控 |
| 访问鉴权（会话登录） | env：`AUTH_ENABLED`(默认 true) + `AUTH_SESSION_SECRET` + `AUTH_USERNAME`/`AUTH_PASSWORD`(或 `AUTH_PASSWORD_SHA256`) + `AUTH_COOKIE_NAME`/`AUTH_SESSION_TTL_HOURS`/`AUTH_COOKIE_SECURE`；凭证 seam=`AuthHandler.authenticate`（待接用户库） |
| MinerU / Docling / MarkItDown | :8888 / :5001 / :5002 |
| 流水线 skill | `.agents/skills/cim-wiki/SKILL.md`（Stage 0→8 定义） |
| Project 注册表 | `data/documents/project-registry.json` |
| 增量同步脚本 | `.agents/skills/cim-wiki/scripts/sync-repo.mjs` |
| Submodule 数据源 | `data/sources/<project-id>/docs|code/` |
| Admin API | `ADMIN_ENABLED=true` + PostgreSQL :5432（compose 中宿主映射 :5433） |
| Admin 端点前缀 | `/api/v1/admin/` |
| Admin 前端 SPA | `admin/`（Vue3+**TDesign Vue Next**，响应式，base `/admin/`，dev :5175，容器 :8095） |
| Admin 前端联调 | `cd admin && npm install && npm run dev`（代理 `/api`→:8090）；构建 `npm run build` |
| Admin 脚本回写 | env: `ADMIN_URL`（未设=离线）+ `ADMIN_PROJECT_TOKEN` + `ADMIN_PROJECT_ID`（可选） |
| 启动引擎容器 | `cd deploy && docker compose up -d mineru docling markitdown` |
| 统一启动全栈 | `CGO_ENABLED=0 go build -o bin/cim-wiki-server ./cmd/server` → `cd deploy && docker compose up -d --build server admin`（Admin 默认启用，访问 :8095/admin/） |

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
| 展示 | 无 | **VitePress**（独立 wiki/ 子工程，srcDir=../data/wiki，`cd wiki && npm run docs:dev`） |
| Go 代码 | 主体 | **遗留只读**：mineru.go/docling.go 为 HTTP 契约权威参考，不再演进 |

技术选型对比与 Phase 3 检索层建议见 **docs/TECH-STACK.md**。

**目录语义**：`docs/` = 本项目工程文档；`data/wiki/` = LLM 流水线产出的知识库（运行时生成，.gitignore）。

工作流入口：Agent 会话中调用 `cim-wiki` skill（`.agents/skills/cim-wiki/SKILL.md`），9 阶段流程（Stage 0→8）与规则全部在 skill 内定义。

---

## 0.1 Project Registry 架构（v2.1 新增）

### 设计目标

建立 **Project ↔ Documents ↔ Code Repos** 的完整关联，支持：
1. Admin 系统集中管控项目配置，skill 通过 project-token 获取
2. git submodule 挂载源文档与代码仓库到本地
3. 增量同步：检测 submodule 变更 → module_mapping 定位受影响模块 → 触发重新摄取
4. 编译后自动回写 wiki_nodes 索引，状态闭环

### 架构分层

```
┌─────────────────┐  project-token   ┌──────────────────┐
│   Admin 系统     │ ───────────────→ │   cim-wiki skill │
│  (集中管理)      │ ←── 状态回写 ─── │   (本地执行)      │
│                  │                  │                  │
│ • Project CRUD   │                  │ • Stage 0: 配置  │
│ • Token 签发     │                  │ • Stage 1-6: 流水线│
│ • 同步状态监控   │                  │ • Stage 8: 回写   │
└────────┬─────────┘                  └────────┬─────────┘
         │                                     │
         │ 管理元数据                           │ git submodule
         ▼                                     ▼
┌─────────────────┐                  ┌──────────────────┐
│  Admin API      │                  │  data/sources/   │
│  + Web UI       │                  │  ├─ <proj>/docs/ │
│  (规划中)       │                  │  └─ <proj>/code/ │
└─────────────────┘                  └──────────────────┘
```

### 数据模型

**project-registry.json**（`data/documents/project-registry.json`）：

```json
{
  "projects": {
    "<project-id>": {
      "id": "<project-id>",
      "name": "人读名称",
      "product": "Semiconductor-MES",
      "version": "V2.22.4",
      "docs": [{ "doc_id": "...", "path": "data/sources/.../docs/...", "type": "IDD", "sha256": "...", "submodule": "data/sources/.../docs" }],
      "repos": [{ "name": "...", "url": "git@...", "branch": "main", "submodule": "data/sources/.../code", "module_mapping": { "src/.../wip/": "wip-management" }, "last_sync_sha": "..." }],
      "modules": ["wip-management"],
      "wiki_nodes": { "doc": ["data/wiki/xinshun-mes/doc/..."], "code": ["data/wiki/xinshun-mes/code/..."] },
      "sync_state": { "last_doc_sync": "...", "last_code_sync": "...", "pending_changes": 0 }
    }
  }
}
```

Go 类型定义见 `internal/types/types.go`：`ProjectConfig`、`DocSource`、`RepoBinding`、`ProjectToken`、`SyncState`、`ProjectRegistry`。

### Git Submodule 策略

```
data/sources/<project-id>/
├── docs/    ← submodule: 源文档仓库（IDD/SDD/PRD/手册）
└── code/    ← submodule: 代码仓库（仅 module_mapping 索引，不复制源码）
```

- skill 步骤 0 自动检查 submodule 状态，未初始化时提示 `git submodule update --init`
- `sync-repo.mjs` 执行 `git fetch` + `git diff lastSyncSHA..HEAD --name-only`
- 变更文件通过 `module_mapping`（路径前缀 → 模块 ID）映射到受影响业务模块
- 代码仓库仅用于建立索引，**严禁将源码全文写入 wiki**

### 增量同步工作流

```
sync-repo.mjs <project-id>
  │
  ├─ git fetch + diff → 变更文件清单
  ├─ module_mapping → 受影响模块列表
  ├─ sha256 比对 → 文档变更检测
  │
  ▼
data/sync/<project-id>-diff-snapshot.json
  │
  ▼ (人工或自动触发)
对受影响模块的源文档重新执行 Stage 1→6
  │
  ▼
Stage 8: 更新 lastSyncSHA + 回写 Admin
```

### Admin API（已实现）

所有端点前缀 `/api/v1/admin/`，需 `ADMIN_ENABLED=true` + PostgreSQL（`deploy/docker-compose.yml` 中 `postgres` 服务）。

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

**启用方式**：
```bash
# docker-compose 中设置 ADMIN_ENABLED=true
cd deploy && ADMIN_ENABLED=true docker compose up -d server postgres

# 或本地开发
ADMIN_ENABLED=true \
ADMIN_DATABASE_URL=postgres://cimwiki:cimwiki_dev_2026@localhost:5432/cim_wiki_admin?sslmode=disable \
go run ./cmd/server
```

**PostgreSQL schema**：`deploy/postgres/001_init.sql`（9 张表），容器首次启动自动执行。

**离线模式**：未启用 Admin 时，skill 以本地 `data/documents/project-registry.json` 为唯一配置源，步骤 8 仅更新本地 JSON，零外部依赖。

### 新增文件清单

| 文件 | 说明 |
|------|------|
| `data/documents/project-registry.json` | Project 注册表（第三类全局注册表） |
| `data/sources/README.md` | Submodule 目录说明 |
| `.agents/skills/cim-wiki/scripts/sync-repo.mjs` | 增量同步脚本 |
| `internal/types/types.go` (新增类型) | ProjectConfig / DocSource / RepoBinding / ProjectToken / SyncState / ProjectRegistry |
| `deploy/postgres/001_init.sql` | PostgreSQL schema（9 张表 + 索引 + 触发器） |
| `internal/store/postgres.go` | pgx 连接池 + Admin CRUD 存储层 |
| `internal/handler/admin.go` | Admin API handler（12 个 REST 端点 + token 认证中间件） |
| `internal/config/config.go` (新增) | AdminConfig 配置段 |
| `cmd/server/main.go` (更新) | Admin 模块初始化 + 路由注册 + migration 加载 |
| `deploy/docker-compose.yml` (更新) | PostgreSQL 16 服务 + server Admin 环境变量 + admin 控制台服务 |
| `admin/` (前端工程) | Vue3+TS+Vite7+**Element Plus**+Pinia+vue-i18n 响应式管理控制台 SPA |
| `admin/src/api/{client,types,projects}.ts` | axios 客户端 + Bearer 拦截器 + 后端 JSON 形状类型 + 端点封装 |
| `admin/src/views/admin/*.vue` | AdminLayout / Dashboard / ProjectManagement / ProjectDetail |
| `admin/src/components/PageHeader.vue` | 统一页头组件（标题+副标题+操作区插槽） |
| `admin/src/composables/useBreakpoint.ts` | 响应式断点单一来源（`<768px`） |
| `admin/src/{router,stores,i18n}` | 路由（base `/admin/`）+ Pinia auth store + 中英 i18n |
| `deploy/admin/Dockerfile` | 多阶段构建：node 打包 → nginx 静态托管 + `/api` 反代 |
| `deploy/admin/nginx.conf` | SPA history fallback + `/api` 反向代理 + gzip |

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
