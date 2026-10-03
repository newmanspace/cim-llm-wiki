# Refactor Progress Report Template

> 本模板用于 `refactor` 技能在重构执行过程中输出阶段性进度报告。
> 注意：这是「执行进度报告」，而非「立案文档」（立案文档请使用 `refactor-document-template.md`）

## Review Profile
- **Report Date**: YYYY-MM-DD HH:MM
- **Reporter**: Refactor Agent
- **Target Document**: REFACTOR-XXX-<name>
- **Final Status**: ✅ Completed / ⚠️ In Progress / ❌ Blocked

---

## Execution Summary

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| 文件数量 | X | Y | -Z% |
| 代码行数 | X | Y | -Z% |
| 测试覆盖率 | X% | Y% | +Z% |
| 工具/接口数 | X | Y | -Z% |

## Layer Progress

| Layer | Status | Test Coverage | Remarks |
|-------|--------|---------------|---------|
| Repository | ✅ | ✅ | |
| Service | ✅ | ✅ | |
| API | ✅ | ✅ | |
| Controller/Router | ✅ | ✅ | |

## Implementation Plan

### Phase 1: Test Preparation
- [ ] 基线测试通过
- [ ] 补充缺失测试
- [ ] 覆盖率 >80%

### Phase 2: Repository Layer
- [ ] 重构完成
- [ ] 单元测试通过

### Phase 3: Service Layer
- [ ] 重构完成
- [ ] 服务测试通过

### Phase 4: API Layer
- [ ] 重构完成
- [ ] API 测试通过

### Phase 5: Controller/Router Layer
- [ ] 重构完成
- [ ] 集成测试通过

## Test Results

```bash
# pytest 结果
=== X passed, 0 failed ===

# 覆盖率报告
Name                    Stmts   Miss  Cover
-------------------------------------------
common/services          X       Y     Z%
```

## Changed Files

### Refactored Files
- `src/...` - 变更说明

### New Tests
- `test/...` - 测试说明

### Documentation Updates
- `docs/development/refactoring/REFACTOR-XXX-*.md`
- `docs/development/refactoring/README.md`

## Code Quality

```bash
ruff check: ✅ Passed
ruff format: ✅ Passed
```

## Architecture Compliance
- [ ] 服务分层合规 (Service → Repository → DB)
- [ ] 依赖方向正确 (无循环依赖)
- [ ] 接口职责清晰

## Next Actions
- [ ] Code Review
- [ ] 部署验证
- [ ] 性能测试

## Lessons Learned

### Successes
<记录重构过程中的最佳实践>

### Improvements
<记录下次重构可以改进的地方>
