# 项目文档归属

维护本项目知识文档时，先阅读 [知识仓输出约定](docs/AGENTS.md)。docs 为指向同级 cim-llm-wiki-knowledge 仓库根目录的相对软链接。

- 产品文档按生命周期阶段编号结构输出到 docs/doc/，目录用途见 docs/doc/README.md。
- 代码契约统一输出到 docs/code/，包括 API、领域实体、可执行规则、物理数据结构和代码索引；doc 中通过链接引用其唯一正文。
- 知识仓是单产品库，根目录为 code 与 doc，不再增加产品名层级。
- 总体架构、技术选型与质量治理放在 docs/doc/20-architecture/，工程与文档规范放在 docs/doc/30-standards/。
- 工程技能中的 docs/development 等默认路径仅作通用骨架参考；本项目实际资料按上述产品目录归档。
- 代码仓的运行时 data/wiki 发布仍遵循服务 context 和严格节点契约。资料目录整理不自动修改运行时编译路径，不绕过来源、审核和发布检查。

# AI 开发与编码规范

- 开发前读取 [AI 开发规范](docs/doc/30-standards/ai-development-standard.md)；新增及修改代码遵守 [Coding Standard](docs/doc/30-standards/coding-standard.md)，验证遵守 [Testing Standard](docs/doc/30-standards/testing-standard.md)。
- 先定位现有实现、调用方和契约，再修改相关范围；常规取舍直接落实，不强制每项任务创建完整需求／设计文档或重复审批。
- 接口、规则、对象及物理结构的唯一正文仍归入 docs/code/，文档与实现互相核对，不复制源码全文或推测实现事实。
- 用户明确不做兼容时，不新增旧字段别名、双读双写、旧模板／路径兜底或静默转换。
- 按改动风险选择有意义的验证，如实区分未执行、通过、失败和跳过；不得通过删除断言、降低门限或扩大忽略范围制造通过。
- 修改资料或代码不自动提交、推送、部署、发布全局规则或升级项目绑定，分别按已有授权执行。
