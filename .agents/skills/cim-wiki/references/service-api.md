# 服务调用契约

服务地址为 `CIM_WIKI_URL`，自动化令牌为 `CIM_WIKI_TOKEN`，人工 review 命令另使用 `CIM_WIKI_REVIEW_TOKEN`，请求使用 `Authorization: Bearer ...`。统一前缀 `/api/v2/knowledge`。不要调用已停用的旧 ingest/审核写入接口，也不直接调用解析引擎。

| client 命令 | 方法与端点 | 输入 |
|---|---|---|
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

## 转换与已有稿件登记

convert 和 register 使用相同字段。convert 调服务生成 parsed；register 直接读取已存在的 parsed。二者均保留原件位置及哈希，不复制原件。

```json
{
  "project": "mycim",
  "system": "CIM",
  "version": "V2.8",
  "category": "design",
  "source": "shared://team/mycim/sources/myCIM4.0名词对应表-V2.8.xlsx",
  "parsed": "shared://team/mycim/parsed/V2.8/名词对应表.md",
  "ingest_path": "/mnt/knowledge/mycim/sources/myCIM4.0名词对应表-V2.8.xlsx"
}
```

`ingest_path` 可选，保留 Agent 当时看到的原件路径。可选 `engine` 为 mineru/docling/markitdown。原件及输出必须在服务端配置的共享根内；解析输出不得覆盖已有文件。重新登记使用新路径，避免覆盖历史原件或已审稿件。

## 定稿与重新开放

```json
{
  "source": "shared://team/mycim/parsed/V2.8/名词对应表.md",
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
{"uri":"shared://team/mycim/work/CR-20261105-0001/nodes.json"}
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
