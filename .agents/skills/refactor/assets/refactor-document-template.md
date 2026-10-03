# Refactor Document Template

> 本文件供 `refactor` 工作流在重构立项时使用，存储于 `docs/development/refactoring/REFACTOR-XXX-<name>.md`

---

# REFACTOR-XXX: [重构名称]

## Document Information
- **Document ID**: REFACTOR-XXX
- **Created Date**: YYYY-MM-DD
- **Author**: [Name]
- **Status**: [Draft / In Progress / Completed]

---

## 1. Background
[描述为什么要进行这次重构，当前遇到了什么痛点或坏味道]

## 2. Problem Analysis
[深入分析导致问题的原因，例如依赖耦合、架构缺陷、性能瓶颈等]

## 3. Solution
[阐明目标架构、主要的设计变更和重构策略]

## 4. Implementation Plan
[列出重构的分阶段执行计划，需严格遵循自下而上原则（Repository -> Service -> API -> Tool）]

## 5. Benefits
[重构后预期的改进，如可维护性提升、性能增加等]

## 6. Testing
[说明如何保证重构不出错（测试先行策略），涉及的单元测试、集成测试及覆盖率要求]

## 7. Migration Notes
[如涉及数据迁移、API 兼容或旧代码的废弃策略，在这里说明]

## 8. Success Metrics
[可量化的判断标准，例如覆盖率 100%、无特定 Lint 错误、执行速度提升 x%]

---

## Revision History
| Date | Version | Description | Author |
|------|---------|-------------|--------|
| YYYY-MM-DD | v1.0 | Initial version | [Name] |
