# 产品文档标准目录

本目录是产品文档的可复制静态模板，面向产品负责人、架构、研发、测试、实施和运维人员。它将产品公共资料、按版本维护的完整文档、发布基线及关联项目分开组织。每个目录均有 README 说明用途、内容范围和维护边界。

## 使用方法

1. 将本目录的内容复制到实际产品资料根目录，补充产品名称、编号、负责人和入口说明。
2. 将 `product-versions/version-template` 复制为真实版本目录，例如 `product-versions/4.0`；模板中的版本状态、日期和发布信息均需据实填写。
3. 将用户帮助和工程文档中的 `module-template` 替换为真实模块路径；将 `feature-template` 替换为真实功能路径，并为两侧建立相同模块和功能标识。
4. 按各目录 README 放入资料；当前没有内容的可选目录可以暂不实例化。较小内容可直接补充 README，较大内容拆页后在 README 中维护索引。
5. 发布或交付时记录准确的软件制品、文档修订和基线；客户项目维护自身差异资料，并关联产品版本和采用的基线。

显示名称使用正常英文（如 Product Versions），实际路径统一小写 kebab-case（如 `product-versions`）。版本目录使用真实版本号，不将 Draft、Released 等状态拼入路径。不另建一份 Latest 内容副本。

## 功能现状与使用限制

本目录提供静态目录与 README 模板；轻量服务已支持将它转换为目录配置、生成首页并接入现有流水线，详见 [使用说明](../../product-directory-workflow.md)。不包含独立产品管理界面、版本切换平台、权限隔离、自动基线、链接重定向或项目关系汇总实现。它也不是现有 `data/wiki/templates/manifest.json` 注册的运行时文档模板。

当前 Wiki 发布采用 `contracts/wiki/v1/` 定义的严格双平面目录、Frontmatter 和文档集契约。本目录位于工程文档区，不能直接复制到 `data/wiki/` 后视为可发布知识库；现有轻量接入使用独立目录配置和严格生成页校验，不改变原知识节点契约。

## 顶级入口

- [Overview](overview/README.md)：产品身份与长期维护信息。
- [Product Management](product-management/README.md)：管理产品方向、需求储备及研发规划。
- [Pre-sales](pre-sales/README.md)：复用产品通用售前材料。
- [Architecture and Governance](architecture-and-governance/README.md)：集中维护跨版本架构原则、工程规范和质量流程。
- [Product Versions](product-versions/README.md)：组织各产品版本及其完整文档。
- [Templates](templates/README.md)：在产品根集中提供可复用的空白文档骨架。

## 完整结构

以下列出文件夹；每个文件夹均包含 `README.md`。`version-template`、`module-template` 和 `feature-template` 是实例化占位，不是实际版本、模块或功能。

