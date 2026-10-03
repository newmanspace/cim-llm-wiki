# Code Review Report Template

> 本模板用于 `code-review` 技能输出审查报告时的参考格式。

## Review Profile
- **Review Date**: YYYY-MM-DD HH:MM
- **Reviewer**: Code Review Agent
- **Target Scope**: [涉及的文件/模块列表]
- **Change Type**: feat / fix / refactor
- **Final Conclusion**: [Approved / Conditionally Approved / Rejected]

---

## 🔴 Critical (必须修复，阻断合并)
| # | File:Line | Issue | Fix Suggestion |
|---|-----------|-------|----------------|
| 1 | `src/xxx.py:42` | SQL 拼接未使用参数化，存在注入风险 | 改为 `%(param)s` 参数化写法 |

## 🟡 High (强烈建议修复)
| # | File:Line | Issue | Fix Suggestion |
|---|-----------|-------|----------------|
| 1 | `src/xxx.py:88` | 使用 `row[0]` 物理索引读取 | 改为 `row["column_name"]` |

## 🟢 Medium / Low (建议优化)
| # | File:Line | Issue | Fix Suggestion |
|---|-----------|-------|----------------|
| 1 | `src/xxx.py:120` | 变量命名不够语义化 | 建议重命名为更具描述性的名称 |

---

## Review Conclusion
- [ ] ✅ **Approved** — 无阻断项
- [ ] ⚠️ **Conditionally Approved** — 修复 High 项后可合并
- [ ] ❌ **Rejected** — 存在 Critical 级阻断项
