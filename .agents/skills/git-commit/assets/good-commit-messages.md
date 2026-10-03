# Git Commit 消息正确示例集

> 本文件供 `git-commit` 技能在生成提交消息时作为 Few-shot 参考样例。
>
> **注意**: 提交末尾必须关联 GitHub Issue 编号 `(#<issue_id>)`。可选附加本地文档名称。

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
docs(readme): update deployment guide
```
```
test(websocket): add auto-delivery handler edge case tests (#10)
```

## ❌ 违规格式 (绝对禁止)

```
Added new feature for auto reply                                               ← 过去时态，无类型/scope，无 GitHub Issue 关联
```
```
feat(chat): Add Auto Reply Keyword Matching.                                    ← 首字母大写，末尾有句号
```
```
feat(chat): add a comprehensive auto-reply keyword matching system for users (#8) ← 标题过长（超过 50 字符主体）
```
```
fix: resolve bug                                                                ← 缺少关联的 GitHub Issue 或文档名称，且范围不明确
```
```
fix(orders): fix price sync /absolute/path/to/project/order.py (#5)     ← 使用了完整绝对路径而非简明描述
```
