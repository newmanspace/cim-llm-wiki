# Feature：产品目录与现有流水线闭环

## 1. Overview

2026-11-07 用户明确收敛本期范围，并确认复用现有 project 命名空间，不新增 Workspace 表或继承机制。此方案取代复杂 Workspace 方案作为当前实施依据。

本期通过产品目录配置初始化目录首页，接入现有 context、摄取、冻结、审核、编译、校验和 Wiki 展示。产品名称与当前文档版本作为目录元数据；不声称实现独立产品 CRUD、多版本管理平台、基线或继承。

## 2. Architecture

沿用 Node Knowledge Service 和 Wiki Core。`<project>/directory.json` 保存目录树与类型／版本／模块映射；`<project>/catalog/**/index.md` 保存确定生成的目录首页。知识节点继续按严格 doc/code 契约发布。目录首页只展示说明与子目录，侧边栏将真实编译页面链接到匹配目录；未匹配页面仍保留原有双平面入口。

目录首页不算知识节点、不计入交付契约满足数量。校验器要求目录配置合法、首页与确定生成内容完全一致；额外或改写的 catalog 页面阻断，不能借此绕过节点审核。

## 3. API Design

- POST `/api/v2/knowledge/initialize`：参数 project、name、version、modules、delivery_contract（必填）。校验用户提供的交付契约，生成标准目录及 README 首页。新项目仅创建缺失契约，已有不同契约拒绝，不自动放宽要求；重复初始化拒绝覆盖。
- GET `/api/v2/knowledge/directories?project=...`：返回目录配置。
- POST `/api/v2/knowledge/directories`：参数 project、expected_revision、directories。支持编辑目录、显示标题、说明、顺序和映射；校验父目录、唯一性、路径和类型后更新，不删除知识页面。并发 revision 冲突返回 409。
- GET context 返回 directory 配置和内容映射，供本地 Agent 在现有流程中使用。
- 复用现有 API Token 和独立人工审核 Token；审核凭据不得执行初始化和目录修改。

## 4. Database Design

无数据库 schema 变更。目录配置为版本化 JSON，禁止路径穿越和符号链接；写操作沿用现有服务互斥锁，配置与生成页通过暂存目录替换、失败恢复保持一致。静态模板转换为随服务发布的 JSON 模板，避免运行依赖 docs 挂载。

## 5. Implementation Plan

先添加目录初始化、配置编辑和越权／安全测试；实现标准模板转换与严格目录校验；接入 HTTP 和轻量客户端；集成导航；使用临时隔离项目运行转换到发布的闭环并构建 Wiki。

## 6. Risk & Mitigation

不放宽交付契约；初始化允许尚未交付的目录框架，但编译仍须满足原有文档要求。目录首页采用纯文本说明与确定生成链接，避免自由 Markdown／Vue 注入。旧项目没有 directory.json 时行为保持兼容。新增目录只作展示，不搬动知识节点文件。

## 7. Test Scenarios

初始化与重复请求、契约不一致、目录更新冲突、非法路径和符号链接、非法类型、目录首页篡改、额外 catalog 页、真实知识页仍走严格校验、人工审核仍必需、编译后映射到目录、未映射内容可发现、隔离 Wiki 构建。

## 8. Monitoring

沿用 HTTP 错误与流水线校验结果，新增目录配置错误和目录首页漂移错误；返回 revision 供调用者排查更新冲突。

## 9. Related Features

[标准目录](../../templates/product-documentation/README.md)、[原长期方案](feature-workspace-management.md)、[共享目录工作流](../../shared-directory-workflow.md)。

## 10. Appendix

本期不增加管理台产品页面。通过现有轻量客户端初始化和维护目录，Wiki 展示真实目录与知识页。后续产品 UI 可复用同一接口；Workspace、产品实体和继承延后。

实现状态：目录核心、服务 API、独立客户端和导航均已完成；73 项自动化测试通过，全库行覆盖率 87.80%，目录核心行覆盖率 97.58%，lint 通过。隔离环境完成从初始化到人工审核、编译及 VitePress 构建，真实环境尚未部署。

评审：本 Agent 检查通过，无数据库变化；安全边界、Node 测试框架及严格校验保持不变。用户已确认复用现有流水线的实施策略，按本期范围执行，不再以长期 Workspace 方案作为编码前置要求。
