# 服务调用契约

服务地址为 `CIM_WIKI_URL`，自动化令牌为 `CIM_WIKI_TOKEN`，人工 review 命令另使用 `CIM_WIKI_REVIEW_TOKEN`，请求使用 `Authorization: Bearer ...`。统一前缀 `/api/v2/knowledge`。不要调用已停用的旧 ingest/审核写入接口，也不直接调用解析引擎。

| client 命令 | 方法与端点 | 输入 |
|---|---|---|
| initialize | POST /initialize | --json-file，project/name/product_version/modules |
| render-document | POST /render-document | --json-file，project/template_id/values |
| check-document | POST /check-document | --json-file，project/template_id/document/phase，可选 target_path |
| directories | GET /directories?project=ID | --project |
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

## 服务地址与路由排查

本项目知识 API 由独立 Node `knowledge` 服务提供；Go `server` 提供 `/api/v1/admin` 等管理 API。版本路径不表示两套 API 必须注册到同一个进程。

| 调用位置 | CIM_WIKI_URL | 用途 |
| --- | --- | --- |
| 宿主机或可访问部署主机的远程 Agent | `http://<部署主机>:8099`，或运维提供的统一域名 | 网关将 `/api/v2/knowledge/` 转发到 knowledge |
| 同一 Compose 网络内的容器 | `http://knowledge:8090` | 直接访问知识服务 |
| Go 管理服务 | `http://<部署主机>:8080` | 不提供 `/api/v2/knowledge`，不能作为此 skill 的入口 |

先查看当前环境中的 CIM_WIKI_URL（不输出令牌），运行 `client.mjs context --project <ID>` 并检查 HTTP 结果。404 时核对实际 host/port、网关是否包含 knowledge 转发及项目是否存在；401 时检查知识服务令牌；连接失败或 502 时检查网络和 knowledge 上游。context 成功但 collect=false 时再看返回的配置诊断。

Go 启动日志只列出 admin 路由是正常现象，不能据此判断知识服务没有加载。`docker restart cim-wiki-server` 只重启 Go 进程，不更新镜像、不加载 Node 路由。Compose 服务名是 server、knowledge，不存在 wiki-server；文档处理 skill 不自行重建、重启服务。需要运维处理时报告已验证的请求 origin、状态码与响应诊断，隐藏凭据。

独立安装时同步整个 `.agents/skills/cim-wiki/` 目录，保留 scripts 和 references；主仓库中其他同名简版或旧副本不能代替这个客户端包。

## 项目上下文响应

`context --project ID` 用于发现已有配置，不执行写入或自动修复。返回 `configuration_status`、`diagnostics`、`capabilities`；操作前根据能力标志判断配置是否就绪，不能只判断 HTTP 200。`collect`、`check_document`、`submit`、`compile`、`publish_document` 仍受对应操作的实际来源、契约、质量及审核校验约束。

完整项的状态为 ready；缺项及失败状态包括 missing、invalid、disabled、unavailable、not_applicable。关联字段在不可读或不适用时为 null；成功读到的列表可为 []。`template_binding` 表示持久化绑定，`document_defaults` 仅在有效定义可读取时有值。缺少模板时目录项 `node_types` 为 null，不能推测类型。模块配置与绑定清单不同时返回 MODULE_INVENTORY_MISMATCH 诊断，不自动同步。

以下为缺少 Project 有效绑定的响应节选，不是可直接用于摄取的完整响应：

```json
{
  "schema_version": "1.0",
  "project": "example-project",
  "content_kind": "strict_nodes",
  "configuration_status": {
    "project": "ready", "document_defaults": "missing",
    "delivery_contract": "missing", "directory": "missing", "data_sources": "ready"
  },
  "document_defaults": null, "delivery_contract": null, "directory": null,
  "data_sources": [{ "id": "4", "type": "svn", "enabled": true }],
  "capabilities": { "collect": true, "check_document": false, "submit": false, "compile": false, "publish_document": false },
  "diagnostics": [{
    "component": "delivery_contract", "code": "DOCUMENT_DEFAULTS_REQUIRED",
    "message": "Project configuration requires a valid published document binding",
    "affected_operations": ["check_document", "submit", "compile", "publish_document"]
  }]
}
```

