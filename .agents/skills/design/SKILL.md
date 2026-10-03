---
name: design
description: 根据需求初步出具架构防呆方案与全盘 Feature 说明文档
---
# 方案设计 (Design)

本技能负责将一个中大型业务需求，转化为一份结构化的架构设计文档。它是动手写代码之前的蓝图产出能力。

## 前置约束（提问驱动与项目嗅探）
在接到需求并开始撰写方案前，**必须严格执行以下前置动作**：
1. **自动嗅探全局**：读取并扫描项目根目录的核心配置文件，探测当前所用的具体版本栈及业务逻辑上下文。
2. **主动提问澄清**：强制向用户提出 1 到 2 个关于业务背景的澄清问题（如：是否有极高并发要求？是否需要兼容某历史版本数据？）。**必须等待明确回答后，才能开始撰写方案。**

## 文档架构与输出标准

在获得澄清问题的回答后，基于诉求自动出具一份结构化的设计方案文档，存放路径遵循 `docs/development/features/` 目录下的 README 要求。

文档内容应当严格遵守 Feature 文档骨架（参见 `design/assets/feature-document-template.md`）：

| 章节 | 说明 |
|------|------|
| 1. Overview | 目的 (Purpose)、业务价值 (Business Value)、范围 (Scope) |
| 2. Architecture | 系统上下文图、数据流向 |
| 3. API Design | 功能描述 + 业务逻辑 Prompt（AI 可理解的结构化步骤）+ 接口定义 |
| 4. Database Design | 表结构、索引、列顺序（遵循 `column-ordering-standard.md`） |
| 5. Implementation Plan | 分阶段实施计划（含 Duration） |
| 6. Risk & Mitigation | 风险识别与缓解措施 |
| 7. Test Scenarios | 测试场景矩阵 |
| 8. Monitoring | 关键指标与诊断查询 |
| 9. Related Features | 相关功能链接 |
| 10. Appendix | 附录（参考数据、配置示例等） |

### API Design 章节要求

- **功能描述**：每个 API 必须有清晰的中文功能说明
- **业务逻辑 Prompt**：使用结构化步骤描述业务逻辑，格式如下：
  ```
  当调用 <API 名称> 时：
  1. 从 <数据源> 获取 <数据>
  2. 验证 <条件>
  3. 如果 <条件>，则 <操作>
  4. 返回 <结果>
  ```
- **接口定义**：包含 Parameters 和 Returns 的类型定义

### Database Design 章节要求

- 表结构设计遵循 `column-ordering-standard.md` 规范
- 索引设计需说明用途（查询加速/唯一约束等）
- 列顺序按业务用途分组（Identifiers → Basic Info → Core Config → Audit）

## 输出动作

审查完成后，生成一份标准的 `Design Document`（参见 `design/assets/feature-document-template.md`），包含上述 10 个核心章节。

状态标记：
- ✅ **Approved** — 方案可行
- ⚠️ **Risks** — 需补充说明
- ❌ **Rejected** — 架构违规
