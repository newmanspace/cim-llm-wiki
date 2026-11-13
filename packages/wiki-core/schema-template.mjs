// Schema Card v1: physical facts from a fixed DDL, migration or ORM revision.
export const schemaTemplate = {
  sections: ['Mapping', 'Fields', 'Keys & Constraints', 'Referenced By'],
  tables: [
    { section: 'Mapping', columns: ['概念实体', '数据字典', 'Domain Card'], min_rows: 1, repeat: false },
    { section: 'Fields', columns: ['字段', '类型/长度', '空否', '值域/码表', '业务含义'], min_rows: 1, repeat: false },
  ],
  content: {
    Mapping: '一张物理表一张卡，正文归入 code/schemas/。格式示例：example_record（示例记录表），用于展示物理字段契约，不代表已实现。实际填写真实表名、用途及概念实体映射；关联资料使用带 doc/ 或 code/ 平面前缀的链接，不推测关联对象。',
    Fields: '逐字段依据固定版本的 DDL、迁移文件或 ORM 映射提取，明确数据库类型、长度或精度、是否允许 NULL、值域及业务含义。下行为格式示例；未知业务含义标记“待确认”。',
    'Keys & Constraints': '- 格式示例：主键为 id，非空，无默认值、无自动生成表达式。\n- 格式示例不包含其他唯一键、外键、检查约束或附加索引；实际逐项记录名称、字段顺序、约束表达式，以及适用时的索引类型和条件。\n- 默认值、生成值按实际定义记录。普通主键、非空等物理约束直接说明，涉及业务语义的约束再引用 Rule Spec，无需每个数据库约束单独建规则。\n- 生命周期与状态含义回链 Domain Card，不在此重复展开。',
    'Referenced By': '待确认：本例未绑定真实 API 或场景，不能依据表名推测调用关系。实际列出有证据的引用，并记录仓库、DDL／迁移／ORM 文件路径、固定版本及可定位位置。\n\n代码定义与数据库实际结构存在差异时，分别记录来源、版本、核对时间和具体差异，不合并成一份事实；尚未核对数据库时明确标记“未核对”，不声称已经部署。',
  },
  rows: {
    Mapping: [['待确认：示例未绑定概念实体', '待确认：未绑定数据字典', '待确认：未绑定 Domain Card']],
    Fields: [['id', 'bigint（格式示例）', '否', '无额外值域约束（格式示例）', '示例记录标识']],
  },
}
