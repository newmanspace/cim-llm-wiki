---
name: git-commit
description: 基于暂存区的变更自动生成符合项目规范的 Git 提交信息
---

# 提交消息生成器 (Git Commit)

本技能负责基于暂存区（Staged）的代码变更，自动代笔一份严格遵循项目规范的标准化提交消息。

## 前置约束
- 只能抓取并分析被标记为暂存 (`git diff --staged`) 的改动。
- 坚决遵循本项目定义好的 Conventional Commits 格式红线。
- 如果暂存区没有任何变更，应立刻终止不作处理。

## 约束标准 (Strict Project Conventions)
- **时态与语气**：必须使用**英文现在时态、祈使句**（如用 "add" 而不是 "added"）。
- **大小写限制**：标题的**首字母必须维持小写**。
- **长度限制**：标题行的总长度建议在 120 个字符以内。
- **CRITICAL (最核心关联)**：**必须关联真实的 GitHub Issue**，可使用当前仓库的 Issue 编号或完整 GitHub Issue 链接。关联可写在标题末尾，或提交正文末尾的 `Issue:` 行。**本地 Issue 文档为可选补充，不能替代 GitHub Issue**。提交前确认关联 Issue 与暂存区变更对应；若附带本地文档，确保文档存在且已更新。

## 执行步骤

### 1. 检查暂存区状态 (Pre-check)
- 运行 `git status` 检查是否存在“未暂存”的改动。
- **特别注意**：在重命名场景下，如果只 `git add` 了新文件，原文件的删除状态可能仍处于 `not staged`。必须确保所有预期的变更（含删除、重命名）均已进入暂存区 (`git add -A`)。
- 如果暂存区为空，不可强行继续。

### 2. 扫描暂存区变更 (Analyze Staged)
- 在后台读取 `git diff --staged` 的详细变更逻辑。
- 获取 `git diff --staged --stat` 的变更文件范围概览。
- 从中智能识别出本次变更的业务范畴 (Scope) 与实质动作类型 (Type)。

### 3. 匹配许可的提交类型
只能从以下 **项目唯一指定** 的 6 种动作类型中挑选：

| 类型 | 使用场景 |
|------|-------------|
| `feat` | 新增了特性或新接口 |
| `fix` | 修复了某个 Bug |
| `docs` | 只动了说明文档，未触及代码 |
| `refactor` | 重构（既没加新功能、也没修 Bug 的代码级改造） |
| `test` | 新增或补全了自动化测试用例 |
| `chore` | 配置文件构建、依赖包升级等琐事 |

### 3.5. CI Flow 检查 (新增)
- 读取 `.github/workflows/pr-tests.yml` 确认 CI 检查要求
- 根据变更文件类型判断需要执行的测试范围：
  - `src/` 变更 → 需要运行 unit tests + service tests
  - `tests/` 变更 → 需要运行对应的测试用例
  - 仅 `docs/` 变更 → 可跳过测试
- 确认变更符合 CI 检查要求（如代码规范、测试覆盖率）

### 4. 获取作用域 (可选 Scope)
判断是否能精确到一个业务模块：
- 比如组件层（`pipeline`, `admin`, `wiki`, `gateway`, `parser`）
- 比如特性切片（`compiler`, `validate`, `rules`, `registry`, `auth`）

### 5. 组装并格式化标题
最终的拼接公式：`<type>(<scope>): <description> [GitHub Issue 关联]`，其中 scope 可选；标题未提供 GitHub Issue 关联时，必须在正文中提供。

- 标题示例：`docs(readme): update deployment guide (#5)`。
- 当前 GitHub 仓库的 Issue 可简写为 `(#5)`；跨仓库使用完整 GitHub Issue 链接。
- 链接较长时，标题只写描述，在正文末尾使用 `Issue: <GitHub Issue 链接>`，避免标题超过 120 字符。
- 可额外使用 `Issue-Doc: <本地 Issue 文档路径>` 引用补充文档。

