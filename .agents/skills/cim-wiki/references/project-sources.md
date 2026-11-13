# 项目数据源执行约定

## 配置来源

项目建立和维护时已设定采集信息。Skill 读取绑定项目的当前配置并执行，不保存仓库清单，不提供另一套采集配置。

| 采集对象 | 配置来源 | 执行依据 |
|---|---|---|
| 文档 | `context --project <project-id>` 返回的 `data_sources` | 已启用源的 `id`、`config_id`、`type`、`url`、`subpath`、`revision_selector` |
| 代码 | 项目配置接口返回的 `repos`，见[代码源读取](code-sources.md) | 已启用源的类型、地址、子路径、版本选择和模块映射 |

项目未绑定、配置缺失或目标源停用时，报告具体缺项，由项目设置补齐后重新读取；不向用户收集一套临时地址、分支和路径继续执行。项目配置与用户本次任务范围不一致时，先说明差异，不静默覆盖配置。共享目录挂载是运行环境信息，不是仓库采集范围。

## 认证交互

正常采集复用本机已有认证，不重复询问账密。认证失败时先区分凭据失效、仓库权限、网络和证书问题，再协助处理对应问题。

- Git HTTPS：使用本机凭据助手。需要登录或更新凭据时，引导用户在可信客户端完成；不要要求把密码或 Token 发到对话中。
- Git SSH：使用本机 SSH key/agent 与 known_hosts；需要时协助解锁或加载已有密钥，私钥和口令不进入对话或服务端。首次主机身份确认由用户核对。
- SVN：使用本机已有凭据缓存；缓存缺失或过期时，由用户通过可信 SVN 客户端登录并更新缓存。采集脚本仍以非交互方式执行。

保持 TLS 与 SSH 主机校验，不通过关闭验证来解决认证失败。认证完成后重新读取项目配置，按原任务范围重试；不能把登录过程变成数据源配置过程，也不将 Git/SVN 凭据混作服务 API 令牌。

## 文档源执行

先取得项目 context，确认交付契约可读且 `document_quality.enabled` 为 true。按已配置源的 `type` 调用对应采集器；`source-id` 必须取自该项目返回值：

```bash
node "$SKILL/scripts/git-source.mjs" --project <project-id> --source-id <source-id> --shared-root <agent-visible-shared-root> --mount <server-shared-mount-name>
node "$SKILL/scripts/svn-source.mjs" --project <project-id> --source-id <source-id> --shared-root <agent-visible-shared-root> --mount <server-shared-mount-name>
```

只运行与选中源类型对应的一条命令。脚本使用 `CIM_WIKI_URL`、`CIM_WIKI_TOKEN` 读取配置及登记结果，命令不接收仓库地址、分支、子路径或账密覆盖参数。安装端需要 Node.js 和对应 Git/SVN 客户端。

采集器将项目配置中的版本选择解析为固定 Git commit 或 SVN revision，保存原件快照、哈希与版本证据并登记来源。Git 从对象读取文件，SVN 按固定 operative/peg revision 导出；文档快照不需要工作区 checkout。代码工作区 checkout 同样以项目配置为依据。

现有文档采集器每批最多 500 文件、100MiB，按文档格式白名单读取；Git 拒绝子模块、符号链接和 LFS 指针，不执行 hooks 或过滤器。不要放宽采集器限制或把文档导出冒称完整代码快照。

保留输出的 `run_id`、`source_version_id`、`source_uri` 和版本证据用于后续处理；原件放在共享目录，不放在 Skill 安装目录。同版本复用时以服务返回的 `original_uri` 为准；产物登记返回已有版本时，后续使用其 `parsed_uri`。结束时通过 `ingest-runs` 将批次标记为实际的 completed/partial/failed/cancelled，未完成转换不能记录为 completed。失败批次保留记录，不覆盖历史。具体转换、归类、评分、审核及恢复见[文档结果处理](document-quality.md)。
