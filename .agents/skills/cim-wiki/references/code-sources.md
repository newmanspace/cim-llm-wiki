# 项目代码数据源

代码源在项目建立和维护时写入项目 `repos`，与文档数据源分别维护。Skill 读取已配置源，不在对话中重新设定 Git/SVN 地址、子路径、分支或修订。统一配置边界与认证交互见[项目数据源执行约定](project-sources.md)。

## 读取与执行

以显式项目 ID 读取 `GET /api/v1/admin/projects/{project}/config`，使用该项目的 project-token；服务连接沿用 `ADMIN_URL`、`ADMIN_PROJECT_TOKEN`、`ADMIN_PROJECT_ID`。这些是服务 API 认证，不是 Git/SVN 账密，不能将 `CIM_WIKI_TOKEN` 当成 project-token。

读取 `repos` 中的 `name`、`type`、`url`、`subpath`、`revision_selector`、`enabled`、`config_revision` 和 `module_mapping`。缺项时回到项目设置补齐；停用源跳过。按配置在独立本地工作区获取或 checkout，不能在主项目或其他项目工作区误执行 fetch、switch 或 update。

Git 将配置的版本选择解析为完整 commit 后固定分析版本；SVN 将配置的选择解析为数字修订，并以相同 operative/peg revision 获取配置子路径。保留仓库、配置版本、实际 commit/revision 和文件路径证据，不执行仓库脚本、hooks、构建或依赖安装。

代码归属以项目 `module_mapping` 为依据，抽取仍遵守节点 Schema、代码契约与独立审核门禁。配置了数据源不代表已经采集或发布；代码只保留实现证据索引，不复制源码全文到知识页面。

文档采集器仅导出其文档白名单文件，不能用于声明完整代码采集。本地增量扫描工具需要已绑定的 Git 工作区；SVN 源按项目配置使用 SVN 客户端处理。
