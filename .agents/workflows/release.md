---
description: 驱动应用版本发布全流程，包括测试验证、版本号更新、发布说明生成与最终部署
---

# 版本发布 (Release)

本工作流是处理新版本发布的主控引擎。当新功能或 Bug 修复均已在开发环境完成并准备打版上线时，触发此工作流。

## 目标与价值 (What it does)

它旨在将分散的测试卡点、版本决策、Release Notes 撰写、依赖清单更新以及最终部署等节点，整合为一个自动化、防呆的安全管线。系统会在后台强制执行前置体检，并在进入不可逆部署动作前将控制权交还给你。

## 智能运作链路

触发该工作流后，系统将依次自主推进以下工作区块：

### 1. 发布前体检区块 (Health Check)
- 调用 `test` 技能：全量执行现有 `pytest` 用例，确保当前通过率 100%。如果不通过，则拦截发布流程，要求先回到修复闭环。

### 2. 准备材料区块 (Drafting)
- 调用 `release` 技能：
  - 检索自上一版本以来的 git commits，总结出新增 Feature、Bug 修补项与破坏性变更。
  - 和你交互决定 Semantic Versioning（SemVer）的新版本号。
  - 自动创建和格式化 `CHANGELOG.md` 及 `Release Notes`，检查各种 SQL 迁移脚本的就绪情况。

### 3. 数据与依赖审查区块 (Review)
- 调用 `dba-review` 技能或参考 `release` 中的 `[sql-migration-commands.md]` 资源表，最终核对数据库待执行的迁移脚本列表和执行顺序。
- 检查 `pyproject.toml` 中的依赖变动是否已经同步到了 `uv.lock`。
- **[人工放行点]**：展示生成的版本档案、待迁移 SQL 列表与回归测试报告，等待你 Approve。

### 4. 落地与部署区块 (Deploy & Tag)
- 调用 `git-commit` 技能：打好包含最终修改的 commit 和 version tag（例如 `vX.Z.Y`）。
- 调用 `deploy` 技能：执行部署、执行数据库 Schema Migration 和 Seed 数据的植入流程。

## 触发场景

| 场景 | 命令示例 |
|------|------|
| 里程碑完成，功能上线 | 用户: "现在 `/release` 打版上线" |
| 紧急热修复完成需推生产 | 用户: "Hotfix 完毕，准备发布新小版本。触发 `/release`" |

## 制约红线

- **Test 零容忍**：即便用户授权，只要有未修复的 P0 红色测试用例，工作流强制抛错并终止发布。
- **配置版本一致性**：`pyproject.toml`、`__init__.py` 或 `docker-compose.yml` 中的版本号必须完全对齐。
- **手动部署分离**：任何真实写入数据库的操作或服务重启操作，都会弹出显式的执行命令列表供用户自行在终端 Copy/Paste，而不是替用户无声敲回车，从而防止造成意外生产事故。

---

**Owner**: Code Committee
**Created**: 2026-04-06
**Last Updated**: 2026-04-06
