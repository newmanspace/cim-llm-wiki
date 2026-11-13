const columns = ['List', 'Function Agreement', 'Message template', 'Return Code', 'Return Message', 'Result', 'Comment']
const phases = [
  ['2. 公共条件检查（Check Common Conditions）',
    '校验入参和调用权限；具体规则引用对应 Rule Spec。',
    'EXAMPLE_DENIED', '示例：调用方无权执行本入口。',
    '不满足时结束入口并返回错误；满足时进入下一阶段。'],
  ['3. 执行前准备（Before Execute Transaction）',
    '按明确的顺序获取资源锁，并说明事务开始的位置。', '', '',
    '准备成功后继续；失败时释放已获取资源并按约定结束入口。'],
  ['4. 业务条件检查（Check Conditions）',
    '按顺序调用业务检查；引用规则编号，区分跳过当前检查和结束整个入口。', '', '',
    '全部必要检查通过后执行后续操作；失败结果引用对应规则。'],
  ['5. 事务执行（Execute Transaction）',
    '按顺序编排更新和依赖调用，说明提交及失败回滚的边界。', '', '',
    '成功提交后进入后处理；失败时按实际事务边界回滚或恢复。'],
  ['6. 执行后处理（After Execute Transaction）',
    '释放本入口持有的资源，执行必要的后续处理。', '', '',
    '明确成功和异常路径的收尾方式，以及后处理失败时的实际结果。'],
]

export const iddTemplate = {
  usage: 'supplementary',
  sections: ['1. API 入口', ...phases.map(([title]) => title)],
  tables: [
    { section: '1. API 入口', columns: ['项目', '内容'], min_rows: 4, repeat: false },
    ...phases.map(([section]) => ({
      section,
      columns,
      optional_columns: ['Message template', 'Return Code', 'Return Message', 'Result', 'Comment'],
      min_rows: 1,
      repeat: false,
    })),
  ],
  identifiers: phases.map(([section]) => ({ section, column: 'List' })),
  content: {
    '1. API 入口': 'IDD 为可选补充文档，一份描述一个最上层后端 API／Tx 入口。仅补充入口级处理顺序和规则调用；已有接口字段及 Rule Spec 通过引用维护，不重复正文。以下为格式示例，实际文档使用真实入口、规则和返回信息。',
    ...Object.fromEntries(phases.map(([title]) => [title,
      '按实际执行顺序逐项填写。不涉及本阶段时，在 Function Agreement 中说明原因，Result 中说明如何进入下一阶段。',
    ])),
  },
  rows: {
    '1. API 入口': [
      ['入口标识', 'POST /example/actions（格式示例，替换为真实路由或 TxID）'],
      ['功能说明', '说明顶层后端入口的职责和处理范围。'],
      ['关联 SDD', '填写对应文档及功能编号；没有关联材料时说明原因。'],
      ['契约引用', '引用接口契约和已有 Rule Spec 的唯一正文。'],
    ],
    ...Object.fromEntries(phases.map(([title, agreement, code, message, result]) =>
      [title, [['1', agreement, '', code, message, result, '']]],
    )),
  },
}
