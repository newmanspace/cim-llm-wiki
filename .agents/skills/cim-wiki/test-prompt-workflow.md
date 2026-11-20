# CIM Wiki 新文档流程测试提示词

使用本项目最新版 cim-wiki Skill：
`/docker/cim-llm-wiki/.agents/skills/cim-wiki/SKILL.md`。

对 mycim-spc-product 执行一次“本地 ingest → submit → 文档列表核对”测试。

## 已确认输入与授权

- 服务地址：http://mesap02:8099；复用环境或既有受控连接配置中的 Bearer 凭据，不输出或索取明文令牌。
- 项目：mycim-spc-product。
- 使用 Agent 本机可读原件；测试机若可访问 `/docker/cim-llm-wiki/data/shared/mycim-spc-product/test-update-20261119/originals/` 可复用其中原件与真实证据，但不假设远程 Agent 可读服务端路径；允许读取已配置的项目 SVN 文档源，按实际固定 revision 补齐必要证据，不修改源配置。
- 从此前七份样本中自主选择三份，覆盖一份 SDD、一份 Excel 功能清单和一份已有 Markdown，说明选样理由，不再重复询问范围；至少一份实际包含图片及下载附件。
- 新输出目录：Agent 本机可写的 `test-workflow-<本次时间戳>/`。保留原件，不覆盖此前测试结果。
- 允许按真实来源登记采集批次和观察记录，并将至少两份合格候选提交到服务端，验证文档列表可见性。这会留下真实测试提交记录。

## 执行要求

1. 分别调用 project 和 templates 读取实际项目与完整规则；保存 binding.version、binding.digest、模板 body/contract、命名和目录规则。Wiki compile 能力不可用不作为文档 ingest/submit 的前置阻塞；项目或所需规则真正不可用时报告具体缺项。
2. 本地 ingest 包含解析编排、文档类型判定、按匹配模板提取整理、通用格式/模板/目录检查，以及对照原件的保真核对。有匹配专门模板才使用；无专门模板采用通用标准格式，不强套 FRD 或其他模板。convert/register 只是解析与来源基础能力，不等于 ingest 完成。
3. 使用随 Skill 分发的 `scripts/ingest.mjs` 执行本地检查，不调用服务端 check-document。新文档首次检查不提前预留正式身份；未预留身份只记 warning，真实正文错误仍是 error。未实际完成保真核对时保留 fidelity=not_checked，不宣称已核对。
4. 所有正文错误解决后，选择至少两份候选正式 submit，尽量覆盖一份专门模板和一份通用标准格式文档。仅在此阶段取得或复用正式身份；复用现有文档业务身份，不猜序号或通过换号绕过冲突。将实际身份填入正文、路径及请求后重新执行本地校验，保证报告与最终提交版本一致。没有适用的项目命名类型时明确报告限制，不修改类型配置或虚构 template_id。
5. qscore 省略，不创建默认分数或虚假的质量评估。提交完整文档请求，附真实来源关联与本地报告；不构造 Wiki 节点 Bundle。保存每次 submit 的完整响应，包括 artifact_id、version、revision、workflow_state 和 content_sha256。
6. 每次 submit 成功后立即查询 list-document-results，确认返回同一成果 ID、目标路径和“已提交，待冻结”状态；核对管理页 `/admin/document-results?project=mycim-spc-product` 中可见且可预览完整候选，不等待 freeze、review 或 Wiki compile。预览使用管理会话，不要求独立审核令牌；确实没有管理会话时报告页面验证未执行，并提供列表 API 的真实验证结果。
7. 输出样本清单、逐文档本地 errors/warnings/未执行项、提交响应清单、列表与预览验证结果。区分本地完成、已提交、未冻结、未审核及未发布；只将实际执行的检查计为通过。

## 本地优先与附件专项验收

- 复用配置的 Git/SVN 来源时使用 `--output-root`，自动上传原件与证据。不能配置 shared 根或用 scp 补链路；记录真实固定版本。
- 按 `references/document-packages.md` 用 convert 的 `--file --download-dir` 下载完整解析包，已有 MD 连同附件按包 register；逐文件核对下载摘要。
- 候选 Markdown 保留图片与附件相对引用，使用 ingest 的 `--root --document` 读取本地文件并生成 package_sha256。submit 使用 `--package-root --entry --report` 自动上传完整包。
- submit 后在文档列表核对图片实际显示、附件下载字节一致，不以只返回 Markdown 代替附件验证。跨项目及未登录访问应被拒绝。
- 在本地修改一个附件，旧报告提交必须失败；重新校验提交为新版本后，旧版本仍展示旧图片。通过真实用户界面核对，缺少管理会话则明确未执行。
- 缺失附件、越界引用、符号链接均明确报错；远程图片未归档列 warning；不内联执行 SVG/HTML。

## 停止边界

本轮在 submit 后停止：不 freeze、不申请或作出审核决定，不执行 Wiki compile、构建、发布或归类导出；不修改模板、项目绑定、已有 Wiki、历史提交或旧测试文件；不提交、推送 Git。遇到真实阻塞保留已完成成果并报告，不降低规则或伪造通过。
