# Refactor Review Report Template

## Review Profile
- **Review Date**: YYYY-MM-DD HH:MM
- **Reviewer**: Refactor Review Agent
- **Target Document**: REFACTOR-XXX-<name>
- **Final Conclusion**: [Approved / Risks / Rejected]

---

## Review Conclusion
- [ ] **Approved** - 重构符合全部原则
- [ ] **Risks** - 存在风险点需关注
- [ ] **Rejected** - 违反核心原则，需重新重构

## Review Checklists

| Checklist Item | Status | Remarks |
|--------|------|------|
| 重构文档完整 | ✅/❌ | |
| 分层架构合规 | ✅/❌ | |
| 测试先行原则 | ✅/❌ | |
| 自下而上顺序 | ✅/❌ | |
| 上层测试覆盖 | ✅/❌ | |
| 代码质量达标 | ✅/❌ | |
| 架构一致性 | ✅/❌ | |

## Issues Found

### Critical (Blockers)

- [ ] 无
- [ ] 问题描述及影响

### High (High Priority)

- [ ] 无
- [ ] 问题描述及影响

### Medium (Medium Priority)

- [ ] 无
- [ ] 问题描述及影响

## Fix Recommendations

<具体修改指引>

## Appendix

### Test Coverage

```
Name                    Stmts   Miss  Cover
-------------------------------------------
common/services          X       Y     Z%
```

### Change Statistics

```
X files changed, +N insertions(+), -M deletions(-)
```

### Git Commit History

```
<git log --oneline 输出>
```

### Review References

- [REFACTOR-XXX-*.md](../../../docs/development/refactoring/REFACTOR-XXX-*.md) - 重构文档
