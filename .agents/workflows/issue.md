---
description: 自动驱动线上缺陷与报错从立案登记到根因修复的全生命周期
---

# 缺陷修复 (Issue)

本工作流是处理项目中各类报错、数据异常与功能失效的主控引擎。当你需要对突发的 Bug 或阻断性报错采取措施时，触发此工作流。

## 目标与价值 (What it does)
它旨在将**"遇到 Bug 抄起键盘就改代码"的危险动作**，强行扭转为**"诊断、立案、复盘改进、最后修代码"的医疗级闭环**。
通过该引擎统一接管报错堆栈，系统会在后台按顺序全自动穿插诊断、生成 Issue Report、反哺规则、修改代码、执行测试等散落的节点，通过铁腕流程保障每次故障都能沉淀为系统的结构性免疫力。

## 智能运作链路
触发该工作流后，系统将依次自主推进以下工作区块：

1. **病例立案与 GitHub Issue 关联区块 (Diagnostic & Reporting)**
   - 调用 `github-issue` 技能：搜索是否已有对应 GitHub Issue；若未建案，则在脱敏校验后创建 GitHub Issue 并获取 Issue ID。
   - 调用 `issue-analysis` 技能：全面接管错误日志和异常现象，进行事故根因溯源，生成本地 `docs/development/issues/issue-xxx.md`。
   - 调用 `qa` 技能：审查新写出的 `issue-xxx.md` 病例报告，核验文件名小写化及脱敏合规性。
   - **[红线卡点：先立案后动刀]**：在修改哪怕一行业务代码之前，必须先完成脱敏立案与 GitHub Issue 编号挂接。

2. **系统免疫进化区块 (Mitigation)**
   - 分析事故报告中的规避措施，并**强制向 `.agents/RULES.md` 或相关技能追加防御性制约规则**，对同类错误防微杜渐。

3. **受控手术与审查区块 (Code & Review)**
   - 调用 `code` 技能：案宗敲定后，进入受限且受控的开发模式，对涉事业务代码及受影响逻辑进行修复修改。
   - 同步修正或新增该 Bug 复现的 TDD 测试用例，防备未来再次回归（Regression）。
   - 调用 `code-review` 技能：执行安全隐患、性能及二次破坏的白盒审计。
   - **[人工放行点]**：将修正后的代码、新增的防呆 Rule 及测试用例悉数汇总给你，等待你的明确 Approve。

4. **归核复健与闭环区块 (Test, Deploy & Close)**
   - 调用 `test` 技能：获得你的通过签名后，后台拉起测试框架执行 `pytest` 测试，确保修复动作未造成其他完好业务模块挂掉。
   - 调用 `git-commit` 技能：严格以规范格式提交并关联 GitHub Issue（如 `fix(orders): sync price and delivery timeout (#5)`）。
   - 调用部署脚本更新上线（`./update.sh`）。
   - 调用 `github-issue` 技能：向 GitHub Issue 提交解决复盘总结（附上 Commit hash 与验证结果），并将状态更新为 `closed`。
