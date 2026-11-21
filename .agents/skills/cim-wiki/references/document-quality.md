# 文档提交、预览、冻结与审核

本地 ingest 完成解析、按类型整理及校验后，按授权选择保留本地、保存草稿或提交。submit 不要求先评分或冻结，Skill 不调用 Wiki compile。

## 草稿与正式提交

save-draft 对应 POST /document-drafts，submit 对应 POST /document-submit。成功后均出现在文档结果列表；正式提交不依赖先保存草稿。完整上传命令见[文档包](document-packages.md#3-上传候选并提交)。

| 字段 | 取值与要求 |
| --- | --- |
| project | 当前项目 ID |
| run_id | 当前项目 running 状态的 ingest run；active 是错误文案中的描述，不是可发送的状态枚举 |
| logical_key | 正式提交必需；启用正式身份时等于 document_id。未启用身份时使用稳定业务键；草稿可省略 |
| document_id | 启用项目命名时的身份 UUID；草稿可省略，不填 node_id |
| template_id | 实际专门模板 ID，与本地报告一致；无专门模板省略或 null |
| target_path | 项目相对 Markdown 路径，按本地类型／目录规则选择；启用命名时使用身份 filename |
| content_uri | 候选文件或包 URI；--package-root 由客户端上传后补充 |
| parsed_uri | convert/register 返回的解析包 URI |
| parsed_source_id | 对应 document.doc_id；多份原稿解析为同一解析 URI 时必须指定以消除歧义，建议始终保留 |
| recipe_version | 本次处理配方版本；例如 agent-ingest-v1，是业务记录值，不是硬编码允许值 |
| source_links | 非空数组，每项引用真实 source_version_id=observation.id，可附真实 location |
| local_report | ingest.mjs 实际报告，由 --report 载入；不可用示意对象替代 |

启用正式身份的请求示意（URI、ID、路径均取真实回执；使用 --package-root 和 --report 时不必手填 content_uri、local_report）：

```json
{
  "project": "example-project",
  "run_id": "实际 running 批次 ID",
  "logical_key": "正式身份 UUID",
  "document_id": "同一个正式身份 UUID",
  "template_id": "product",
  "target_path": "doc/00-overview/服务返回的filename.md",
  "parsed_uri": "document-package://实际解析包摘要",
  "parsed_source_id": "convert/register 返回的 document.doc_id",
  "recipe_version": "agent-ingest-v1",
  "source_links": [{ "source_version_id": "实际 observation.id" }]
}
```

客户端要求正式提交报告 errors 为空。服务端核对报告的项目、正文摘要、规则摘要、模板 ID、目标路径、文档身份与实际候选一致；正式报告 errors 必须是空数组。正文和附件检查后发生变化需重跑本地 ingest，不能用旧报告提交。

服务端只核验模板 ID 已登记、项目／身份／来源关联、路径安全、摘要、版本及安全 Markdown，不重跑正文章节、表格或类型目录适配检查。草稿允许报告含未完成诊断，但仍核对元数据一致性。qscore 可省略，未评分不生成默认分数，也不阻断人工审核申请。

## 来源登记与批次

upload 返回上传对象；convert/register 返回原稿与解析稿关系；source-observations 才返回 source_version_id。uploaded:// 可作为 observation.original_uri，但 source_links.source_version_id 必须是 observation.id，不能填 uploaded URI 或 document.doc_id。

已有仓库来源时优先使用[采集器](project-sources.md#文档源执行)，自动上传原稿和证据并登记批次及观测。手工登记只用于已有真实证据的恢复场景，不构造假的 revision、commit、UUID 或仓库信息文件。

通过 `list-ingest-runs --project ID` 查询运行；通过 `list-source-observations --project ID` 查询观测，分页时继续读取 next_cursor。来源需与所用批次的源配置及固定版本对应。不要拿无关 running 批次拼接历史观测。

确需创建批次时，使用 `client.mjs ingest-runs --json-file 请求.json --output 新回执.json`。字段按真实源类型区分：

| 来源 | 创建运行的 JSON 字段（除 project 外） | 观测所需额外证据 |
| --- | --- | --- |
| SVN | source_id、source_config_id、recipe_version、operative_revision、repository_uuid | svn_info_uri，内容需匹配固定修订与仓库 UUID |
| Git | source_id、source_config_id、recipe_version、完整 commit_sha、repository_url | git_info_uri、git_blob_oid，内容需匹配固定提交与文件 |
| local_file | source_type=local_file、recipe_version；仅无任何仓库文档源配置时允许 | 明确本地文件来源，不声称仓库版本证明 |

source_id/config_id 取项目 context，repository_url 取该配置；Git 不使用 SVN 的 operative_revision/repository_uuid。创建请求不填写旧记录的 revision 或 status=active，创建成功返回 status=running。

随后用 `client.mjs source-observations --json-file 请求.json --output 新回执.json` 登记 project、run_id、repository_path、original_uri、original_sha256 及上表相应证据。原稿包的原始哈希使用 register 的 document.original_sha256；source_links 覆盖包的实际成员观测，或引用对应整个原稿包的观测。缺少来源配置或证据时报告具体缺项，不改用 local_file 绕过。

提交、观测需要 run 仍为 running，待本次所有处理和提交完成后才通过 ingest-runs 发送 id、当前 revision 及实际终态 completed/partial/failed/cancelled。终态不能直接改回 running；后续处理需创建符合来源证据的新批次。

## 显式冻结与申请审核

submit 响应中 data.id 是 artifact_id，data.revision 是成果修订号；不要把 document_id、source_version_id 或业务文档版本当成它们。仅在用户授权冻结时发送：

```json
{ "project": "example-project", "artifact_id": "submit 的 data.id", "expected_revision": 1 }
```

示例修订号 1 须替换为真实 data.revision。用 `client.mjs freeze --json-file 请求.json` 调用；服务仍核对留存原稿、候选、解析稿和附件哈希，返回新的 revision 和 workflow_state=frozen。submit 取消原稿重复读取不改变 freeze 的检查范围。

审核申请请求为 `{project,artifact_id}`，通过 `client.mjs review --json-file 请求.json` 发送，使用 Agent 的 CIM_WIKI_TOKEN。它只创建 scope=document、approval_mode=manual 的审核任务，不填写 decision 或 reviewer，不使用人工审核凭据。独立审核人在管理界面作出决定；提交、冻结、申请审核均不等于批准或 Wiki 发布。

## 查询、预览与重试

list-document-results、list-document-review-tasks、list-document-review-events 使用 --project 查询。管理会话可预览和下载当前项目成果，不向浏览器暴露服务 Bearer；无管理会话时报告浏览器验证未执行。

客户端按命令与内容生成幂等键，不自动重试。超时后先查询回执和台账；结果未知且需要重试时保留相同请求与幂等键，--output 换新路径。确定性 4xx 按具体诊断修正，不循环提交同一错误输入。正文变化或草稿转正式提交时重新检查并提交完整新版本，不原地改写历史记录。
