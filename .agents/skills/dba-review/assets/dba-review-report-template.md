# DBA Review Report Template

> 本模板用于 `dba-review` 技能输出审查报告时的参考格式。

## Review Profile
- **Review Date**: YYYY-MM-DD HH:MM
- **Reviewer**: DBA Review Agent
- **Target**: [建表 SQL / Schema 变更 / 查询代码]
- **Final Conclusion**: [Approved / Rejected]

---

## 🔴 Blockers (驳回，必须重构)
| # | Location | Violation | Fix Requirement |
|---|----------|-----------|-----------------|
| 1 | `CREATE TABLE xxx` | 审计字段 `created_at` 出现在第 3 行 | 必须移至表末尾 |
| 2 | `src/xxx.py:55` | 使用 `row[0]` 物理索引读取 | 改为 `row["column_name"]` |

## ⚠️ Warnings (建议修正)
| # | Location | Issue | Suggestion |
|---|----------|-------|------------|
| 1 | `SELECT count(*)` | 聚合缺少 `AS` 别名 | 增加 `AS total_count` |

---

## Review Conclusion
- [ ] ✅ **Approved** — Schema 符合规范
- [ ] ❌ **Rejected** — 包含结构性违规，需按上述修正后重新提交
