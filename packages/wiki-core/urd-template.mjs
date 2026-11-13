const requirementSection = '4. 功能需求'
const acceptanceSection = '7. 验收标准'

export const urdTemplate = {
  sections: [
    '1. 背景与目标',
    '2. 需求范围',
    '3. 用户与业务场景',
    requirementSection,
    '5. 非功能需求',
    '6. 约束与待确认事项',
    acceptanceSection,
  ],
  tables: [
    {
      section: requirementSection,
      columns: ['需求编号', '所属模块', '需求名称', '需求描述', '优先级', '验收标准编号'],
      min_rows: 1,
      repeat: true,
    },
    {
      section: acceptanceSection,
      columns: ['验收标准编号', '需求编号', '验收场景', '通过条件'],
      min_rows: 1,
      repeat: false,
    },
    {
      section: '参考文档',
      columns: ['文档名称或链接', '参考用途'],
      min_rows: 0,
      repeat: false,
    },
  ],
  identifiers: [
    { section: requirementSection, column: '需求编号' },
    { section: acceptanceSection, column: '验收标准编号' },
  ],
  references: [
    {
      section: requirementSection,
      column: '验收标准编号',
      target_section: acceptanceSection,
      target_column: '验收标准编号',
    },
    {
      section: acceptanceSection,
      column: '需求编号',
      target_section: requirementSection,
      target_column: '需求编号',
    },
  ],
  content: {
    '1. 背景与目标': '说明业务背景、现有问题与预期目标。示例：减少人工核对需求与验收结果的遗漏。',
    '2. 需求范围': '说明本次包含与排除的内容及涉及模块。示例：包含需求登记模块；不包含技术架构、接口与数据库详细设计。',
    '3. 用户与业务场景': '说明使用角色、职责、业务场景与主要流程。示例：业务负责人登记需求，验收人员逐条核对通过条件。',
    '5. 非功能需求': '列明性能、安全、可用性要求及衡量方式。不适用项须说明原因。示例：需求数据仅允许已授权的项目成员访问。',
    '6. 约束与待确认事项': '列明外部依赖、限制与未决问题。示例：待确认需求优先级，由业务负责人在评审时确定；未决内容不得描述为已确认。',
    '参考文档': '无参考文档：本例为独立的模板验证样例。实际文档应列出真实参考材料；确无参考材料时说明原因。',
  },
  rows: {
    [requirementSection]: [
      ['REQ-001', '需求登记', '登记业务需求', '业务负责人可以在所属模块下登记需求，并关联可验证的验收标准。', '高', 'AC-001'],
    ],
    [acceptanceSection]: [
      ['AC-001', 'REQ-001', '业务负责人登记一条完整需求', '保存后可以查询到需求编号、模块、名称、描述、优先级及关联验收标准。'],
    ],
    '参考文档': [],
  },
}
