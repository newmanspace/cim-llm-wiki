# Feature Document Template

> 新增功能时，`design` 技能的输出应当遵循此骨架结构。
> 文档最终存放路径：`docs/development/features/feature-XX-<name>.md`

---

# Feature-XX: [功能名称]

## Document Information
- **Document ID**: Feature-XX
- **Created Date**: YYYY-MM-DD
- **Author**: [Name]
- **Status**: [Draft / In Progress / Completed]

---

## 1. Overview
- **Objective**：[一句话说清楚这个功能解决什么痛点]
- **Value**：[对用户/系统带来什么收益]
- **Scope**：[影响的模块边界]

## 2. Architecture
- **Component Diagram**：[Mermaid 或文字描述组件间的调用关系]
- **Data Flow**：[标注模块间调用关系与数据流向，如 WebSocket → Common → DB]
- **Dependencies**：[涉及的上下游服务或模块]

## 3. API 接口设计
- **路由命名**：RESTful 风格 `<method> /api/v1/<resource>`
- **Parameters**：

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `xxx`     | `int`| ✅       | ...         |

- **Response Structure**：[JSON 示例]

## 4. Database Design
- **New Tables**：[表名、字段、索引]
- **Schema Changes**：[ALTER 语句摘要]
- **Column Ordering**：[参照 `dba-review/references/column-ordering-standard.md`]

## 5. Implementation Plan
- **Phase 1**：[核心逻辑]
- **Phase 2**：[边缘处理 & 异常兜底]
- **Phase 3**：[测试与文档]

## 6. Risk & Mitigation
- [可能的风险点及其应对措施]

---

## Revision History
| Date | Version | Description | Author |
|------|---------|-------------|--------|
| YYYY-MM-DD | v1.0 | Initial version | [Name] |
