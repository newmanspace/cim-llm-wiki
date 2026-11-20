# 文档提交、预览、冻结与审核

本地 ingest 完成解析、按类型整理及校验后，按授权选择仅保留本地、保存草稿或提交文档。不要求先评分或冻结；不调用 Wiki compile。

## 草稿与正式提交

save-draft 对应 document-drafts，submit 对应 document-submit。两者成功后均出现在当前项目的“文档结果”列表，分别标为“草稿”与“已提交，待冻结”。管理会话可预览，无需人工审核凭据。正式提交不依赖草稿保存步骤。

```json
{
  "project": "example-project",
  "run_id": "active 状态的 ingest run ID（必需）",
  "logical_key": "正式文档身份 UUID，必须与 document_id 相同",
  "document_id": "启用命名时的正式身份 UUID，草稿可省略",
  "template_id": "专门模板填实际模板 ID；通用标准格式留空（null），与 local_report 一致",
  "target_path": "doc/50-designs/实际文件名.md",
  "content_uri": "document-package://候选包实际摘要",
  "parsed_uri": "shared:// 或 document-package:// 的解析稿 URI",
  "parsed_source_id": "convert/register 返回的 document.doc_id",
  "recipe_version": "agent-ingest-v1",
  "source_links": [{"source_version_id":"已注册的原件观察记录 ID","location":{"section":"实际章节"}}],
  "local_report": {"说明":"此处替换为 ingest.mjs 实际生成的完整报告对象，不能照抄本示意"}
}
```

**run_id 要求**：
- 必须是 active 状态的 ingest run
- 通过 `list-ingest-runs --project <project>` 查询现有 run
- 如无 active run，需创建新的 ingest run（见下文"创建 ingest run"）

**logical_key 要求**：
- 必须与 document_id 相同（都是 UUID）
- 不能是 node_id 或其他标识

**template_id 要求**：
- 必须与 local_report.template_id 一致（服务端按 `local_report.template_id === (submit.template_id ?? null)` 校验）
- 专门模板文档：submit 必须提供实际模板 ID，且与本地报告一致
- 通用标准格式文档（无专门模板，如功能清单）：template_id 留空（null），本地报告 template_id 也为 null；不要伪造模板 ID

**source_links 要求**：
- source_version_id 必须来自已注册的原件（通过 `list-source-observations` 查询）
- uploaded:// 的文件无法创建 source observation，不能用于 source_links
- 项目配置了 SVN/Git 源时，必须使用对应的 source_version_id
- source_links 必须覆盖所有登记原件

**创建 ingest run**：
```json
{
  "project": "example-project",
  "source_id": "数据源 ID",
  "source_config_id": "数据源配置 ID",
  "source_type": "svn 或 git",
  "recipe_version": "svn-skill-v1",
  "revision": 2,
  "operative_revision": "SVN revision 或 Git commit",
  "repository_uuid": "仓库 UUID"
}
```
通过 `ingest-runs --json-file <request.json>` 创建，返回的 run 状态为 running，可用于 submit。

submit 客户端要求本地报告 errors 为空，且项目、正式身份、目标路径与报告一致；服务核对正文、附件包哈希和规则摘要，保存实际不可变快照，不复查章节和模板。qscore 可省略；提供时七维必须完整，total 必须正确，不用默认分数表示未知。

草稿保存不要求正式身份。由草稿进入正式提交时取得身份并重跑本地 ingest，再提交完整候选请求生成独立提交版本，不使用 artifact_id 覆盖旧草稿。

## 显式冻结与申请审核

freeze 请求：

```json
{"project":"example-project","artifact_id":"submit 返回的 ID","expected_revision":1}
```

服务核对提交时的原件、候选与解析稿哈希，追加冻结事件，返回 workflow_state=frozen 和新的 revision。漂移、过期 revision 或已被更新版本替代时返回冲突，不覆盖旧快照。

review 是申请审核：

```json
{"project":"example-project","artifact_id":"已冻结文档 ID"}
```

服务创建 scope=document、approval_mode=manual 的审核任务，无需预先创建评分 evaluation。独立审核人在管理界面填写意见并用独立凭据作出决定；Agent 不持有审核凭据。决策绑定冻结文档包摘要（无包历史版本绑定正文摘要），当前文档版本或策略变化时旧批准不可被静默复用。

## 查询、预览与重试

list-document-results、list-document-review-tasks、list-document-review-events 使用 --project 查询；写操作使用 --json-file，客户端按命令和内容生成幂等键。同键异体返回409。未收到成功响应时用相同请求重试并查询台账，不手动改状态。

管理会话通过 document-quality/preview?id=成果ID 和 original?id=成果ID 查看候选与原件；只读取项目内已登记快照，不将服务凭据传入浏览器。预览无需 freeze、review 或 compile，审核凭据只用于决定。

Wiki 节点 Bundle、compile、构建、归类导出与发布由服务端独立管理，Skill 不编排这些步骤。文档提交或审核完成不等于 Wiki 已发布。

完整本地命令、上传下载与来源包处理见[文档包](document-packages.md)。
