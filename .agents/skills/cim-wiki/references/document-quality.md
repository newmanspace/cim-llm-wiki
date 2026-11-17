# 文档结果、目录质量与审核

完成项目数据源采集后执行本流程；采集入口见[项目数据源执行约定](project-sources.md)。转换测试按 [Skill 的交付与完成条件](../SKILL.md#转换测试的交付与完成条件)生成并检查 Wiki 候选文档，停止在下述 artifacts 登记之前；仅解析模式不执行候选整理。完整摄取流程继续执行定稿、产物登记、评估与审核。

## 1. 转换、内容归类及结果登记

convert/register 返回的是引擎解析稿，不是最终文档。核对原件与解析稿后，先按[类型判定规则](document-classification.md)识别实际类型；有专门模板时按模板整理，无专门模板时仅规范通用格式，再选择目标目录，输出 UTF-8 Markdown 候选到独立 staging，保持标题、表格、条件和真实来源定位。专门模板候选以完整正文和 target_path 调用 check-document；通用标准格式候选执行通用格式及保真检查，不借用模板或虚构 template_id。图片使用服务转换得到的内嵌栅格数据；归类产物不允许原始 HTML 或未登记的外部图片，避免丢附件。

完整摄取时，原件与解析稿仍按 convert/register → 核对 → freeze 流程定稿；测试模式保持 draft，不进入后续登记、评估和发布。

正文、参考文档与独立检查报告按 [Skill 的内容边界](../SKILL.md#转换文档的正文与说明边界)分别编写。真实来源定位集中放在参考文档及机器来源记录中，保真分析、转换问题和检查诊断不写入业务正文。

以下 artifacts 登记要求真实 template_id；仅适用于已匹配专门模板的产物。通用标准格式文档若没有服务支持的登记类型，保留本地候选并报告该限制，不为继续登记而改写文档类型。

逐产物调用 artifacts：project、run_id、logical_key（该产物稳定业务标识）、template_id、target_path、content_uri、parsed_uri、recipe_version、source_links。source_links 为 [{source_version_id,location}]；content_sha256 可省略，由服务读取文件计算。target_path 相对于本项目归类根，例如 doc/50-designs/modules/example.md、code/apis/api-example.md，不能填写来源仓库路径。content_uri 指向共享候选文件，服务保存内容快照。

登记前按[目录路由规则](document-routing.md)核对 template_id 对应的 node_type 与目标路径最近的非空目录规则。类型规则来自 context.document_defaults.definition.directories，不能由 document_directories 的名称或文件名猜测；子目录非空规则优先，空数组仅为容器。无匹配或类型不允许进入该目录时停止登记，多候选生成路径无法确定时报告歧义。可将完整正文与 target_path 一起提交 check-document 提前检查，服务登记、复核和导出仍强制重验。

## 2. 文档七维质量

调用 list-quality-policy-effective --project ID --path <产物所在目标目录>，读取 review_threshold、dimensions、origins 和 digest。未覆盖项继承父级；文件仅继承所在目录，不设置文件级例外。

文档质量维度是 fidelity/completeness/traceability/consistency/structure/usability/validity，各0–100；默认权重0.20/0.20/0.15/0.15/0.10/0.10/0.10，默认低分线80。量表锚点：0无法证明或关键失真；25严重缺失；50部分可用；75主要满足但有小缺项；100已对照来源且满足用途。读取当次 rubric，不用固定默认值覆盖目录策略。无法确认的分数填 null，附原因，不编造证据。

调用 document-evaluations，输入 project、artifact_id、artifact_sha256、policy_digest、evaluator_version、dimensions 和 issues。dimensions 每项 {score,evidence,reason}；issues 每项 {origin:source|conversion,code,severity:blocking|warning,description,location}。服务复算总分。来源丢失或哈希变化、关键事实错误、重要遗漏不能用平均分抵消。

这套量表与节点 qscore 的0–1七维评分分别记录，不能字段替换或直接除100映射。节点仍按 extraction/evaluation 文档生成。

## 3. 审核、归类写入及运行时发布

提交评估后查询 document-review-tasks 和 document-review-events。七维评分、证据与理由完整，未舍入总分达到目录 review_threshold，且无阻断问题、require_human=false 时，服务自动创建 approved 任务（approval_mode=auto）和 system:quality-policy 的 approve 事件；记录分数、阈值及策略/产物摘要，不使用人工审核令牌。其他情况创建 pending 任务并向用户展示原件、转换稿、归类文件、评分依据和历史。低分人工审核须有意见；阻断问题须修复后重新评估，不能直接批准。

人工端使用独立 CIM_WIKI_REVIEW_TOKEN 调用 document-review-decisions，输入 project、task_id、expected_revision、decision=approve/reject/changes_requested、note。审核身份从凭据绑定，Agent 不持有审核令牌。管理页面也提供原件下载、正文对照和历史。修订生成新版本，历史不覆盖。

系统自动批准或独立人工审核通过后，Skill 可调用 publish-document，输入 project、artifact_id、evaluation_id，服务写入 CIM_WIKI_ORGANIZED_ROOT/<project>/<target_path>。替换已存在且内容不同的文件须附 expected_sha256；先查询实际当前文件摘要，再按用户授权更新。归类导出是资料文件写入，运行时 Wiki 仍必须走现有 Bundle、节点审核、compile preview 和全库校验。

项目配置了数据源后，submit 请求除 uri 还必须附 artifact_ids，每个节点来源必须有匹配归类产物。服务将文档评估关联到 Bundle，编译时再次核验当前目录策略、来源哈希及有效审批结论。父目录规则或文件变化会使自动或人工批准资格失效，须重新评估，不能复用旧批准。新规则不追溯改写旧任务；对旧待审结果重新提交真实评估，旧 pending 任务会保留历史并被 superseded。文档自动批准不代表节点 Bundle 自动批准，运行时 Wiki 的节点审核配置保持独立。

## 4. 查询、重试与恢复

客户端支持 list-data-sources/list-source-revisions/list-ingest-runs/list-source-observations/list-document-results/list-quality-policies/list-document-evaluations/list-quality-issues/list-document-review-tasks/list-document-review-events/list-publications，以及对应写命令。查询使用 --project，按需 --cursor/--limit/--status/--path；写操作 --json-file，客户端根据命令和输入内容生成幂等键。同键异体409，不重试绕过状态冲突。

数据库不可用时停止写入。写文件成功但完成记录失败时保留 publishing 状态；恢复服务后以相同原始请求重试，让服务核对文件摘要并完成落表。发布中不得修改评分策略；不要手工把审核或发布状态改为成功。发生非正常进程中断时由运维先核对服务锁、原件与候选/目标文件后恢复，历史记录保留。
