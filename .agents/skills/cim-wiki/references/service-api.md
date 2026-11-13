# 服务调用契约

服务地址为 `CIM_WIKI_URL`，自动化令牌为 `CIM_WIKI_TOKEN`，人工 review 命令另使用 `CIM_WIKI_REVIEW_TOKEN`，请求使用 `Authorization: Bearer ...`。统一前缀 `/api/v2/knowledge`。不要调用已停用的旧 ingest/审核写入接口，也不直接调用解析引擎。

| client 命令 | 方法与端点 | 输入 |
|---|---|---|
| initialize | POST /initialize | --json-file，project/name/version/modules/delivery_contract |
| directories | GET /directories?project=ID | --project |
| update-directories | POST /directories | --json-file，project/expected_revision/directories |
| context | GET /context?project=ID | --project |
| document | GET /document?source=URI | --source |
| bundle | GET /bundle?id=ID | --id |
| convert | POST /convert | --json-file |
| register | POST /register | --json-file |
| state | POST /state | --json-file |
| submit | POST /bundles | --json-file |
| review | POST /review | --json-file |
| compile | POST /compile | --json-file |
| validate | POST /validate | 无需请求文件 |

所有写操作请求为 JSON；`--json-file -` 从 stdin 读取。客户端显示服务响应，HTTP 失败或完整校验发现 errors 时以非零状态退出，不自动重复写入请求。

## 受控枚举与机器契约

绑定项目后调用 `context --project <project-id>`，读取 `vocabulary`、节点 Schema 和模板契约。结构化字段使用当次服务允许的值：

| 节点内容 | 允许值来源 |
|---|---|
| `rule_category`、`rule_tags` | `context.vocabulary.category` |
| `operation`、模板受控业务动作 | `context.vocabulary.operation` |
| 关系谓词 | `context.vocabulary.relation`，同时遵守模板及实际校验约束 |

词表缺失时报告缺项，不猜测允许值。原文概念没有对应枚举时，保留原文和定位并标记待确认，不静默替换为含义不同的值。新增枚举需要维护服务实际契约；编辑 Skill 不会改变允许值。

当前接口从服务端 `contracts/wiki/v1/vocabulary.json` 返回全局词表，没有按项目覆盖的配置能力。Skill 安装端通过接口读取，不复制该文件。项目业务术语资料的使用见[抽取说明](extraction.md#项目术语与命名)。

审核等级不从词表自行推导。当前 `context` 不返回完整审核策略，服务端仍包含按业务关键词升级审核的规则；提交时遵循实际校验结果，要求人工审核时等待独立裁决，不通过删改原文或更换词语绕过门禁。评分与审核交接见[evaluation.md](evaluation.md#审核等级门限)。

## 可选：初始化产品展示目录

initialize 复用现有 project 命名空间，要求调用者提供真实 delivery_contract，不覆盖不同的既有契约。directories 返回当前 revision 和目录映射，update-directories 提交完整目录数组并检查 expected_revision。目录只映射已有知识节点；不替代摄取、审核和必交文档校验。context 的 directory 字段为当前配置，未初始化时为 null。

## 转换与已有稿件登记

convert 和 register 使用相同字段。convert 调服务生成 parsed；register 直接读取已存在的 parsed。二者均保留原件位置及哈希，不复制原件。

```json
{
  "project": "example-project",
  "system": "CIM",
  "version": "V2.8",
  "category": "design",
  "source": "shared://team/example-project/sources/project-glossary-v1.xlsx",
  "parsed": "shared://team/example-project/parsed/v1/project-glossary.md",
  "ingest_path": "/mnt/knowledge/example-project/sources/project-glossary-v1.xlsx"
}
```

`ingest_path` 可选，保留 Agent 当时看到的原件路径。可选 `engine` 为 mineru/docling/markitdown。原件及输出必须在服务端配置的共享根内；解析输出不得覆盖已有文件。重新登记使用新路径，避免覆盖历史原件或已审稿件。

## 定稿与重新开放

```json
{
  "source": "shared://team/example-project/parsed/v1/project-glossary.md",
  "action": "freeze",
  "by": "local-agent",
  "note": "已核对工作表和表头"
}
```

action 仅支持 freeze/unfreeze。定稿是稿件状态记录，不等同于人工发布审核。已发布稿件不开放修改，应登记新版本。

## Bundle 与本地评分

Bundle 须符合 context 返回的节点 Schema。字段和完整正文由本地 LLM 生成，provenance 由服务端根据已登记来源填充，不手工编造。qscore 示例：

```json
{
  "auth": 1.0, "comp": 1.0, "rel": 1.0, "fresh": 0.8,
  "struct": 0.9, "reuse": 0.7, "risk": 0.1, "total": 0.92
}
```

以上分数应使用 L1_expert 或更严格的审核等级。位置证据示例：`"source_location": {"sheet":"术语", "cells":"A2:D5"}`。PDF 可用 pages，Markdown 可用 section/lines；只填写实际可确认的值。

提交请求引用共享 Bundle 文件：

```json
{"uri":"shared://team/example-project/work/CR-20261105-0001/nodes.json"}
```

默认由独立人工审核批准后发布。只有服务器管理员显式设置 CIM_WIKI_AUTO_PUBLISH=true 才允许合格的 L0 新页面自动放行，Agent 的评分和请求字段不能开启该权限。返回 state=pending 时必须先人工审核。服务端保存提交快照及 digest，后续修改共享 nodes.json 不会悄悄替换已提交版本；修订使用新的 Bundle ID。已有页面即使评分达到 L0 也需要审核。

## 审核与编译

仅在用户明确裁决后，由人工审核端发送。服务端通过 `CIM_WIKI_REVIEW_TOKENS` 配置身份→独立随机令牌映射（至少32字符，不能与 Agent 令牌相同）。人工端设置 CIM_WIKI_REVIEW_TOKEN；不得把此令牌注入 Agent 运行环境。自动化令牌调用 review 返回403。审核人由凭证绑定，不能从任意请求字符串认领身份：

```json
{"bundle_id":"CR-20261105-0001","decision":"approve","note":"实际批准说明"}
```

拒绝时 decision=reject。reviewer 由服务端凭证绑定；如请求包含 reviewer，必须与认证身份一致。未配置人工凭证时，人工审核端点拒绝批准。审核凭证不能调用 compile 等自动化写入接口。审核记录绑定提交内容 digest。

预览：

```json
{"bundle_id":"CR-20261105-0001","preview":true}
```

正式编译使用同样的请求，将 preview 改为 false。服务端执行全库门禁后写入页面，保留原始文档 URI、摄取时的路径、版本、哈希及节点内位置。validate 返回 errors、warnings、scanned；errors 非空时不能交付为校验通过。

## 失败处理

- 401：服务令牌缺失或不匹配，不打印令牌。
- 409：文档状态不符、路径已登记、批次待审/被拒绝或存在并发操作；按状态处理，不重试绕过。
- 400/422：请求、评分、来源、解析或编译契约有误，依据返回信息修正；不得假定本地降级可解决。

无共享目录访问权限时，先建立双方可见的挂载与路径映射，不要求把业务文件复制进服务端代码目录。
