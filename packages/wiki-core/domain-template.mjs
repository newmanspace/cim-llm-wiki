// Domain Card v1: business semantics, not a DTO or physical table inventory.
export const domainTemplate = {
  sections: ['Description', 'Identity', 'State Machine', 'Attributes', 'Relations', 'Reasoning Hint', 'Invariants', 'Related Operations'],
  tables: [
    { section: 'State Machine', columns: ['from', 'trigger', 'to', 'guard'], min_rows: 0, repeat: false },
    { section: 'Attributes', columns: ['name', 'group', '值域/链接'], min_rows: 0, repeat: false },
  ],
  content: {
    Description: '格式示例：业务对象是相关规则的聚合入口。实际完整描述一个核心对象的业务含义与职责，不为每个 DTO、类或数据库表建卡。已实现内容依据固定版本代码核实，保留仓库、类、方法与版本证据；未知或未实现内容明确标记。',
    Identity: '待确认：本例未绑定真实对象。实际填写对象标识、辅助标识及唯一性范围，并引用对应 IDENTITY 规则，不推测主键或唯一范围。',
    'State Machine': '不涉及：本例仅展示无独立生命周期对象的格式，保留空状态迁移表。实际有状态机时填写 from、trigger、to、guard；完整迁移规则通过带 code/ 平面前缀的链接引用 Rule Spec，不复制规则正文。',
    Attributes: '只保留有业务意义的关键属性，Capability 类属性并入本表，group 使用 Capability。物理字段类型、长度和索引归 Schema Card；值域及规则通过带平面前缀的链接引用，不虚构关联目标。',
    Relations: '不涉及：本例未绑定真实关联对象。实际填写对象关系三元组，关系谓词从 context.vocabulary.relation 读取，关联对象通过带 code/ 平面前缀的链接引用。',
    'Reasoning Hint': '不涉及：本例没有可确认的动作检查链。实际按有依据的顺序列出“步骤、Rule Spec 链接、reject/warn”，不同动作分别说明；无检查链时保留章节并说明原因，不推测统一顺序。',
    Invariants: '待确认：本例未绑定真实对象不变量。实际仅写始终成立的约束摘要并链接对应 Rule Spec，规则完整定义独立维护。',
    'Related Operations': '不涉及：本例未绑定项目业务动作。实际从 context.vocabulary.operation 选择受控动作，接口与规则通过 related_apis、related_rules 等关联字段引用；不增加类图、方法清单或重复表结构。',
  },
  rows: {
    'State Machine': [],
    Attributes: [['对象标识（格式示例）', 'Identity', '实际值域与唯一性范围待确认']],
  },
}
