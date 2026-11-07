# 产品目录与现有流水线

本期复用现有 project 命名空间，增加标准目录初始化、目录配置维护和 Wiki 导航映射。没有新增 Workspace 表、继承机制、独立产品管理界面或基线功能。

## 1. 初始化产品目录

继续使用现有服务地址和令牌环境变量 `CIM_WIKI_URL`、`CIM_WIKI_TOKEN`。人工审核另使用独立的 `CIM_WIKI_REVIEW_TOKEN`。不要将真实令牌写入请求文件。

在请求文件 `initialize-product.json` 中填写：

```json
{
  "project": "mycim-spc",
  "name": "myCIM SPC",
  "version": "4.0",
  "modules": ["control-chart", "rule-engine"],
  "delivery_contract": {
    "schema_version": "1.0",
    "project": "mycim-spc",
    "modules": ["control-chart", "rule-engine"],
    "documents": [
      {
        "id": "requirements",
        "type": "requirement",
        "scope": "module",
        "min": 1
      }
    ]
  }
}
```

这只是格式示例，交付契约必须根据真实产品要求配置，不能为了跑通而将必交数量改成零。已有命名空间必须使用原有契约，接口拒绝覆盖不同契约。已有目录也不会被重复初始化覆盖。

在仓库根目录执行：

```bash
node .agents/skills/cim-wiki/scripts/client.mjs initialize --json-file initialize-product.json
node .agents/skills/cim-wiki/scripts/client.mjs context --project mycim-spc
node .agents/skills/cim-wiki/scripts/client.mjs directories --project mycim-spc
```

初始化生成：

- `data/wiki/mycim-spc/directory.json`：产品显示名称、当前文档版本、目录顺序和映射规则。
- `data/wiki/mycim-spc/document-contract.json`：用户明确提供的必交文档契约；已有相同内容时原位保留。
- `data/wiki/mycim-spc/catalog/*.md`：每个目录的生成首页，包含用途、子目录和返回入口。

标准显示树来自 [产品目录模板](templates/product-documentation/README.md)。实际版本替换 version-template，实际模块替换 module-template，不创建占位功能。运行时模板位于 `contracts/wiki/v1/product-directory-template.json`，随已有 contracts 目录进入服务镜像。

catalog 采用扁平生成路径，虚拟目录层次由配置决定，例如 `product-versions/4.0/documentation` 对应 `catalog/product-versions__4.0__documentation.md`。这样根 Templates 仍可在导航展示，同时不会被现有 VitePress 的模板文件排除规则误排除。目录首页相当于 Web Wiki 中的目录 README；源模板中的 README 保留完整维护说明。

## 2. 沿用摄取、审核和编译

按 [共享目录工作流](shared-directory-workflow.md) 继续执行 convert/register、state、submit、review、compile 和 validate。

```bash
node .agents/skills/cim-wiki/scripts/client.mjs validate
```

初始化后还没有业务节点时，必交文档数量校验会失败，这是预期行为。目录首页不计入知识节点，也不能替代需求、设计、接口或测试文档。真实来源、评分、人工审核和文档结构检查仍生效。

编译页面继续放在 `doc/` 和 `code/` 的既有类型目录中，不因导航改名而搬动。Wiki 导航按目录的 match 匹配已编译页面，未匹配页面仍可从原有双平面入口找到。

## 3. 维护目录

先读取当前配置：

```bash
node .agents/skills/cim-wiki/scripts/client.mjs directories --project mycim-spc > directory-current.json
```

编辑请求文件 `update-directories.json`，使用刚读取的 revision，提交完整目录清单。例如以下是一个缩小后的自定义目录示例，会替换整个展示目录树，实际使用时应保留需要的原有条目：

```json
{
  "project": "mycim-spc",
  "expected_revision": 1,
  "directories": [
    {
      "path": "engineering",
      "title": "Engineering Documentation",
      "description": "Internal engineering documentation."
    },
    {
      "path": "engineering/requirements",
      "title": "Requirements",
      "description": "Approved requirements for control charts.",
      "match": {
        "types": ["requirement"],
        "version": "4.0",
        "module": "control-chart"
      }
    }
  ]
}
```

```bash
node .agents/skills/cim-wiki/scripts/client.mjs update-directories --json-file update-directories.json
```

- 数组顺序控制同级目录顺序；path 表达父子关系，必须同时声明父目录。
- title 是可含空格的英文显示名；description 是纯文本用途说明，不允许 HTML/Vue 或自由 Markdown 页面。
- path 使用小写字母、数字、连字符，版本段可包含点；禁止穿越和符号链接。
- match.types 匹配已存在的节点类型；version 和 module 可选，填写时为精确匹配，注意大小写。
- 409 表示配置已更新或已有目录／契约冲突；重新读取并处理，不盲目重试覆盖。
- 修改目录会重新生成首页，但不会修改审核结果或移动、删除任何知识节点。
- 产品名称和初始化版本暂不提供编辑 API；本期以一个命名空间的目录展示为主，不提供完整多版本管理。需要展示多个版本时可以在目录配置中增加版本分支与准确 match 条件。

不要手工修改 catalog 页面，校验会将其识别为漂移。删除、隐藏或移动展示目录请修改 directory 配置；现有编译内容仍保留在双平面入口。

## 4. 更新 Wiki 展示

现有 Wiki 构建仍先运行严格校验，再生成导航：

```bash
npm --prefix wiki run docs:build
```

构建前必须已满足当前命名空间的必交契约，并配置服务端可读取的共享根 `CIM_WIKI_SHARED_ROOTS`。生产容器内的静态站点不会因为本地编辑自动更新，需走原有构建部署流程；本次没有执行部署。

## 5. 验证证据

自动化测试在临时目录和临时 HTTP 服务中验证初始化、配置修改、冲突处理、人工审核、编译、严格校验、导航和 VitePress HTML 构建，不会写入真实产品资料。

转换使用确定的测试解析器，审核使用独立测试身份；这证明程序链路工作，不代表任何真实业务文档已抽取、审核或发布。
