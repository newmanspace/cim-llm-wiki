# 本地文件、图片和附件传输

本地 Agent 不需要访问服务器文件系统。原稿、解析稿、候选保存在本机业务工作目录，通过 API 上传和下载。`shared://` 仅为已有服务及历史记录读取能力，不作为 Skill 前置。整个 Skill 目录需一起安装，含 scripts/dist；无需 npm install。

## 1. 原稿上传与解析下载

服务地址和 Bearer 使用 CIM_WIKI_URL、CIM_WIKI_TOKEN；不要将 Token 放入 URL、正文、文件或输出。准备 convert 元数据 JSON，包含 project、system、version、category，可选 engine，不需要 source 或 parsed 共享路径：

```bash
node "$SKILL/scripts/client.mjs" convert --json-file /local/work/convert.json --file /local/original/design.docx --download-dir /local/work/parsed-v1 --output /local/work/convert-response.json
```

客户端先上传原件，再调用 convert，逐文件核对解析包下载哈希。响应包含 document（来源登记）、markdown、parsed_uri、parsed_sha256、package_sha256、entry、files。本地 parsed-v1 必须为新目录；不覆盖原件或已有输出。下载失败时不宣称解析包已完整落地；服务端解析结果可通过 download-package 重新下载，无需再次解析：

```bash
node "$SKILL/scripts/client.mjs" download-package --project <project> --source <document-package://真实摘要> --download-dir /local/work/parsed-retry --output /local/work/download-response.json
```

已有 Markdown 连同引用附件直接上传并 register，无须调用解析器：

```bash
node "$SKILL/scripts/client.mjs" register --json-file /local/work/register.json --package-root /local/original --entry document.md --output /local/work/register-response.json
```

register 元数据包含 project、system、version、category。此快捷入口将原稿包同时作为未重新解析的解析基线；候选必须另存，不能覆盖原稿。Git/SVN 原稿采用采集返回的 source_package_uri，并保留 package_source_links；不得把候选重新登记成原件。

## 2. 本地候选包与检查

建议结构（入口也可以在 doc/code 子目录）：

```text
candidate/
  document.md
  assets/flow.png
  attachments/function-list.xlsx
report.json
```

正文使用 `![流程图](assets/flow.png)`、`[功能清单](attachments/function-list.xlsx)`。保留中文和空格名称，Markdown 路径按需要编码。工具按 Markdown 语法识别内联、引用式链接，递归纳入包内 Markdown 及依赖，忽略代码示例。相对路径可包含合法父目录引用，但规范化后不得越出包根；拒绝符号链接和重复／大小写冲突路径。缺失文件是 error，不猜成站内链接。

```bash
node "$SKILL/scripts/ingest.mjs" --rules /local/work/project-rules.json --json-file /local/work/candidate-metadata.json --root /local/work/candidate --document document.md --output /local/work/report.json
```

元数据包含 project、实际 template_id（通用格式省略）、target_path、可选 document_id、identity 及 fidelity；正文直接从 --document 读取，不手工塞入 JSON。报告包括正文哈希、完整 package_manifest、package_sha256、errors/warnings。修改正文或任一附件、正式身份、目标路径后都要重跑；无身份只产生 warning。Agent 对照原稿后才能声明 fidelity=checked。

PNG/JPEG/GIF/WebP 可预览；SVG 及其他附件只下载，不内联执行。远程网页链接保留；远程图片默认不抓取，报告未归档 warning，管理页展示替代文字。若需要归档，由 Agent 按任务授权下载到本地、核对来源并重新检查。不将下载失败或解析缺失悄悄记为通过。

## 3. 上传候选并提交

```bash
node "$SKILL/scripts/client.mjs" submit --json-file /local/work/submit.json --package-root /local/work/candidate --entry document.md --report /local/work/report.json --output /local/work/submit-response.json
```

submit.json 填 project、run_id、logical_key、target_path、实际 template_id、正式 document_id（命名启用时）、parsed_uri、parsed_source_id（convert/register 返回的 document.doc_id）、recipe_version、source_links；候选 content_uri 和 local_report 由客户端补充。不要求 qscore，不提交 Wiki Bundle。客户端先核对报告，再重算本地包摘要，上传所有引用文件、封装不可变包后 submit。登记阶段元数据与报告不一致或文件变化时停止，不使用旧报告。

submit 成功后立即在文档结果列表可见，可看正文、图片和下载附件，不依赖 freeze、review、compile。管理预览使用管理会话；Agent 不能将服务 Bearer 交给浏览器。

仅需草稿时用同样参数调用 save-draft；转换测试默认停在本地，未经授权不上传候选、提交或冻结。上传、包封装、来源登记和文档提交是不同完成状态。使用 --output 时，自动上传和包封装的阶段回执保存在 `<输出文件>.receipts/`，最终服务响应保存到输出文件。解析成功但下载失败仍保存解析包响应和 download_error，可据 URI 重试下载。超时后按相同内容重试；确定性文件 URI、包 URI 与提交幂等键避免重复版本，不把失败当成成功。

单独传输也可使用：

```bash
node "$SKILL/scripts/client.mjs" upload --project <project> --file /local/original/file.pdf --output /local/work/upload.json
node "$SKILL/scripts/client.mjs" upload-package --project <project> --package-root /local/work/candidate --entry document.md --output /local/work/package.json
```

默认限制：单文件 25 MiB、Markdown 4 MiB、单包 100 MiB、200 文件。超限明确报错；不自动截断。上传 URI 不携带权限，跨项目不能读取或引用；文件哈希不是访问凭证。

## 4. 来源证据

已配置仓库的项目仍需真实固定 Git/SVN 版本和观察记录。使用 git-source/svn-source 的 --output-root 本地目录，采集脚本自动上传原件和证据；Markdown 输出 source_package_uri 及 package_source_links。候选 source_links 覆盖原稿包所有附件，不改用 local_file 绕过仓库来源要求。

没有配置任何仓库来源的项目才允许本地文件运行：通过 ingest-runs 提交 project、source_type=local_file、recipe_version，随后通过 source-observations 登记 run_id、repository_path（本地逻辑相对路径）、original_uri、original_sha256。原稿为包时哈希使用 register 返回的 original_sha256；整个包通过不可变 URI 保留。此类型明确表示本地文件，不能宣称 Git/SVN 来源证明。

freeze 校验服务端已经保存的正文、图片、附件、解析稿及原稿包；本地后续修改不会影响已提交版本。再次提交产生新版本，旧版本及审核目标不变。Wiki 构建发布不属于 Skill。
