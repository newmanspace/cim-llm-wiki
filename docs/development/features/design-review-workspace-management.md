# Design Review：Workspace 产品与项目管理

## Review Profile

- Review Date：2026-11-07
- Reviewer：当前 Agent 架构设计自审，未使用独立审查人员或子 Agent
- Target：[需求](urd-workspace-management.md)、[方案](feature-workspace-management.md)
- Final Conclusion：Feasible（待用户批准编码）

## Review Dimensions

### 1. Service Architecture

- [x] Go 管理元数据、关系、授权与事务，Node／Wiki Core 处理内容；不在两种服务中重复实现继承算法。
- [x] PostgreSQL 为关系和修订元数据唯一权威源，旧注册表仅兼容投影。
- [x] 产品和项目复用 Workspace；版本不是 Workspace；组织父级、继承 pin 与产品采用关系分开。
- [x] 继承基线已经物化，避免多级继承按页递归和祖先当前状态漂移。
- [x] 未发现 `.agents/RULES.md`，不虚构其约束；以当前代码、契约、技能和用户确认作为依据。

### 2. API Design

- [x] 工作空间归属明确，目录、内容、基线、异步任务和继承升级都有契约与处理步骤。
- [x] 冲突预览与提交均验证 expected_version、权限和输入哈希。
- [x] 操作范围按 Workspace 校验；不将 Token 或来源物理路径暴露给 UI。
- [x] 旧 API 通过适配兼容，新增内容禁止通过旧公开路径访问。

### 3. Performance and Scalability

- [x] 列表游标分页，采用关系与任务队列有查询索引。
- [x] 基线为清单查找，不逐页向祖先查询，缓存须带内容版本和授权边界。
- [x] 不涉及新增 WebSocket 长连接。
- [x] 技术限额、异步任务重试和锁超时需在实施中实测，未伪造性能结果。

### 4. Security and Compatibility

| 审查发现 | 方案修正／要求 |
|---|---|
| 当前管理 API 有无 Token 的项目路由，不能直接复用于私有 Workspace | 新实体统一鉴权，旧写路由走管理员检查；旧 Token 原 scope 不扩大 |
| 当前网关对整个 Wiki 只做会话门控 | 新 Workspace 页面、附件、搜索和别名全部要求目标空间授权，完成前禁止共享静态发布 |
| “继承但权限独立”可能导致父内容被无意公开 | 建立关系时显式导出授权和预览；已授权派生副本由子级管理；源撤权后禁止新升级 |
| 直接复制人读目录会绕过 Wiki 类型契约 | 新增目录展示映射及普通页契约，固定知识节点路由与校验继续生效 |
| 单管理员系统不能宣称完整成员隔离 | 首期明确为管理员与空间 Token，完整多用户账户 UI 不在范围 |

### 5. Scope and Verification

- [x] 覆盖产品 CRUD、标准目录、版本、基线、继承、覆盖升级、项目关联和旧数据迁移。
- [x] 测试矩阵包含数据库并发、授权绕过、静态资源、跨服务失败与三方冲突。
- [x] 明确分阶段交付，全部阶段完成才宣称实现本功能。
- [x] 先审批方案再编码，未执行迁移、部署或 Git 提交。

## Review Conclusion

- [x] Feasible：当前方案无未解决设计阻断项。
- [ ] Risks：无阻止用户审阅的未定义关键规则；实现细节和性能需编码阶段验证。
- [ ] Blockers：未发现需要重新定义核心模型的阻断项。

风险仍包括实施范围较大、现有双服务和静态发布的权限接入成本。它们已在计划中列为必需工作，不能在实施时删去后仍宣称权限独立或继承完整。
