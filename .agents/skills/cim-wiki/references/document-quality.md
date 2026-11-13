# 文档结果、目录质量与审核

完成项目数据源采集后执行本流程；采集入口见[项目数据源执行约定](project-sources.md)。

## 1. 转换、内容归类及结果登记

按现有 convert/register → 核对 → freeze 流程登记原件与转换稿。按文档内容划分产品阶段目录或 code 契约目录，输出 UTF-8 Markdown 到共享 staging，保持标题、表格、条件和真实来源定位。图片使用服务转换得到的内嵌栅格数据；归类产物不允许原始 HTML 或未登记的外部图片，避免丢附件。

逐产物调用 artifacts：project、run_id、logical_key（该产物稳定业务标识）、target_path、content_uri、parsed_uri、recipe_version、source_links。source_links 为 [{source_version_id,location}]；content_sha256 可省略，由服务读取文件计算。target_path 相对于本项目归类根，例如 doc/50-designs/modules/example.md、code/apis/api-example.md，不能填写来源仓库路径。content_uri 指向共享候选文件，服务保存内容快照。

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
