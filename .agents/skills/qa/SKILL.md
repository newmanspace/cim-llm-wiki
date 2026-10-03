---
name: qa
description: 负责所有系统及业务文档的合规性审查 (包含命名规范与结构排版)
---

# 质量保证审查 (QA)

本技能承担着项目的"文档安检系统"职责，专注于检查项目中所有的非代码文档（如 Markdown 规范文件、缺陷报告、设定集等）的命名规范、格式排版以及中英文语言配置，确保它们与全局红线完全对齐。

## QA 审查标尺 (Quality Assurance Checkpoints)

在面对已被修改或新生成的文档（尤其是 `docs/development/issues/` 和 `docs/development/features/` 下的增量文档）时，必须严格比对以下三条「文档红线」：

### 1. 命名规范查杀 (Naming Convention)
- 提取并检查文件的实体命名：除项目主入口文件（如 `README.md`、`SKILL.md`）外，所有常规业务和技术文档（如 `issue-xxx.md`, `summary.md`）的**前缀部分必须强制为小写**。
- 若后缀描述中包含特定的英文缩略词，则允许保留大写，但整体连接风格推荐 `kebab-case`。
- **🚨 违规示例**：`ISSUE-123.md`, `NewFeature-Api.md`
- **✅ 正确示例**：`issue-123.md`, `feature-01-dashboard.md`

### 2. 排版结构查杀 (Structural Layout)
- 定位文档所处的上游目录（例如存放于 `docs/development/issues/` 下），自动向上溯源，读取**该目录级别附带的 `README.md` 规范。**
- 核对目标文档的内部小节排版结构：绝不允许新文件**缺漏** `README.md` 里所宣贯的必填章节字段！例如：规范要求必须填写 "规避方案 (Mitigation)"，一旦没有填写即刻算作结构违规。

### 3. 语言规范界限 (Language Boundaries)
- 抽样阅读文档内部内容。当提及标识符、代码块演示片段、类名、方法名时，**必须保持纯英文输出**。
- 给终端或阅读者的行文主干及导语介绍等应当使用中文，不得出现杂乱无章的中英夹杂代码逻辑解释。

### 4. 研发流程与防呆闭环查杀 (Process Compliance)
- **先立案后动刀**：在任何纯业务代码（`.py`, `.sql`）引发审查时，QA 必须反查暂存区/伴随变更树中，是否存在针对性的 `issue-xxx.md` 或 `feature-xxx.md` 增量修改。如果发现"悄悄改代码而无案宗文档"的绕过行为，直接驳回。
- **规避落地必检**：如果是一次缺陷修复（Bug Fix），QA 必须核对本次代码变更中：是否有配套的对 `.agents/RULES.md` 的规则追加？或对 `.agents/workflows/` 的防御点强化？如果只有业务代码修改而毫无"制度免疫力升级"，按红线条例无情打回。

## Output

执行审查完成后，生成并展示一份标准的 QA Report（严格参照 **[qa-report-template.md](./assets/qa-report-template.md)**）。
- 命中哪怕一项排版或命名规范违规 → 标定为 ❌ **Blockers (打回重做)** 并给出修正指引。
- 全面守纪合格 → 授予 ✅ **Passed** 印章。