```text
product-documentation/
├── overview/
├── product-management/
│   ├── product-strategy/
│   ├── roadmap/
│   ├── feature-backlog/
│   └── product-development-plans/
├── pre-sales/
│   ├── product-presentations/
│   ├── solutions-and-proposals/
│   ├── demonstrations/
│   ├── product-comparisons/
│   └── sizing-guidelines/
├── architecture-and-governance/
│   ├── architecture-principles/
│   ├── engineering-standards/
│   │   ├── development-standards/
│   │   ├── customization-standards/
│   │   ├── integration-and-api-standards/
│   │   ├── database-standards/
│   │   ├── ui-standards/
│   │   ├── security-standards/
│   │   └── documentation-standards/
│   └── quality-management/
├── product-versions/
│   └── version-template/
│       ├── overview/
│       │   ├── version-summary/
│       │   ├── feature-scope/
│       │   ├── compatibility-matrix/
│       │   └── known-issues-and-limitations/
│       ├── documentation/
│       │   ├── getting-started/
│       │   ├── application-help/
│       │   │   ├── common-functions/
│       │   │   └── module-template/
│       │   ├── implementation/
│       │   │   ├── installation-guide/
│       │   │   ├── configuration-guide/
│       │   │   ├── data-migration-guide/
│       │   │   └── go-live-checklist/
│       │   ├── administration-and-operations/
│       │   │   ├── system-administration-guide/
│       │   │   ├── monitoring-and-alerting/
│       │   │   ├── backup-and-recovery/
│       │   │   ├── data-retention-and-cleanup/
│       │   │   ├── troubleshooting/
│       │   │   └── runbooks/
│       │   ├── integration-and-extension/
│       │   │   ├── integration-guide/
│       │   │   ├── api-reference/
│       │   │   └── extension-guide/
│       │   ├── security-guide/
│       │   ├── upgrade/
│       │   │   ├── upgrade-guide/
│       │   │   └── rollback-guide/
│       │   └── training/
│       │       ├── training-materials/
│       │       ├── exercises/
│       │       └── assessments/
│       ├── engineering-documentation/
│       │   ├── system-architecture/
│       │   │   ├── architecture-overview/
│       │   │   ├── module-boundaries-and-dependencies/
│       │   │   ├── deployment-architecture/
│       │   │   └── architecture-decisions/
│       │   ├── shared-design/
│       │   │   ├── common-services/
│       │   │   ├── shared-data-model/
│       │   │   └── cross-module-interfaces/
│       │   ├── modules/
│       │   │   └── module-template/
│       │   │       ├── overview/
│       │   │       └── features/
│       │   │           └── feature-template/
│       │   └── verification-and-validation/
│       │       ├── test-strategy-and-plans/
│       │       ├── integration-testing/
│       │       ├── system-testing/
│       │       ├── performance-testing/
│       │       ├── security-testing/
│       │       └── validation-summary/
│       ├── release-and-delivery/
│       │   ├── release-notes/
│       │   ├── release-manifest/
│       │   ├── deliverable-catalog/
│       │   └── release-approval/
│       ├── document-baselines/
│       └── related-projects/
└── templates/
    ├── requirements/
    ├── design/
    ├── testing/
    ├── release-and-delivery/
    └── project-management/
```

## 内容归属与维护规则

- 公共治理：Architecture and Governance 维护架构原则、工程规范及现有质量管控材料；不重复建立 Templates 子目录。Documentation Standards 链接产品根 Templates，流程表单随 Quality Management 材料维护。
- 版本工程：Engineering Documentation 维护本版本实际架构、共用设计、模块功能和验证证据；功能页面串联需求、设计、测试，并关联 Application Help。
- 正式手册：Documentation 面向使用和实施任务；Application Help 是用户手册正文来源，导出手册时复用该内容。
- 版本完整性：每个版本展示完整适用文档，不只是本次增量。未变页面可在后续系统实现中复用确定修订，不能引用可变的最新版导致历史漂移。
- 文档修订：软件版本与文档修订分别管理；同一软件版本允许批准文档纠错，已冻结基线保留原目录、页面、附件与公共规范修订。当前正式文档入口与具体交付基线需要明确区分。
- 跨版本规范：公共规范持续更新；每个发布或交付基线记录采用的规范标识和修订，不依赖只指向最新规范的链接。
- 交付制品：安装包、数据库归档和大型视频保存在制品或附件存储，清单记录确定版本、链接和校验信息。正式交付清单引用文档，不重复存正文。
- 项目归属：客户需求、定制设计、实际配置、进度会议、签收验收及培训成绩归项目；Related Projects 只维护项目、版本、基线及历史关系。
- 内容权限：Engineering Documentation 默认面向内部，培训答案、安全问题细节等内容需受控；目录存在不等于已经实施访问控制。

## README 与模板的区别

各目录 README 是目录说明和内容索引，不是完成的业务文档或批准证据。根 Templates 子目录列明各类空白模板应包含的字段，后续可以补充具体模板文件；不要将这些说明登记为已完成的需求、设计、测试报告或发布记录。

## 设计依据

- 当前会话确认的产品、版本、模块、规范、质量流程与根 Templates 组织约定。
- 用户提供的 myCIM SPC Project 目录，以及 [SPC 资料站点](http://10.243.145.82:8088/)：用于识别现有材料类型，不代表所有正文都已读取或适合直接转为产品标准。
- [SAP S/4HANA Help Portal](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE)：借鉴产品版本上下文及面向用途的指南分类。
- [Oracle EBS Documentation Library](https://docs.oracle.com/cd/E26401_01/index.htm)：借鉴发行版文档库、模块与用户／实施／技术指南组织。

上述公开门户用于参考文档发布与阅读方式；本模板的内部工程与治理目录是结合团队情况形成的组织约定，不声称复刻 SAP 或 Oracle 的内部研发档案结构。
