# QA Review Report Template

> 本文件供 `qa` 技能在完成文档合规性全盘勘出后，格式化呈递检查结果。

## Review Profile
- **Review Date**: YYYY-MM-DD HH:MM
- **Reviewer**: QA Agent
- **Target Document**: `docs/development/issues/issue-123.md`
- **Final Conclusion**: [Passed / Blockers / Warning]

---

## Defects Intercepted

| Rule Dimension | Violation | Fix Requirement & Guideline | Severity |
|---------|--------|----------|--------|
| **Naming Convention** | 文件名的前缀使用了大写 `ISSUE-123.md` | 必须将其重命名为全小写前缀 `issue-123.md` | 🚨 Blocker |
| **Structural Layout** | Markdown 少填了 README 要求的 "规避方案" 块 | 严禁违反所在目录的排版指令，请补充该节内容 | 🚨 Blocker |
| **Language Boundaries** | 代码演示块里的行内注释错用了中文 | 代码上下文和内连变量必须全部改为对应的原生英文 | ⚠️ Warning |

---

## Final Conclusion
- [ ] ✅ **Passed** — 命名的文件名称与所有内部结构排版均 100% 符合规范边界
- [ ] ❌ **Blockers** — 存在触碰红线的命名或格式结构破坏行为，已被打回并冻结后续流转
