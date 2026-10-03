---
name: design-review
description: >
  评估架构方案及新 Feature 设计并出具评审报告。
  不负责重构审查（交由 refactor-review）和代码层面审查（交由 code-review）。
---
# 架构与方案设计评审 (Design Review)

本技能以项目 Committer 的视角，对新方案进行架构合规性评估。

## 评审检查清单

评审时应参考 `RULES.md` 中已定义的规范，重点关注：

- [ ] **架构合规**：是否符合项目架构原则
- [ ] **API 设计**：接口定义是否清晰，业务逻辑 Prompt 是否完整
- [ ] **数据库设计**：表结构、索引、列顺序是否符合规范
- [ ] **性能评估**：是否有 N+1 查询风险、数据倾斜风险
- [ ] **回滚方案**：是否有降级预案
- [ ] **可测试性**：是否有明确的测试场景

## 输出动作

审查完成后，生成一份标准的 `Design Review Report`（参见 `design-review/assets/design-review-report-template.md`），标明方案状态为：
- ✅ **Feasible** — 可行无阻断
- ⚠️ **Risks** — 存在风险点需补充说明
- ❌ **Blockers** — 基础架构违规，需重新设计
