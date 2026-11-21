# CIM Wiki 测试任务 Prompt：本地转换与差异核对

本提示词是供用户明确启动时使用的测试场景，不因读取 Skill 自动执行。需要“submit 后列表可见”测试时使用[文档工作流提示词](test-prompt-workflow.md)，两者授权范围不同。

## 目标与输入

对 mycim-spc-product 执行原稿解析、类型判定、候选整理、本地检查和已有 Wiki 差异核对。本轮仅交付本地候选与报告，不 save-draft、不 submit、不 freeze、不申请审核、不编译发布、不提交 Git、不改模板／绑定／既有 Wiki。

- 连接：环境中的 CIM_WIKI_URL、CIM_WIKI_TOKEN，不输出或索取明文令牌。
- 文档源：读取项目 context.data_sources；按当前任务已确认位置及范围采集，不使用本提示词内另行硬编码的仓库地址。
- 输出：Agent 本机新的 test-conversion-<时间戳> 工作目录；不要求服务端共享挂载。
- 样本：在已确认范围内选择 6～8 份代表性文档，尽量覆盖专门模板、无专门模板、Excel 表格、PPT 图形、长文档及已有页面修订，并说明选样理由。实际资料不足时如实报告，不补造样本。

## 执行要求

1. 使用 `node "$SKILL/scripts/client.mjs" project --project mycim-spc-product` 查询项目，再以 templates 保存完整项目模板及 binding.version/digest；context 读取来源及运行能力，摘要不代替完整规则。
2. 复用已确认的项目 Git/SVN 数据源及本机认证，使用 `git-source.mjs` 或 `svn-source.mjs` 的 --output-root 采集固定版本、原稿和证据；已有资料按真实来源复用，不伪装仓库证据。
3. 按[上传与解析示例](references/document-packages.md#1-原稿上传解析与下载)使用 convert 的 --file、--download-dir、--output；已有 Markdown 原稿连同附件按包 register。手动 HTTP 调用采用该页完整 curl 流程，不使用 multipart、FormData 或 -F。
4. 对照原稿核对正文、表格、公式、单位、限定条件及图片。PPT 形状和连线也要检查，长文档处理保留上下文。解析成功不等于转换完成。
5. 判定真实类型，有匹配模板才套专门模板，无模板采用通用格式；不把功能清单改编成 URD/FRD。候选完整保留一级标题，来源及必要转换说明集中在参考文档。
6. 使用 `scripts/ingest.mjs --rules <完整模板响应> --json-file <候选元数据> --root <本地包根> --document <入口相对路径> --output <新报告>` 完成本地检查。专门模板与通用格式均走该工具，不调用 check-document；无正式身份只记 warning，保真未核对保留 not_checked。
7. 对比已发布 Wiki 或用户已提供的页面快照，区分新增、修改、不变、重复、冲突及受影响链接；没有读取权限时标记差异核对未执行，不为此发布候选。
8. 逐文档报告原稿版本／哈希、解析包回执、类型与模板匹配依据、候选路径、本地 errors/warnings、保真核对及差异。区分解析成功、候选生成、适用检查通过、失败、未执行和不适用。

## 完成与停止

交付样本清单、候选及附件、检查报告、差异和问题清单。本轮的“草稿”指本地候选，不表示服务器已保存草稿。不覆盖旧文件，不自动进入提交或审核阶段；真实阻塞保留已完成成果并报告。
