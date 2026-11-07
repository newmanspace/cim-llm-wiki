# Feature 文档索引

本目录保存功能需求、技术方案和评审记录。文档为中文说明，代码标识、路径与接口保持英文；普通文件名使用小写 kebab-case。

## 当前实施：产品目录与流水线

- [简化方案](feature-product-directory-pipeline.md)：用户已确认复用现有命名空间，不新增 Workspace 表，先完成目录闭环。
- [代码自审与验证](code-review-product-directory-pipeline.md)：实现范围、测试结果及运行限制。

## 后续规划：Workspace 产品与项目管理

- [需求文档](urd-workspace-management.md)：范围、已确认规则与验收条件。
- [技术方案](feature-workspace-management.md)：统一模型、继承解析、API、数据、迁移、实施和验证。
- [数据库评审](dba-review-workspace-management.md)：模型约束和数据库执行风险。
- [设计评审](design-review-workspace-management.md)：架构与安全检查。
- [文档评审](qa-workspace-management.md)：文档结构、命名、引用和状态检查。

## 文档结构要求

需求文档遵循 requirement 模板的八个章节；设计文档包含 Overview、Architecture、API Design、Database Design、Implementation Plan、Risk & Mitigation、Test Scenarios、Monitoring、Related Features、Appendix。评审记录需注明对象、结论、问题及验证限制。

设计可评审不代表用户已批准编码；运行验证与生产发布分别记录实际结果。
