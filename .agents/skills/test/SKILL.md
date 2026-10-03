---
name: test
description: 运行自动化测试
---

# 自动化测试 (Test)

本技能负责对项目代码执行全量或增量的自动化测试，确保变更不会引入回归 Bug，并维持核心模块覆盖率达标。

## 前置约束
- 项目要求使用 `pytest` 作为唯一的测试框架，配合 `pytest-asyncio` 处理异步用例。
- 核心模块的代码覆盖率**必须维持在 80% 以上**。
- 测试用例中的变量、断言消息、docstring 必须使用**英文**。
- 测试环境通过 Docker Compose 隔离运行，避免污染本地环境。

测试编写模式请参见 `test/references/test-pattern-reference.md`。

## 测试分类
- **单元测试**：测试单个函数或方法
- **服务测试**：测试 Service 层业务逻辑
- **集成测试**：测试模块间交互和外部依赖

## 测试命令

### 运行常规测试
```bash
docker compose run --rm app pytest
```

### 运行测试并生成 HTML 覆盖率报告
```bash
docker compose run --rm app pytest --cov=src --cov-report=html
```

### 运行指定模块测试
```bash
docker compose run --rm app pytest tests/test_<module_name>.py -v
```

## 失败处理策略
当测试执行过程中出现失败时，按以下优先级排查：
1. **单个用例失败**：优先检查是否为本次变更引入的回归。对比 `git diff` 定位引发失败的代码改动。
2. **大面积失败**：检查测试基础设施是否正常（数据库连接、Docker 容器状态、环境变量配置）。
3. **超时失败**：检查是否存在死锁、未 mock 的外部网络调用，或异步任务未正确 await。
4. **覆盖率不达标**：定位新增或修改的代码行中哪些未被测试覆盖，补充针对性的测试用例。

## 测试结果解读
- ✅ **全绿 + 覆盖率 ≥ 80%**：可以安全地流转至后续环节。
- ⚠️ **有跳过 (skipped)**：检查跳过原因是否合理（如平台限制），不应滥用 `@pytest.mark.skip`。
- ❌ **存在失败**：必须修复所有失败用例后才能继续，绝不允许带红发版。
