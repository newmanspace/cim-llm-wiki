# 文档目录路由与导出路径

新编／修订文档和 artifacts 登记共用同一套目录选择规则，模板和路径来自目标 Project，不在 Skill 中保存固定映射表。

## 目录选择与校验

1. 根据明确的 template_id 取得 Project 绑定模板的 node_type，不只按文件名、标题或 node_type 的首个模板推测。
2. 唯一目录类型规则为 context.document_defaults.definition.directories。context.document_directories 是台账视图，其 node_types 由绑定规则按路径派生，不能作为独立配置覆盖绑定定义。
3. 对给定 target_path，按路径段查找祖先规则，最近的非空 node_types 优先。空数组只作为容器，不授予任意类型，也不清除已有祖先规则；没有非空规则则不能登记。子目录更具体的非空规则不允许当前类型时，即使祖先允许也必须拒绝。
4. target_path 必须为安全的相对 Markdown 文件路径，保留 doc/ 或 code/ 平面；不得使用绝对路径、反斜线、空路径段、..、README.md 或越界路径。前缀必须按完整路径段匹配，不能把 doc/50-designs-other 当成 doc/50-designs。
5. 生成新路径时，在允许该类型的候选目录中选择。唯一候选可以直接采用；多个候选有明确的模块位置时据此选择，并对最终完整路径重新校验。多个不同分支且无法确定归属时返回候选并说明歧义，不能直接选择全局最深目录。无匹配时报告缺少映射，交由项目设置维护，不借其他目录或未知类型兜底。

例如所选模板为 sdd、node_type=design，且当前项目仅将 design 映射到 doc/50-designs，则 doc/50-designs/example.md 可用，doc/90-guides/example.md 必须拒绝。此例不作为其他项目的硬编码目录。

文档内容检查不能替代路径检查。完整正文完成后，调用 check-document 时同时提交 project、template_id、document、phase=draft、target_path，检查返回 errors。document_directory_mismatch 表示类型不允许进入该目录，document_directory_unmapped 表示没有适用的类型规则，document_target_invalid 表示路径非法；不能只以命令退出码判断通过。后续 artifacts 登记、复核及导出仍由服务端重验。

## 登记与输出位置

target_path 相对于 Project 归类根，登记后将该值视为唯一的目标相对路径，不根据正文再次分类。content_uri 可以指向 staging 候选文件，不需要与最终导出目录相同；staging 是输入快照位置，不能把它当成实际发布路径。

| 输出根的定义 | 最终位置 |
| --- | --- |
| 服务端 organized_root | organized_root/project/artifact.target_path，保留 doc/ 或 code/ |
| 本地根指向 Project 归类根 | project_output_root/artifact.target_path，同样保留平面前缀 |
| 本地 doc_output_root 已指向该 Project 的 doc 根 | 仅对 doc/ 路径移除开头 doc/ 后拼接 |
| 本地 code_output_root 已指向该 Project 的 code 根 | 仅对 code/ 路径移除开头 code/ 后拼接 |

输出根的语义不明确时先核实配置，不能总是去掉首段，也不能让 doc 路径写入 code 根。按路径段推导，拒绝越界、符号链接逃逸及与已有文件摘要不符的覆盖。服务端 publish-document 的实际导出结果以其响应和 publication 记录为准；本地副本不等于服务端已发布。

## 已有错误位置

不得直接改写已登记的 immutable artifact、审批结果或历史 publication。正确路径需要新 artifact 版本，并重新应用目标目录的质量策略、评估与审核，再导出。旧错误文件的清理须在核对摘要、替代版本和用户授权后执行，不在本流程自动移动或删除历史文件。
