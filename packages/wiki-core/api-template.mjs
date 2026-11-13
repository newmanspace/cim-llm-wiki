// API Card v1: extracted from a fixed code revision, not a second design document.
export const apiTemplate = {
  sections: ['Purpose', 'Preconditions', 'Request', 'Effects', 'Errors', 'Related Scenarios'],
  tables: [
    { section: 'Request', columns: ['param', '语义', '值约束'], min_rows: 0, repeat: false },
    { section: 'Effects', columns: ['subject', 'change'], min_rows: 1, repeat: false },
    { section: 'Errors', columns: ['code', '触发条件', '调用方处理'], min_rows: 0, repeat: false },
  ],
  content: {
    Purpose: '格式示例：调用方查询入口的可观察状态。实际内容从固定版本的代码抽取，记录仓库、类、方法及 git_ref 证据，不复制源码全文；未确认内容明确标注。UI 接口按端点一卡，外部集成按事务码一卡。',
    Preconditions: 'None',
    Request: '只记录参数语义与取值约束；复杂校验引用对应 Rule Card，不粘贴报文全文。无参数时保留空表并说明原因。',
    Effects: '忠实记录代码可确认的状态变化或副作用；查询接口记录可观察输出。',
    Errors: '触发条件引用对应 Rule Card。此独立格式样例无错误码；实际抽取时逐项填写代码可确认的错误，未知项明确标注。',
    'Related Scenarios': '无关联场景：本例为独立格式样例。实际关联使用带平面前缀的链接，例如 [[doc/business/frd-example.md]]；前置规则引用例如 [[code/rules/br-example.md]]，示意链接不得作为真实证据提交。',
  },
  rows: {
    Request: [['id', '被查询对象的标识（格式示例）', '非空；实际约束依据代码及关联规则']],
    Effects: [['调用方', '获得对象当前状态（格式示例）']],
    Errors: [],
  },
}
