---
name: refactor-review
description: >
  审查重构方案与执行过程，确保符合分层架构和测试覆盖原则。
  不负责通用代码审查（交由 code-review）和架构设计评审（交由 design-review）。
---

# 重构审查 (Refactor Review)

本技能负责对代码重构方案和执行过程进行审查，确保重构遵循测试先行、自下而上的分层原则，并维持架构一致性。

## 审查时机

重构审查在以下节点触发：

1. **重构方案审查** - 重构开始前，审查 `REFACTOR-XXX-*.md` 文档
2. **重构执行审查** - 重构完成后，审查代码变更和测试结果
3. **重构文档审查** - 审查重构总结文档的完整性

## 审查检查点

### 1. 重构文档审查 (Documentation Review)

审查 `docs/development/refactoring/REFACTOR-XXX-*.md` 是否包含：

- [ ] **问题定义清晰** - 背景、现状问题、影响分析
- [ ] **解决方案合理** - 目标架构、实施原则、分层设计
- [ ] **实施计划具体** - 分阶段任务、预估时间、依赖关系
- [ ] **成功指标可量化** - 重构前后的对比指标
- [ ] **测试策略完整** - 各层测试覆盖计划
- [ ] **迁移方案可行** - 向后兼容、回滚预案

### 2. 分层架构审查 (Layering Architecture Review)

审查重构是否遵循分层架构原则：

```
┌─────────────────────────────────────────┐
│  Tool/Interface Layer                   │  ← 最上层，薄封装
├─────────────────────────────────────────┤
│  API Layer                              │  ← 内部接口
├─────────────────────────────────────────┤
│  Service Layer                          │  ← 业务逻辑
├─────────────────────────────────────────┤
│  Repository Layer                       │  ← 数据访问
└─────────────────────────────────────────┘
```

**审查要点**:

| 层级 | 审查项 | 违规示例 |
|------|--------|----------|
| Repository | 只包含 CRUD，无业务逻辑 | 包含计算逻辑 |
| Service | 业务逻辑，无接口定义 | 直接暴露给外部 |
| API | 内部接口，无业务逻辑 | 包含复杂计算 |
| Tool/Interface | 薄封装，调用 Service/API | 包含业务逻辑 |

### 3. 测试先行审查 (Test-First Review)

审查重构是否遵循测试先行原则：

- [ ] **基线测试存在** - 重构前已有测试覆盖
- [ ] **测试覆盖率达标** - 核心模块 >80%
- [ ] **测试先于修改** - 测试编写时间早于代码修改
- [ ] **重构后测试通过** - 无回归失败

**审查命令**:
```bash
# 查看测试覆盖率
docker compose run --rm app pytest --cov=src --cov-report=html

# 查看测试结果
docker compose run --rm app pytest -v
```

### 4. 自下而上顺序审查 (Bottom-Up Order Review)

审查重构执行顺序是否符合自下而上原则：

**正确顺序**:
```
1. Repository 层重构 (数据访问)
2. Service 层重构 (业务逻辑)
3. API 层重构 (内部接口)
4. Tool/Interface 层重构 (外部接口)
```

**审查方法**:
- 检查 `git log --oneline` 提交历史
- 确认提交顺序符合分层顺序
- 如有上层先于下层重构，标记为违规

### 5. 上层测试覆盖审查 (Top-Layer Test Coverage Review)

审查上层重构是否有对应测试覆盖：

| 重构层级 | 必须有 | 审查项 |
|----------|--------|--------|
| Tool/Interface | 集成测试 | `test/` |
| API | API 测试 | `test/` |
| Service | 服务测试 | `test/` |
| Repository | 单元测试 | `test/` |

**审查方法**:
```bash
# 查找重构涉及的文件
git diff --name-only HEAD~10

# 查找对应的测试文件
git diff --name-only HEAD~10 | grep test/
```

### 6. 代码质量审查 (Code Quality Review)

审查重构后代码质量：

- [ ] **ruff 检查通过** - 无 lint 错误
- [ ] **代码重复减少** - 无新增重复代码
- [ ] **命名规范一致** - 符合项目命名规范
- [ ] **注释充分** - 复杂逻辑有英文注释

**审查命令**:
```bash
# Ruff 检查
docker compose run --rm app ruff check .

# 代码重复检测
docker compose run --rm app ruff check --select=CPY .
```

### 7. 架构一致性审查 (Architecture Consistency Review)

审查重构是否维持架构一致性：

- [ ] **架构一致性** - 依赖方向正确，无循环依赖
- [ ] **依赖方向** - 依赖只指向下层，无循环依赖
- [ ] **接口清晰** - 各层职责边界清晰
- [ ] **无架构腐败** - 无新增架构违规

**审查方法**:
```bash
# 检查依赖图
docker compose run --rm app deptry .

# 或手动检查 import 语句
grep -r "from.*import" src/ | grep -v __pycache__
```

## 输出动作

审查完成后，生成 `Refactor Review Report`（参见 `refactor-review/assets/refactor-review-report-template.md`）：

### 报告格式

生成报告时，请严格使用外部规范文件：
**[refactor-review-report-template.md](./assets/refactor-review-report-template.md)**

## 审查流程

```
1. 接收重构审查请求
       ↓
2. 审查重构文档 (REFACTOR-XXX-*.md)
       ↓
3. 审查代码变更 (git diff)
       ↓
4. 审查测试结果 (pytest)
       ↓
5. 审查架构一致性 (依赖检查)
       ↓
6. 生成审查报告
       ↓
7. 输出结论 (Approved/Risks/Rejected)
```

## 与其他 Skill 的协作

- **refactor** - 执行重构的 Skill
- **code-review** - 通用代码审查
- **test** - 测试执行与覆盖率检查
- **design-review** - 架构设计审查

---

## 审查红线

以下情况将直接标记为 **Rejected**：

1. ❌ **未创建重构文档** - 无 REFACTOR-XXX-*.md
2. ❌ **测试覆盖率下降** - 核心模块 <80%
3. ❌ **分层架构违规** - 跨层调用、循环依赖
4. ❌ **测试未先行** - 无测试覆盖就重构
5. ❌ **重构后测试失败** - 存在回归 bug

## Required Document Chapters

审查重构文档时，确保其章节结构严格符合模板规范：
**[refactor-document-template.md](../refactor/assets/refactor-document-template.md)**

缺少任一章节将标记为 **文档不完整**。
