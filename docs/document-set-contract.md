# 项目文档集契约

每个项目必须在知识仓声明 `data/wiki/<project>/document-contract.json`。含 `doc/`、`code/` 或契约文件的项目目录，以及本地 Project Registry 登记的项目，均纳入检查；已登记的空项目也不能省略。历史 Go 服务留下的空分类目录不当作项目。契约缺失、JSON 损坏、重复键、未知版本或错误规则均阻断发布。

文档集契约与单篇节点 Schema、模板契约同时生效。现有项目没有宽松模式，不会根据当前文档自动生成交付标准。交付数量和模块清单应来自项目要求，否则容易把当前缺失的文档排除在检查之外。

## 配置示例

完整示例见 [MES 文档集契约](../contracts/wiki/examples/mes-document-contract.json)，机器 Schema 见 [document-set.schema.json](../contracts/wiki/v1/document-set.schema.json)。将示例复制到项目目录后，必须修改 `project`、`modules`、文档规则及关联要求，使其符合真实项目范围。

最小的有效契约如下，要求项目至少发布一份需求文档，并要求该文档具有需求与验收章节：

```json
{
  "schema_version": "1.0",
  "project": "example",
  "documents": [
    {
      "id": "requirements",
      "type": "requirement",
      "scope": "project",
      "min": 1,
      "structure": {
        "requiredSections": ["## Requirement", "## Acceptance Criteria"]
      }
    }
  ]
}
```

## 字段含义

| 字段 | 含义 |
|---|---|
| `schema_version` | 必填，当前为字符串 `"1.0"` |
| `project` | 必填，必须与项目目录名一致 |
| `modules` | 项目模块清单；按模块校验时必填且非空。显式声明非空清单后，已发布文档不得使用清单外模块 |
| `allow_unlisted` | 默认 `true`，允许交付清单外的其他有效节点；设为 `false` 后，所有已发布文档必须至少匹配一条规则 |
| `documents` | 必填、非空的交付规则列表 |

每条交付规则支持：

| 字段 | 含义 |
|---|---|
| `id` | 必填，项目内唯一的规则 ID，供关联要求引用 |
| `type` | 必填，已登记节点类型，例如 `frd`、`design`、`api`、`test_case` |
| `scope` | 必填，`project` 为项目总量，`module` 为每个适用模块分别计数 |
| `min` / `max` | `min` 必填；`max` 可省略。均为非负整数，`min: 0` 可表示选配；`max: 0` 可禁止匹配文档 |
| `modules` | 仅适用于模块规则，指定项目模块清单的非空子集；省略时覆盖所有声明模块 |
| `where` | 附加元数据筛选，支持 `api_type`、`rule_type`、`domain`、`version`、`plane`，按精确值匹配 |
| `template` | 写作模板文件名；按项目 `templates/`、全局 `templates/`、内置模板顺序检查存在性 |
| `structure` | 对匹配文档追加 `requiredSections` 和 `tables` 结构约束 |
| `references` | 对每份匹配文档要求指定字段关联到目标交付规则中的文档 |

`template` 指定写作骨架，其存在性会检查，但不会自动把模板的任意标题变成必填项；需要强制的结构应在统一类型契约或 `structure` 中声明。现有基础章节不会被项目规则取消。

## 数量、结构与关联语义

- 只统计 `status: published` 的页面；归档页、草稿以及其他项目的页面不能补足数量。
- 模块来自显式清单，未出现任何文档的模块同样检查，避免从已有页面反推模块导致漏检。
- 多条规则可匹配同一文档，各自独立检查。例如同时要求“接口总量不少于 5”和“外部集成接口不少于 2”。
- 结构规则使用现有 Markdown 语法树校验，不能用代码块或注释伪造章节。声明表格会同时要求对应章节、必填列及数据行。
- `references` 的 `field` 为节点中的关联字段，例如 `related_apis`；`target_rule` 指向本项目交付规则 ID；`min` 要求不同目标文档的数量。`same_module: true` 要求源和目标模块一致。
- 只有对应元数据字段中的有效 Wiki 链接计入关联数量；正文提及不算。目标必须已发布、匹配目标规则，并满足原有目标类型约束。重复链接不会重复计数。

例如 FRD 可以要求至少关联一个同模块接口和一个同模块测试用例。单纯存在接口和测试用例还不够，FRD 必须显式建立关联。

## 执行与生效范围

```bash
npm run wiki:validate
npm run wiki:validate -- --json
npm run wiki:compile -- <bundle_id或nodes.json> --preview
```

旧校验命令、候选编译、导航生成、VitePress 构建及 GitOps 提交共用该检查。缺少交付文档、超出数量上限或缺少必需引用时，不更新正式页面和索引。

契约保存在独立知识仓，可随项目版本管理。本次新增能力未为现有项目自动填写或放宽交付标准，现有项目需配置后才能重新发布。对于尚在分批生成中的文档集，也必须先在候选树中满足所声明的最低交付要求，或按真实阶段维护项目契约；没有跳过门禁的编译开关。

## 错误分类

| 错误码 | 含义 |
|---|---|
| `document_contract_missing` | 项目缺少契约 |
| `document_contract_error` | 配置格式、项目、模块、规则或模板不合法 |
| `document_count` | 文档数量不符合上下限 |
| `document_unlisted` | 严格清单模式下出现未列入规则的文档 |
| `document_module_unknown` | 文档模块不在项目声明范围 |
| `document_structure` | 未满足交付规则的附加正文结构 |
| `document_reference` | 未达到必需关联数量 |
