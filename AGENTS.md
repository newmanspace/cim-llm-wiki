# 项目文档归属

维护本项目知识文档时，先阅读 [知识仓输出约定](docs/AGENTS.md)。docs 为指向同级 cim-llm-wiki-knowledge 仓库根目录的相对软链接。

- 产品文档按生命周期阶段编号结构输出到 docs/doc/，目录用途见 docs/doc/README.md。
- 代码契约统一输出到 docs/code/，包括 API、领域实体、可执行规则、物理数据结构和代码索引；doc 中通过链接引用其唯一正文。
- 知识仓是单产品库，根目录为 code 与 doc，不再增加产品名层级。
- 总体架构、技术选型与质量治理放在 docs/doc/20-architecture/，工程与文档规范放在 docs/doc/30-standards/。
- 工程技能中的 docs/development 等默认路径仅作通用骨架参考；本项目实际资料按上述产品目录归档。
- 代码仓的运行时 data/wiki 发布仍遵循服务 context 和严格节点契约。资料目录整理不自动修改运行时编译路径，不绕过来源、审核和发布检查。
