// Rule Card v2: one independently meaningful rule, with evidence rather than method documentation.
export const ruleTemplate = {
  sections: ['Statement', 'Preconditions', 'Constraint', 'Violation', 'Related Operations', 'Test Hint'],
  tables: [],
  rows: {},
  content: {
    Statement: '格式示例：执行操作前，目标对象必须处于允许状态。实际文档完整描述一条独立规则，不拆解普通方法或工具函数。',
    Preconditions: '- 格式示例：入口已识别目标对象，并进入本规则的检查阶段。\n- 无生效前提时明确说明；未知前提标记“待确认”。',
    Constraint: '格式示例：目标对象的当前状态必须属于该操作的允许状态集合。实际填写校验对象、判断条件及约束表达式，状态和值域必须有依据。',
    Violation: '待确认：本例未绑定真实实现，拒绝行为、错误码及执行点需依据设计或固定版本代码核实，不推测。',
    'Related Operations': '格式示例未绑定项目业务动作；实际从 context.vocabulary.operation 选择受控动作。功能契约声明 rule_type: contract，并通过 applies_to 关联真实 API Card，归入 code/rules/；跨模块业务政策按 business_rule 归类。规则和接口关联使用带平面前缀的链接，不虚构关联目标。',
    'Test Hint': '- 正例：当前状态属于允许集合，规则通过。\n- 反例：当前状态不属于允许集合，规则不通过；具体处理以 Violation 确认结果为准。\n- 边界：目标状态缺失时的处理待确认。\n\n实际文档注明实现或待实现状态。已实现规则保留仓库、类、方法与固定版本证据；尚未实现的规则明确标记，不把设计当作代码现状。API Card 引用本规则，IDD 按需描述调用顺序，不重复接口字段和处理流程。',
  },
}