正确与违规示例请参见 [提交消息示例](assets/good-commit-messages.md)。

### 6. 生成说明正文 (可选 Body)
如果变更需要解释，或需在正文中放置 Issue 关联：
- 在标题下方空出一行。
- 正文用来解释"你改了什么（WHAT）"以及"为什么要改（WHY）"，而不是复述"你是怎么改的代码细节（HOW）"。
- 正文建议在 120 个字符处自动换行折断。

### 7. 交由用户执行提交
将最终构思好的提交信件展示给用户，由用户选择：
- 照单全收并执行 commit；
- 微调后手动执行。

---

## 提交格式红线 (Git Commit Format Rules)

### 标准格式
```
<type>(scope): <subject> [GitHub Issue 关联]

Issue: <GitHub Issue 编号或完整链接>
Issue-Doc: <本地 Issue 文档路径，可选>
```

标题已关联 GitHub Issue 时，`Issue:` 行可省略；否则该行必填。`Issue-Doc:` 行始终可选。

**示例**:
```
fix(orders): fix price change sync and handle delivery timeout (#5)
feat(chat): add auto-reply keyword matching (#8)
docs(readme): update installation steps (#5)
```

### Type 定义
| 类型 | 使用场景 |
|------|----------|
| `feat` | 新功能或新接口 |
| `fix` | Bug 修复 |
| `docs` | 仅文档更新 |
| `refactor` | 代码重构（无功能变化） |
| `test` | 测试新增或修改 |
| `chore` | 构建/工具/配置/依赖 |

### Subject 规范
- **时态**: 英文现在时、祈使句（用 "add" 不用 "added"）
- **大小写**: 首字母必须小写
- **长度**: 建议不超过 50 字符，最大 120 字符
- **标点**: 末尾禁止使用句号 `.`

### Issue 关联（GitHub Issue 必需，文档可选）
- **必需的 GitHub Issue**：引用真实的 GitHub Issue 编号或链接，例如 `(#5)` 或 `Issue: https://github.com/owner/repo/issues/5`。单独的本地文档、GitLab/Redmine Issue 或 PR 编号均不能替代 GitHub Issue。
- **可选的本地 Issue 文档**：在已关联 GitHub Issue 的基础上，可用 `Issue-Doc: docs/issues/issue-005.md` 补充详细分析或实施方案；仓库内优先使用相对路径，不强制另建文档。
- 不得编造文档路径、链接或编号。无法读取关联内容时应说明未核验，不得声称已核验；尚无 GitHub Issue 时，先确认对应的已有 Issue 或按授权建立 Issue，再完成提交信息，不自动创建重复记录。
- `Issue:` 仅表示引用。只有确实完成 GitHub Issue 的全部验收条件、并希望触发自动关闭时，才使用 `Closes #<编号>` / `Fixes #<编号>`；本地文档不使用在线关闭关键字。

---

## ⛔ 禁止自动提交 (No Auto Commit)

**核心红线**: 任何情况下都**不得自动执行** `git commit` 或 `git push`，必须等待用户明确指令。

**Why**: 用户希望完全控制 Git 提交时机，避免意外提交未审查的代码或敏感信息。

**How to apply**:
- 完成代码修改后，展示变更内容并询问用户是否提交
- 即使用户之前授权过提交，每次仍需重新确认
- 允许执行 `git add` 和 `git status`，但提交前必须确认

---

## 提交前检查清单

- [ ] 运行测试通过 (参考 `.github/workflows/pr-tests.yml`)
- [ ] 代码已格式化 (ruff format)
- [ ] 代码规范检查通过 (ruff check)
- [ ] 重要变更已通过 Code Review
- [ ] 所有变更已暂存 (`git add -A`)
- [ ] 相关文档已更新
- [ ] 已关联真实的 GitHub Issue 编号或链接，并与本次变更对应
- [ ] 若附带本地 Issue 文档，文档可定位且已更新（可选）
- [ ] CI Flow 检查确认 (根据变更类型判断需要的测试范围)
