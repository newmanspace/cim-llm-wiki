# 服务调用契约

服务地址为 `CIM_WIKI_URL`，自动化令牌为 `CIM_WIKI_TOKEN`，review 只申请审核，独立审核人在管理界面裁决，请求使用 `Authorization: Bearer ...`。统一前缀 `/api/v2/knowledge`。本地 ingest 调用解析基础能力，不直接调用解析引擎；Wiki 构建发布不属于 Skill 命令。

| client 命令 | 方法与端点 | 输入 |
|---|---|---|
| project | GET /projects/{project} | --project；项目资料，不含模板正文 |
| templates | GET /projects/{project}/templates | --project，可选 --template-id；当前引用模板 |
| initialize | POST /initialize | --json-file，project/name/product_version/modules |
| render-document | POST /render-document | --json-file，project/template_id/values |
| directories | GET /directories?project=ID | --project |
| context | GET /context?project=ID | --project |
| document | GET /document?source=URI | --source |
| upload | POST /upload?project=ID&filename=NAME | --project、--file；二进制上传 |
| upload-package | POST /document-packages | --project、--package-root、--entry；完整文件清单 |
| download-package | GET /document-packages，GET /uploads/content | --project、--source、--download-dir；逐文件核验哈希 |
| convert | POST /convert | --json-file、--file、--download-dir；自动上传原件并下载解析包 |
| register | POST /register | --json-file |
| state | POST /state | --json-file |
| save-draft | POST /document-drafts | --json-file；草稿保存 |
| submit | POST /document-submit | --json-file；完整候选、来源及本地报告 |
| freeze | POST /document-freeze | --json-file；project/artifact_id/expected_revision |
| review | POST /document-review-requests | --json-file；project/artifact_id，申请人工审核 |

客户端通用选项：`--output FILE` 以 0600 权限保存完整 JSON 响应（成功和 HTTP 错误均保存），stdout 改为文件回执；已有文件在请求前拒绝，避免覆盖。`context --summary` 仅输出配置、能力、诊断和模板标识摘要，可与 --output 同用；其他命令不接受 --summary。

文档提交字段见[文档结果处理](document-quality.md)。本地 ingest 校验错误时非零退出；HTTP 错误保留完整响应与 request_id。不构造 Wiki 节点 Bundle。

除 upload 为二进制请求体外，写操作请求为 JSON；`--json-file -` 从 stdin 读取。客户端显示服务响应，HTTP 失败或完整校验发现 errors 时以非零状态退出，不自动重复写入请求。

## 登记与页面可见性

register/convert 成功即保存服务端来源记录，项目管理的“源文档”与项目配置中的 docs 直接查询该记录，无需 submit、review 或 compile。列表显示转换文件路径、原始来源 URI、当前状态与状态历史；freeze/unfreeze 后重新查询即反映最新状态。来源记录与归档产物、Wiki 节点不同，登记不代表产物已归档或 Wiki 已发布。

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

`context --project ID` 用于发现已有配置，不执行写入或自动修复。返回 `configuration_status`、`diagnostics`、`capabilities`；操作前根据能力标志判断配置是否就绪，不能只判断 HTTP 200。`collect` 描述来源采集配置；`submit`、`compile`、`publish_document` 描述服务器独立节点/发布链路，不作为文档 submit 的前置。`check_document=false` 表示服务不再提供正文检查；本地 ingest 按读取的完整规则检查。

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

## 独立项目与模板查询

project 返回 schema_version、project、content_kind、project_info、repos、modules、data_sources。未启用台账时 data_sources=null，空数组表示确实没有来源；来源读取失败返回 PROJECT_SOURCES_UNAVAILABLE，不伪装为空集合。

templates 返回 schema_version、project、binding（version/digest/at）、templates（包含 body/contract/example/invalid_example）、terms、directories、template_variables、document_defaults_schema。只返回已引用版本，不附全局升级目标。两种 Wiki 模式行为一致；不依赖文档源可用性，也不允许 Agent 发起模板绑定。

错误：项目不存在 404 / PROJECT_NOT_FOUND，项目读取失败 503 / PROJECT_UNAVAILABLE，未引用 409 / TEMPLATE_SOURCE_UNBOUND，未知模板 404 / TEMPLATE_NOT_FOUND，模板损坏 422 / TEMPLATE_SOURCE_INVALID，存储不可读 503 / TEMPLATE_SOURCE_UNAVAILABLE。认证沿用 Agent Bearer token，错误不触发登录或 Cookie 降级。

context 保留现有运行时聚合视图。repository_docs 的运行时模板标记为 not_applicable，不代表独立 templates 接口不可用。文档编写及 QA 以独立接口的实际结果为依据；完整响应可用 --output 保存，不能只读摘要。

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

生成前读取 document_defaults.definition.templates，按模板正文和 contract 填充；正文由本地 ingest 提前检查，服务仅核验入库边界。术语全称从有效 definition.terms 读取，受控节点枚举仍来自 vocabulary。归类产物登记须指定 template_id，document_contract_digest 由服务计算。

## 转换与已有稿件登记

convert 接受 project、system、version、category、source（uploaded URI 或受支持的原稿包）、可选 engine；自动分配解析输出。register 接受相同元数据及 Markdown 原稿包，无须解析。二者返回来源记录、markdown、parsed_uri、parsed_sha256、package_sha256、entry 和 files；通过鉴权下载 API 落地全部解析附件。

客户端快捷命令、包清单和来源关联见[本地文件与附件包](document-packages.md)。已有 shared 请求仍用于历史服务能力，新 Skill 不要求 source/parsed 共享路径；不得把本机绝对路径发给服务端读取。

## 定稿与重新开放

```json
{
  "project": "example-project",
  "source": "document-package://登记解析包实际摘要",
  "parsed_source_id": "来源登记 doc_id",
  "action": "freeze",
  "by": "local-agent",
  "note": "已核对工作表和表头"
}
```

action 仅支持 freeze/unfreeze。定稿是稿件状态记录，不等同于人工发布审核。已发布稿件不开放修改，应登记新版本。

## 文档提交、冻结与审核

submit 对应 POST /api/v2/knowledge/document-submit，不再提交节点 Bundle。文档请求字段和草稿保存见 [文档结果处理](document-quality.md)。提交成功即进入文档结果列表，可在未冻结、未评分时预览。freeze 对应 document-freeze，review 对应 document-review-requests（申请，不是批准）。

正文、模板、目录适配和保真检查由本地 ingest 完成，不再提供 Skill 使用的 check-document。服务保留路径安全、身份、项目、版本、哈希与状态检查。Wiki compile、构建、发布由服务器独立负责，不属于 Skill 命令。
