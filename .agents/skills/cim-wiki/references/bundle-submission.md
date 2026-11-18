# Bundle 生成与提交前检查

Bundle 是已有文档及其来源、身份、评分和正文的结构化提交包，不是另一份文档，也不是登记来源的请求。字段以当前服务 context.node_schema 为准；当前项目模板以 document_defaults.definition.templates 为准，template_binding 仅含绑定版本和摘要。

## 1. 完整读取 context

```bash
node "$SKILL/scripts/client.mjs" context --project <project-id> --summary --output /tmp/context-snapshot.json
```

--summary 只影响 stdout，保留配置状态、能力、诊断、绑定、模块及模板 id/node_type/name，不输出模板正文。--output 将完整 JSON 保存为权限 0600 的文件，适用于所有命令；已有文件会在请求前被拒绝，重试时选用新文件名。可以同时使用两个选项，摘要不能代替模板正文或 Schema。Skill 不依赖主仓 docs、Ajv 或 npm；Agent 可从保存的 JSON 按需读取并检查结构。

## 2. 对应字段

| 概念 | Bundle 字段 | 来源与要求 |
| --- | --- | --- |
| 节点类型 | type | 使用所选模板的 node_type，例如实际 SDD 模板通常对应 design；不发送 node_type 或把 sdd 当节点类型 |
| 模板标识 | template_id | 使用当前项目 templates[].id，不拼接 sdd-{module}，也不从 template_binding 猜模板 ID |
| 文档编号 | id | 已登记身份的 node_id，与正文文档信息中的文档 ID 相同 |
| 身份记录 | document_id | 已登记身份的 UUID；列表返回 id，预留接口返回 document_id，不能填文档编号 |
| 产品、版本、业务域、模块 | product/version/domain/module | 按 Schema 放在节点顶层，取真实资料；不创建 metadata 包裹对象 |
| 正文 | content | 通过 check-document 的完整正文，去掉唯一开头的一级标题；title 必须与该标题及文档信息名称一致 |
| 来源 | source/source_location | 复用已登记且冻结的共享 URI 和真实位置，不改变原件证据 |
| 评分与审核等级 | qscore/review_level | 真实七维评分、复算 total，按风险保守设置等级；不复制示例分数或宣称已审核 |

[SDD Bundle 完整字段示例](examples/sdd-bundle.json)为纯虚构的结构示例，符合机器 Schema，但正文、UUID、来源、评分、时间和产品信息均须替换；不是可直接提交的业务样本。使用前先确认当前 Project 确有该模板及对应类型。reviewer=auto 是服务端处理标记，不表示人工批准；status=published 是节点编译目标，不代表已发布。服务会重新计算 confidence，并设置 reviewer、默认状态和时间等服务端字段，不能自行伪造审核身份。

## 3. 提交前顺序

1. 完整读取 Schema、模板、身份和配置能力；复用已有身份，不因格式错误重新取号。
2. 对每份完整文档执行 check-document，提交实际 document_id、template_id、target_path 和 phase=draft。冻结稿需修订时先 unfreeze，处理全部 error 并记录 warning 后再 freeze；不改 Project 规则以迁就当前文档。
3. 按机器契约构造 Bundle，检查必填字段、类型和额外字段。只去掉文档开头的唯一一级标题，不删除业务内容或改动来源 URI；再核对服务拼接后的标题与正文。
4. 查询同名 Bundle；未成功保存的失败请求可以修正后重试，已有提交的修订使用新 ID。
5. 提交并保存完整响应：

```bash
node "$SKILL/scripts/client.mjs" submit --json-file submit-request.json --output /tmp/submit-response.json
```

请求仍为 {"uri":"shared://team/<project>/bundles/nodes.json"}。结构不合规时服务返回 HTTP 422、code=BUNDLE_SCHEMA_INVALID、diagnostics[{path,keyword,message}]，例如 /nodes/0/type；完整错误响应也写入 --output，客户端以非零状态退出并在 stderr 显示字段路径。服务端自动字段可省略，但提供的值仍须满足机器类型；不会把 metadata、node_type 或非 UUID 身份静默转换成正确结构。

结构检查先于模板、命名身份、正文、来源和评分检查；结构通过不代表其他门禁已通过。默认等待独立人工审核；审核通过后按任务范围先 compile preview。全库交付数量和模块覆盖不能由这一批文档的冻结状态或单份模板检查代替。
