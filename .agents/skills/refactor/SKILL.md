---
name: refactor
description: 执行代码重构，遵循 TDD 测试先行和自下而上分层原则
---

# 代码重构 (Refactor)

本技能负责执行系统性的代码重构，确保每次重构都遵循测试先行、自下而上的分层原则，并提供完整的重构文档。

## 前置约束

在执行任何重构之前，必须完成以下准备：

1. **读取参考文档**：必须参考 `docs/development/refactoring/REFACTOR-XXX-*.md` 格式的文档模板
2. **确认重构目标**：明确重构的问题、解决方案和成功指标
3. **测试覆盖率基线**：确认当前测试覆盖率，确保重构后不下降

## 重构原则

### 1. 测试先行 (Test-First)

**核心原则**: 在修改任何现有代码之前，必须先有测试覆盖

- ✅ 为即将重构的模块编写测试用例
- ✅ 确保测试通过（建立安全网）
- ✅ 重构后测试仍然通过
- ✅ 必要时补充新测试

### 2. 自下而上分层 (Bottom-Up Layering)

**核心原则**: 从底层开始重构，逐步向上层推进

```
重构顺序：
1. Repository 层 (数据访问)
2. Service 层 (业务逻辑)
3. API 层 (内部接口)
4. Tool/Interface 层 (外部接口)
```

| 层级 | 职责 | 重构优先级 |
|------|------|------------|
| Repository | CRUD 操作 | 第一 (最底层) |
| Service | 业务逻辑 | 第二 |
| API | 内部接口 | 第三 |
| Tool/Interface | 外部接口 | 第四 (最上层) |

### 3. 上层测试覆盖 (Top-Layer Test Coverage)

**核心原则**: 上层重构时，必须有对应的测试用例覆盖

- ✅ Tool/Interface 层重构 → 必须有集成测试
- ✅ API 层重构 → 必须有 API 测试
- ✅ Service 层重构 → 必须有服务测试
- ✅ Repository 层重构 → 必须有单元测试

### 4. 文档先行 (Documentation First)

**核心原则**: 先立案后动刀，重构前必须创建文档

- ✅ 创建 `docs/development/refactoring/REFACTOR-XXX-*.md`
- ✅ 记录问题、解决方案、实施计划
- ✅ 重构完成后更新 `docs/development/refactoring/README.md`

## 重构流程

### Phase 1: 立项与文档

1. **创建重构文档**：
   - 路径：`docs/development/refactoring/REFACTOR-XXX-<name>.md`
   - 参考模板：`.agents/skills/refactor/assets/refactor-document-template.md`

2. **等待用户确认**：文档完成后等待用户 Approve

### Phase 2: 测试准备

1. **基线测试**：
   ```bash
   docker compose run --rm app pytest
   ```

2. **补充缺失测试**：
   - 识别即将重构模块的测试缺口
   - 编写针对性测试用例
   - 确保覆盖率 >80%

### Phase 3: 分层重构

按自下而上顺序执行：

#### Step 1: Repository 层重构
- 最底层数据访问逻辑
- 不依赖其他模块
- 测试：单元测试

#### Step 2: Service 层重构
- 业务逻辑层
- 依赖 Repository 层
- 测试：服务测试

#### Step 3: API 层重构
- 内部接口层
- 依赖 Service 层
- 测试：API 测试

#### Step 4: Tool/Interface 层重构
- 最上层外部接口
- 依赖 API/Service 层
- 测试：集成测试

### Phase 4: 验证与文档

1. **全量测试**：
   ```bash
   docker compose run --rm app pytest --cov=src --cov-report=html
   ```

2. **更新文档**：
   - 标记重构文档状态为 `✅ Complete`
   - 更新 `docs/development/refactoring/README.md`

3. **代码审查**：
   - 触发 `code-review` skill
   - 确保无安全漏洞

## 输出动作

重构完成后，输出以下内容：

1. **重构文档**：`REFACTOR-XXX-<name>.md` 已创建并更新
2. **测试报告**：所有测试通过，覆盖率达标
3. **变更总结**：
   ```markdown
   ## 变更总结
   - 文件变更：X 个文件
   - 代码行数：+N/-M 行
   - 测试用例：+N 个
   - 工具/接口：从 X 个减少到 Y 个
   ```

## 检查清单

重构执行前，必须确认：

- [ ] 重构文档已创建 (`REFACTOR-XXX-*.md`)
- [ ] 基线测试全部通过
- [ ] 目标模块测试覆盖率 >80%
- [ ] 重构计划已获用户 Approve

重构执行中，必须确认：

- [ ] 按 Repository→Service→API→Tool 顺序
- [ ] 每层重构后测试立即通过
- [ ] 上层重构时有对应测试覆盖

重构执行后，必须确认：

- [ ] 全量测试通过
- [ ] 测试覆盖率不下降
- [ ] 重构文档状态更新为 Complete
- [ ] `docs/development/refactoring/README.md` 已更新

## Report Templates

生成进度报告时，请严格使用外部规范文件：
- **Refactor Progress Report**：`refactor/assets/refactor-report-template.md`
- **Refactor Plan Document**：`refactor/assets/refactor-document-template.md`
