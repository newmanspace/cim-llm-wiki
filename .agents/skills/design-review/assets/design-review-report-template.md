# Design Review Report Template

> 本模板用于 `design-review` 技能输出架构评审报告时的参考格式。

## Review Profile
- **Review Date**: YYYY-MM-DD HH:MM
- **Reviewer**: Design Review Agent
- **Target Document**: [Feature 文档名称 / 设计方案标题]
- **Final Conclusion**: [Feasible / Risks / Blockers]

---

## Review Dimensions

### 1. Service Architecture
- [ ] 模块职责清晰，未出现跨层侵入（如 WebSocket 层直接访问 DB）
- [ ] 共享逻辑放在 `common/` 中，未在多服务中重复实现
- Comments：[...]

### 2. API 接口设计规范
- [ ] 新增 API 路由遵循 RESTful 命名风格
- [ ] 入参类型定义清晰，返回值结构明确
- Comments：[...]

### 3. Performance & Scalability
- [ ] 数据库查询使用索引，无全表扫描风险
- [ ] WebSocket 长连接资源管理合理
- Comments：[...]

---

## Review Conclusion
- [ ] ✅ **Feasible** — 方案可行，无阻断项
- [ ] ⚠️ **Risks** — 方案存在风险点，需补充说明后可通过
- [ ] ❌ **Blockers** — 存在基础架构违规，需重新设计
