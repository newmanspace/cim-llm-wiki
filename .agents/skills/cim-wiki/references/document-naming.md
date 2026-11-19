# 文档命名与身份登记

先读取 context.document_naming；仅采用当前项目显式绑定的策略，不使用系统最新模板或本地默认规则兜底。enabled=false 表示当前绑定未启用此能力；enabled=true、ready=false 时报告缺少项目简称或模块，不擅自创建配置。

正式文件名固定为 `{项目缩写}-{文档类型}-{模块}-{主题}-{序号}.md`。序号按项目内模块分配，跨类型、跨主题连续递增，不是版本；至少三位，允许空缺，旧号不回收。四段业务键相同只能对应一份文档。类型按 sdd/idd 等实际文档类型区分，不由共同 node_type 推断成 des。

1. 先判定真实文档类型，读取 document_naming.types 中的代码与模板关联；无模板文档使用明确配置的实际类型，不能为命名套用其他模板。
2. 使用管理员登记的项目简称、模块代码及稳定主题代码；新建前检索该模块已有主题，处理近义主题，数据库只保证代码精确唯一。
3. 查询已有身份：

```bash
node "$SKILL/scripts/client.mjs" list-document-identities --project <project-id> --module <module> --doc-type sdd --topic <topic>
```

4. 修订时复用已有 id/filename/node_id。新建时准备 JSON `{ "project": "example-project", "doc_type": "sdd", "module": "chart", "topic": "control-chart" }`，再执行：

```bash
node "$SKILL/scripts/client.mjs" reserve-document-identity --json-file reserve-request.json
```

客户端按请求正文生成稳定幂等键，网络结果未知时保留相同正文重试。返回 data.document_id、filename、node_id、sequence、policy_digest；不得提交自行指定的序号或文件名。409 返回已有身份时，先明确进入修订，不能覆盖或改号另建。

5. 按现有目录规则选择目标目录，使用服务返回的 filename；文档信息中的文档 ID 使用 node_id。在本地 ingest 校验中提供 document_id、identity、template_id、document 和 target_path，处理身份展示及正文错误；服务端只验证正式身份归属及命名元数据。
6. artifacts 提交 document_id，logical_key 使用该 document_id；服务记录命名摘要并与来源和质量检查联合校验。Bundle 中每个最终页面的 document_id 使用身份 UUID（列表记录的 id／预留返回的 document_id），id 使用 node_id，template_id 使用项目真实模板 ID，type 使用该模板的 node_type，并填写模块。字段示例见[Bundle 提交](bundle-submission.md)。拆成多份文档时分别登记，不按源文件共用身份。

项目级业务文档使用显式注册的 common 模块，仍保留全部字段，例如 mycim-spc-glossary-common-terminology-001.md。编译、预览及重试不占号；失败预留保留，继续任务使用原身份。存量文件改名按审定迁移清单执行，禁止批量猜测、更换来源 URI 或改写不可变历史。
