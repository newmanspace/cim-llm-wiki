# AI Agent Framework — CIM LLM Wiki

> 本目录为 **cim-llm-wiki** 的工作区 Customization 根目录（`.agents/`），提供完整的 CIM 知识工程流水线及现代软件工程全生命周期技能套件。

项目工程执行以 [AI 开发规范](../docs/doc/30-standards/ai-development-standard.md)、[Coding Standard](../docs/doc/30-standards/coding-standard.md) 和 [Testing Standard](../docs/doc/30-standards/testing-standard.md) 为共同依据。下述技能及完整工作流按任务需要采用；常规修改不强制创建完整文档链或逐级审批，用户已有授权不重复确认，提交和部署仍按具体授权执行。

---

## 目录结构

```
.agents/
├── README.md              # 技能与工作流全景导引
├── settings.local.json    # 本地环境配置
├── skills/                # 17 个独立技能（1 个知识工程核心 + 16 个工程化技能）
│   ├── cim-wiki/          # ★ 核心：泛半导体 CIM 文档知识工程流水线
│   ├── code/              # TDD 驱动编码
│   ├── code-review/       # 代码质量与安全审查
│   ├── dba-review/        # 数据库设计审查 (PostgreSQL)
│   ├── deploy/            # 全栈 Docker 容器部署与状态巡检
│   ├── design/            # 架构方案设计
│   ├── design-review/     # 架构方案评审
│   ├── git-commit/        # 英文规范化 Git 提交信息代笔
│   ├── github-issue/      # GitHub Issue 管理与安全脱敏
│   ├── issue-analysis/    # 缺陷根因分析
│   ├── qa/                # 文档与代码合规性审查
│   ├── readme/            # README 自动生成与维护
│   ├── refactor/          # 代码重构 (TDD + 分层)
│   ├── refactor-review/   # 重构方案审查
│   ├── release/           # 版本发布与 Git Tag
│   ├── requirement/       # 需求分析与 URD 规约
│   └── test/              # 自动化测试执行
└── workflows/             # 4 条主控工作流
    ├── feature.md         # 新功能开发
    ├── issue.md           # 缺陷修复
    ├── refactor.md        # 代码重构
    └── release.md         # 版本发布
```

---

## 核心业务技能：cim-wiki

| 技能 | 目录 | 适用场景 | 核心链路 |
|---|---|---|---|
| **cim-wiki** | `skills/cim-wiki/` | 泛半导体 CIM 原始文档知识工程化 | 本地解析 → 知识抽取（契约/规则） → 7维评分 → HITL 聚合审核 → 编译入库 → Lint 校验 → VitePress 渲染 |

---

## 通用工程技能矩阵 (Engineering Skills)

| 技能分类 | 技能名称 | 目录 | 核心作用 |
|---|---|---|---|
| **架构与需求** | `requirement` | `skills/requirement/` | 需求分析与 URD 规约生成 |
| | `design` | `skills/design/` | 架构方案设计与防呆设计 |
| | `design-review` | `skills/design-review/` | 方案技术评审与可行性论证 |
| **编码与质量** | `code` | `skills/code/` | TDD 驱动开发编码 |
| | `code-review` | `skills/code-review/` | 代码规范、安全漏洞与逻辑防呆审查 |
| | `test` | `skills/test/` | 自动化单元与集成测试执行 |
| | `dba-review` | `skills/dba-review/` | PostgreSQL 表结构、索引与迁移脚本审查 |
| | `refactor` | `skills/refactor/` | 代码重构实施（测试先行） |
| | `refactor-review` | `skills/refactor-review/` | 重构方案与边界审查 |
| **版本与协同** | `git-commit` | `skills/git-commit/` | 英文 Conventional Commits 提交信息代笔 |
| | `github-issue` | `skills/github-issue/` | GitHub Issue 创建/更新/复盘与脱敏红线 |
| | `issue-analysis` | `skills/issue-analysis/` | 缺陷与报错根因深入分析 |
| | `qa` | `skills/qa/` | 文档格式与目录规范审查 |
| | `readme` | `skills/readme/` | 结构化 README 自动生成 |
| **部署与交付** | `deploy` | `skills/deploy/` | Docker Compose 全栈容器部署与日志监控 |
| | `release` | `skills/release/` | 版本发布流水线与变更日志生成 |

---

## 主控工作流 (Workflows)

| 工作流 | 触发命令 | 适用场景 | 核心编排链路 |
|---|---|---|---|
| [新功能开发](workflows/feature.md) | `/feature` | 新增特性或接口 | requirement → design → design-review + dba-review + qa → [Approve] → code → code-review → test → git-commit → deploy |
| [缺陷修复](workflows/issue.md) | `/issue` | 报错排查与 Bug 修复 | issue-analysis → qa → [立案] → code → code-review → test → git-commit → deploy |
| [代码重构](workflows/refactor.md) | `/refactor` | 架构与模块重构 | 文档设计 → [审批] → 测试基线 → 分层重构 → refactor-review + code-review → test → git-commit → deploy |
| [版本发布](workflows/release.md) | `/release` | 生产发版与打包 | 版本号确定 → Release Notes → SQL 检查 → 配置核验 → 部署 → Tag 归档 |
