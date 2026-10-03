---
name: github-issue
description: >
  统一管理 GitHub Issue：创建、搜索、查询、更新、添加评论及关闭问题。
  支持缺陷上报与功能需求追踪，内置强制敏感信息脱敏校验规范。
---

# GitHub Issue 缺陷与需求管理 (GitHub Issue)

本技能负责在 GitHub 仓库中管理全生命周期的 Issue（创建缺陷、功能需求、添加复盘评论、关闭问题、关联提交）。

- **默认仓库**：`owner: newmanspace`, `repo: cim-llm-wiki`

---

## 🔒 核心红线：信息脱敏规范 (Sanitization First)

GitHub Issue 为公开或团队共享资产，**在提交任何 Issue 标题、正文、日志堆栈或评论前，必须强制执行敏感数据脱敏**：

| 数据类型 | 示例原始数据 | 脱敏规范与示例 |
|---|---|---|
| **订单号/批次号** | `5127271815092007941` | 保留前后 4 位，中间打码：`5127****7941` |
| **手机号/座机** | `13812345678` | 保留前 3 后 4 位：`138****5678` |
| **真实姓名/地址** | 张三，北京市朝阳区... | 姓名打码为 `张*`，详细地址替换为 `[地址脱敏]` |
| **Cookie/Token/密码** | `_m_h5_tk=...; cna=...` | **严禁提交**，统一替换为 `[REDACTED_COOKIE]` 或 `***` |
| **服务器 IP/内网域名** | `192.168.1.100` | 替换为 `10.x.x.x` 或 `internal-service` |

---

## 🛠️ 工具调用与决策表

通过 `github-mcp-server` 工具或 GitHub REST API 操作：

| 用户意图 | 推荐工具 | 关键参数 |
|---|---|---|
| **创建缺陷 / 需求 Issue** | `call_mcp_tool(github-mcp-server, issue_write)` | `action: "create"`, `owner`, `repo`, `title`, `body`, `labels` |
| **查看 Issue 详情** | `call_mcp_tool(github-mcp-server, issue_read)` | `action: "get"`, `owner`, `repo`, `issue_number` |
| **搜索已有 Issue** | `call_mcp_tool(github-mcp-server, search_issues)` | `q: "repo:newmanspace/cim-llm-wiki is:issue <关键词>"` |
| **列出 Issue 列表** | `call_mcp_tool(github-mcp-server, list_issues)` | `owner`, `repo`, `state: "open" / "all"`, `labels` |
| **追加解决备注 / 进展评论** | `call_mcp_tool(github-mcp-server, add_issue_comment)` | `owner`, `repo`, `issue_number`, `body` |
| **更新 / 关闭 Issue** | `call_mcp_tool(github-mcp-server, issue_write)` | `action: "update"`, `owner`, `repo`, `issue_number`, `state: "closed"` |

---

## 📋 常用标签规范 (Labels)

- `bug`: 线上或本地缺陷
- `enhancement`: 新功能或优化
- `documentation`: 文档更新与完善
- `wontfix`: 不予修复或关闭的无效问题
- `help wanted`: 需要额外协助的问题

---

## 📝 模板规范

### 1. Bug 缺陷上报模板
```markdown
## 问题描述
简要说明发生的异常现象与影响范围。

## 涉及订单/上下文（已脱敏）
- 订单号: 5127****7941
- 触发场景: 用户改价后自动发货

## 根因分析
1. **原因 1**: 说明为何发生该错误
2. **原因 2**: 涉及的边界条件与代码缺陷

## 涉及代码文件
- `internal/pipeline/compiler/compiler.go`
- `admin/src/views/admin/ProjectDetail.vue`

## 期望行为
描述修复后的正确逻辑行为。
```

### 2. 修复解决备注模板 (Close / Resolve Comment)
```markdown
### ✅ 修复完成闭环报告

- **根因**: 简要总结根本原因。
- **修复方案**:
  - 调整逻辑 1...
  - 增加字段同步 2...
- **关联 Commit**: `d7f1530`
- **验证结果**: 本地单元测试通过，生产环境部署验证生效。
```

---

## 🔗 Git 提交与 Issue 关联

在执行 `git-commit` 技能时，必须将 GitHub Issue 编号纳入提交信息：
- 格式：`fix(scope): <简明改动说明> (#<issue_id>)`
- 示例：`fix(orders): fix price change sync and handle delivery timeout correctly (#5)`
- 若通过 Pull Request 合并，可使用关键字触发自动关闭：`Closes #5`
