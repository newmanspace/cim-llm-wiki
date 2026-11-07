# Git Commit 消息正确示例集

> 本文件供 `git-commit` 技能在生成提交消息时作为 Few-shot 参考样例。
>
> **注意**：必须关联 GitHub Issue，可在标题末尾使用当前仓库的 `(#<issue_id>)`，或在正文末尾使用 `Issue:` 编号/完整 GitHub Issue 链接。本地文档仅可通过 `Issue-Doc:` 可选补充，不能替代 GitHub Issue。以下路径、链接与编号仅演示格式，实际提交应替换为真实关联。

## ✅ 正确格式

```
feat(chat): add auto-reply keyword matching (#8)
```
```
fix(orders): fix price change sync and delivery timeout (#5)
```
```
refactor(common): extract order service to shared module (#12)
```
```
docs(readme): update deployment guide (#5)
```
```
test(websocket): add auto-delivery handler edge case tests (#10)
```

GitHub Issue 与可选的本地文档同时关联：

```
chore(github): add issue forms (#25)

Issue-Doc: docs/issues/issue-templates.md
```

在线 Issue 完整链接（无需本地文档）：

```
fix(auth): reject expired sessions

Issue: https://github.com/owner/repo/issues/25
```

## ❌ 违规格式 (绝对禁止)

```
Added new feature for auto reply                                               ← 过去时态，无类型，无 Issue 关联
```
```
feat(chat): Add Auto Reply Keyword Matching.                                    ← 首字母大写，末尾有句号
```
```
feat(chat): add all configurable keyword matching actions and automatic reply handling for every incoming conversation event (#8) ← 标题超过 120 字符
```
```
fix: resolve bug                                                                ← 缺少 GitHub Issue 关联，且描述不明确
```
```
fix(orders): fix price sync /absolute/path/to/project/order.py (#5)     ← 使用了完整绝对路径而非简明描述
```

```
chore(github): add issue forms

Issue-Doc: docs/issues/issue-templates.md
```

仅提供本地文档，没有关联 GitHub Issue，属于违规格式。