独立 `list-data-sources --project ID` 和 `list-source-revisions --project ID` 也不依赖交付契约。无配置权限时报告诊断，不通过临时参数或默认最新版绕过配置。认证不匹配返回 401；独立权限拒绝返回 403；项目不存在返回 404；项目注册表不可用返回 503；非法项目参数返回 400。项目令牌与知识服务令牌的认证契约仍分别处理。

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

initialize 复用现有 project 命名空间，只接受 project、name、product_version、modules，采用系统已发布的模板、文档契约及默认目录。不接受旧 version/delivery_contract 参数或自动化配置覆盖。系统模板需先由管理员登录后台“系统设置 · 文档模板”检查并发布。directories 返回 Project 当前有效绑定的 version、digest、directories（每项含 node_types）。目录规则通过管理员 Project 配置维护，无独立目录配置写入接口。目录只映射已有知识节点；不替代摄取、审核和必交文档校验。context 的 document_defaults 返回项目绑定版本、有效模板及契约摘要，document_defaults_schema 返回定义的机器结构。context 在未绑定有效版本时返回明确的缺项或无效诊断；依赖绑定的操作仍拒绝，必须由管理员明确绑定，不根据已有页面生成标准。

生成前读取 document_defaults.definition.templates，按模板正文和 contract 填充；check-document 可提前检查，服务提交与发布仍独立重验。术语全称从有效 definition.terms 读取，受控节点枚举仍来自 vocabulary。归类产物登记须指定 template_id，document_contract_digest 由服务计算。

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

## 按 Project 模板编写文档

新编或修订文档见 [document-authoring.md](document-authoring.md)。读取指定 Project 的模板，撰写或修改实际正文，不修改模板定义、契约或项目绑定。

render-document 使用已绑定模板的正文骨架和显式 values 填充元数据，返回 document 和 errors。请求为 project、template_id、values；允许变量从 context.template_variables 读取。它不会自动撰写业务正文，Agent 仍须依据项目资料填充各章节，不能原样交付格式样例。已有文档修订时以原文为基础，不重新渲染后覆盖已有内容。

正文完成后调用 check-document，请求为 project、template_id、document（含唯一一级标题的完整 Markdown）、phase=draft。检查的是该文档实例；用户指定了完整模板定义快照时可用 definition 检查该快照下的实例，但不能为了通过而改模板或降低约束。没有完整契约或项目绑定时，保留文档草案并说明未完成的在线检查，不伪造全局定义。

读取返回 errors 中的 severity，error 必须处理，warning 如实列出。当前 check-document 和 render-document 命令输出诊断时可能仍以零退出，不能只依赖退出码认定通过。缺失值、未知变量或非法 UTC 时间会拒绝渲染，不把模板样例中的产品、人员或日期当成真实项目信息。渲染、检查和本地编写均不自动登记、审核或发布。


## 文档类型与目标目录检查

路径路由规则见 [document-routing.md](document-routing.md)。check-document 传入 target_path 时检查该路径是否允许所选模板的 node_type；省略时只检查正文，不能声称目录已验证。类型映射唯一来源是 Project 绑定的 document_defaults.definition.directories，context.document_directories 的 node_types 是按路径派生的展示值。

artifacts 登记、复核及 publish-document 始终检查路由，不能省略。非法路径返回 document_target_invalid，无适用规则返回 document_directory_unmapped，类型不匹配返回 document_directory_mismatch，诊断包含模板、类型、目标路径、命中目录和允许目录。服务导出保留 artifact.target_path 的平面前缀，不根据正文重新选目录。

采集可以从零份文档开始：collect 仅依赖可读取的项目登记、来源台账及至少一个启用源，不依赖模板绑定、交付契约、文档目录或已交付数量。ingest-runs 与 source-observations 保留认证、项目归属、源配置/版本及证据校验；后续文档登记和发布仍执行各自的契约门禁。
