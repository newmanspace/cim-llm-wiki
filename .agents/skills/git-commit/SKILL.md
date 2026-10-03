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
- **CRITICAL (最核心关联)**：**必须**在提交信息末尾提供关联的 GitHub Issue 编号（例如 `#5` 或 `(#5)`），以及（或可选）本地 Issue/Feature 文档名称（例如 `issue-005` 或 `feature-auto-reply`）。在提交前必须确保相关文档已更新完毕。

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
最终的拼接公式：`<type>(<scope>): <description> <doc_name>`

正确与违规示例请参见 `git-commit/assets/good-commit-messages.md`。

### 6. 生成说明正文 (可选 Body)
如果本次代码变更逻辑十分复杂：
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
<type>(scope): <subject> <doc_name>
```

**示例**:
```
fix(orders): fix price change sync and handle delivery timeout (#5)
feat(chat): add auto-reply keyword matching (#8)
docs(readme): update installation steps
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

### GitHub Issue 关联
- 提交信息末尾添加 `(#<issue_id>)` 关联 GitHub Issue
- 或在正文中使用 `Closes #<issue_id>` / `Fixes #<issue_id>` 自动关闭关联 Issue
- 可选：额外添加本地文档名称（如 `issue-005` 或 `feature-auto-reply`）

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
- [ ] CI Flow 检查确认 (根据变更类型判断需要的测试范围)
