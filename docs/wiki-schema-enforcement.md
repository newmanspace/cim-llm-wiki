# Wiki 结构一致性修正

日期：2026-10-28。范围：知识库契约、编译与构建门禁、旧流水线写入隔离。

## 修正后的职责边界

| 目录 | 职责 |
|---|---|
| `contracts/wiki/v1/` | 版本化 Schema、节点类型与目录、正文结构、受控词表 |
| `packages/wiki-core/` | YAML/Markdown 解析、全库校验、候选编译、发布与状态更新 |
| `.agents/skills/cim-wiki/` | Agent 工作流、抽取指导、模板；原命令保留为兼容入口 |
| `wiki/` | 展示与静态构建，生成导航及构建前调用同一校验器 |
| `cmd/`、`internal/` | Go 管理服务与历史读取能力；旧摄取和审核写入接口返回 410 |

编译、校验和导航共用类型目录契约；模板可追加必填章节和表格列，但不能取消基础要求或改写类型落点。新增类型必须同时登记类型契约和结构要求，不再靠模糊文件名或未知类型兜底进入 `knowledge/`。

## 强制检查

- 所有项目必须声明 `document-contract.json`，同时执行文档集完整性校验（含已登记但没有 Wiki 目录的项目）。规则及示例见 [项目文档集契约](document-set-contract.md)。

- 节点必须声明 `schema_version: "1.0"`，未知版本、类型、字段或枚举均报错。
- 解析真实 YAML，拒绝重复键、错误类型、空字段、非法日期和越界置信度。
- 解析 Markdown 语法树，检查唯一一级标题、标题层级、必填章节、空章节、重复章节、表格列和数据行。代码块、注释和正文提及的标题不能充当章节。
- FRD 的编号标题可使用 `(Steps)`、`(What-Next Branches)` 语义标记，允许多业务场景重复这些章节；每个场景分别校验表格。
- 检查项目目录、文件名、项目内 ID 唯一、事务码全库唯一、正文链接和元数据引用、引用目标类型。跨项目引用当前直接拒绝。
- 检查已登记源文档的存在性、冻结哈希和 draft 状态；专家级已发布节点不能声明 `reviewer: auto`。
- 模板清单缺失时使用内置基础契约；已有清单解析失败、指向不存在的模板、非法覆盖均阻断。
- 只有根 `index.md` 是特殊生成页面，其 Frontmatter 只允许 `title`。手册、模板以外的页面均须校验，手册不再拥有跳过校验的通道。
- 内容陈旧、无入链只作质量告警，不阻断发布。

## 编译与构建

```bash
npm ci
npm test
npm run wiki:validate
npm run wiki:validate -- --json
npm run wiki:compile -- <bundle_id或nodes.json>
npm run wiki:compile -- <bundle_id或nodes.json> --preview
```

原 `.agents/skills/cim-wiki/scripts/compile.mjs` 和 `validate.mjs` 命令继续可用。`--allow-draft` 已移除；`--preview` 执行相同严格校验，成功也不写正式页面、索引或源文档状态。

旧手册脚本不再直接清空正式目录并复制未经校验的解析稿。`gen-manuals.mjs <reviewed-manual-bundle.json>` 现为统一编译器入口，手册使用 `user-manual`、`admin-manual` 或 `solution` 类型，携带相同的版本、来源、审核元数据；无参数调用会明确失败并保留原文件。

Bundle 必须是对象，包含 `schema_version`、`bundle_id`、明确的 `project` 和 `nodes`，不再接受裸节点数组或推测目标项目。每个节点包含 `title`、`content` 及节点 Schema 要求的元数据。编译器可填入 Schema 版本、生成时间及 Bundle 级来源/模块/产品/版本，并从类型推导平面；业务字段不会凭空补齐。

```json
{
  "schema_version": "1.0",
  "bundle_id": "example-001",
  "project": "example",
  "nodes": [{
    "id": "REQ-EXAMPLE-001",
    "type": "requirement",
    "title": "示例需求",
    "content": "经来源和审核确认的具体需求。",
    "product": "Example",
    "version": "v1",
    "domain": "manufacturing",
    "module": "wip",
    "source": "source.md",
    "confidence": 0.9,
    "review_level": "L1_expert",
    "reviewer": "真实审核人标识",
    "status": "published"
  }]
}
```

编译先复制候选树，在候选目录生成页面，再对**全部现有页面和本次变更**执行同一校验器。通过后才更新正式页面、事务码登记、目标项目索引和源文档状态；校验失败不改变这些数据。发布使用共享文件锁覆盖写入及 GitOps/索引回写，避免不同 Bundle 混入同一提交。单文件使用临时文件替换，普通写入异常会恢复已替换文件。

`npm run gen`、VitePress 配置加载以及 GitOps 提交都调用校验器。Wiki 容器启动时先严格构建，再展示静态产物；挂载目录中的手动修改不会直接作为正式页面热更新。

## 现有数据处理

用户选择全部现有文档立即按新规则校验，不保留宽松读取模式。本次全库扫描见 [wiki-schema-audit.json](wiki-schema-audit.json)。旧节点没有 Schema 版本或真实审核人时，必须迁移并补充真实审核记录后才能重新发布，不能把 `auto` 改成虚构人员以绕过门禁，也不能直接调高评分冒充免审节点。

本次没有自动修改独立知识仓中的业务内容或审核人。根仓忽略 `data/wiki/`，因此该知识仓的修复和版本管理应单独进行。模板和已有 FRD 样例中为了字符串匹配而插入的多余二级标题已移除，改由语法树识别编号标题。

## 验证与边界

自动化测试覆盖 Schema、真实章节与表格、模板覆盖、链接、旧入口、源文档漂移、候选失败不落盘、项目隔离、预演、发布互斥和符号链接逃逸。Go 旧写入口增加 410 回归测试。正常候选构建与异常知识库构建分别验证。

目前仍以单机文件存储发布：单文件替换不等于多文件跨崩溃事务；意外断电可能留下需检查的发布锁和部分有效文件。Git/远端推送或 Admin 回写失败会明确报错，已经完成的本地发布保留；尚无持久化 outbox 和跨进程故障恢复日志。

当前审核约束验证元数据一致性，不提供身份认证或防伪签名。后续仍需补充后端 API 权限、审批记录与内容哈希绑定，以及知识仓保护分支中的必需校验；本次没有将这些尚未完成的能力标记为已实现。
