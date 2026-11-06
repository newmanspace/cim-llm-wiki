# CodeQL 预期数据流复核

本文件记录正常功能产生的具体告警及信任边界，不能作为关闭整类查询或忽略新告警的配置。CodeQL 的 `security-extended` 查询保持启用；原生 High/Critical 阻断规则保持启用。

## Admin 引导同步：告警 3、4、5

位置：`scripts/register-admin.mjs` 的项目注册、令牌申请、Wiki 节点索引同步请求。该命令读取固定的 `data/documents/project-registry.json`，选择 `cim-llm-wiki` 项目配置，并将项目配置、项目标识和节点索引提交给操作员配置的 `ADMIN_URL`（默认本机 Admin 服务）。目标地址来自进程环境，不来自文档、HTTP 请求体或注册表文件。

这些字段本来就需要同步到 Admin；告警指出了存在“文件数据 → HTTP”的流向，没有证明存在超出该操作授权范围的文件泄露。这里没有按远程请求读取任意本地文件，也没有把 `.env`、会话密钥或源文件正文作为同步输入。按正常功能的预期数据流处置为 false positive。脚本申请的项目令牌仍须按其操作用途妥善保存，不能把本处复核理解为令牌可公开发布。

复核依据：固定的 `REGISTRY_FILE`、固定项目选择器、三个请求的 URL 构造与 body，及 `internal/handler/admin.go` 中对应接口的项目配置/令牌/节点契约。该脚本不在不可信文档转换请求中自动执行。

## 维护转换 CLI 落盘：告警 8

位置：`packages/wiki-tools/parse.mjs` 保存远端转换结果。输出目录来自本地操作员参数，文件 stem 来自本地输入名或显式文档名；解析响应只提供 Markdown 和图片内容，不提供输出路径。图片名称由本地逻辑编号，扩展名限制在固定集合。

将 Docling/MinerU/MarkItDown 的返回内容保存为中间 Markdown 和图片正是转换功能的契约。该内容作为数据写入，命令不执行或导入返回内容；登记状态为 draft，发布仍需走冻结和 Wiki 校验流程。按正常的中间文件写入处置为 false positive。

复核依据：`outputLayout`、`convertInput`、`embedImages`、`upsertDraft`；`packages/wiki-core/test/maintenance.test.mjs` 验证委托 HTTP 转换、图片保存、原件副本及冻结文件改动的拒绝行为。命令行目录参数属于本地操作员权限，不是远端解析响应可控制的值。

## 共享目录转换落盘：告警 15

位置：`packages/wiki-core/sources.mjs` 的 `writeSharedFile`，由知识服务转换接口保存中间 Markdown/图片。网络返回的内容必须保存到共享目录，才能由本地 Agent 抽取、评分和审核；这个数据流本身是设计要求。

输出 URI 必须属于服务端显式配置的共享根。服务端在异步转换前后检查路径，逐级以目录句柄和 `O_NOFOLLOW` 打开目录，并使用 `O_EXCL` 创建最终文件，拒绝覆盖、目录越界和符号链接逃逸。主文件必须是与原件不同的 `.md` 路径。操作要求 API 凭证，注册状态为 draft，记录原件 URI、真实路径、版本与哈希，后续发布继续校验来源和审核快照。

因此这里没有把网络内容当作路径、代码或未经审核的已发布页面使用；按有明确授权边界的中间数据保存处置为 false positive。复核依据：`resolveShared`、`writeSharedFile`、知识服务的 `prepareRegistration`/`convertSharedDocument`，以及 `shared-service.test.mjs` 的凭证、原件漂移、覆盖和符号链接回归测试。

## 适用边界

仅对以上具体告警、调用点和当前输入/目标控制方式完成复核。若以后允许请求指定上游地址、扩大本地文件读取范围、取消独占创建或共享根限制，须重新审查并恢复相应告警。覆盖率、复杂度及其他安全检查不因本文件而获得豁免。
