# 受控词表（Rule / Domain / Operation 三份枚举）

> 本文件为受控词表的阅读说明；校验器的机器词表来源为 `contracts/wiki/v1/vocabulary.json`。变更时须同步此说明，禁止只改说明而绕过机器契约。
> 新增枚举值必须先在此登记，再在节点中使用；未登记的值报 `vocabulary_violation` error。

## Rule Category（rule card 的 `rule_category` 与 domain card 的 `rule_tags` 共用）

- STATE          # 生命周期/状态机约束
- AVAILABILITY   # 可用性（是否可接任务）
- CAPABILITY     # 工艺/产品/Recipe/Chamber/Wafer size 能力匹配
- RECIPE         # Recipe 配置与版本
- ALARM          # 报警阻断与清除
- CHAMBER        # 腔体选择与匹配
- PROCESS_JOB    # ProcessJob 生命周期与约束
- CONTROL_JOB    # ControlJob 生命周期与约束
- LOT            # 批次属性/状态约束
- CARRIER        # 载具（FOUP/Cassette）状态与容量
- PORT           # 设备端口占用/禁用
- HOLD           # Hold/Release（涉此类别一律强制 L2 人审）
- QTIME          # 跨站时间约束（涉此类别一律强制 L2 人审）
- DISPATCH       # 派工/派车
- TRACK          # TrackIn/TrackOut 门禁
- MAINTENANCE    # PM/保养
- QUALIFICATION  # 设备/Recipe 认证
- SECURITY       # 权限/密码/用户组
- HISTORY        # 事务记录完整性
- IDENTITY       # 主键与唯一性约束
- FLOW           # 流程/路由/跳步

## Operation（rule card「Related Operations」、domain card 第 11 节与 api card 的 `operation` 字段共用；受控动词，PascalCase）

- RegisterEquipment
- ChangeEquipmentState
- ReserveEquipment
- ReleaseEquipment
- MoveInReservation
- TrackIn
- TrackOut
- StartProcess
- StopProcess
- AbortProcess
- AssignRecipe
- DownloadRecipe
- Alarm
- ClearAlarm
- StartPM
- CompletePM
- Dispatch
- Hold
- Release
- Skip
- Rework
- Split
- Merge
- BankIn
- BankOut
- Terminate
- Finish

## Relation（domain card「Relations」三元组谓词表）

- belongs_to     # 组织归属：Equipment → Area → Factory
- contains       # 组成：Equipment → Chamber；Carrier → Wafer
- supports       # 能力：Equipment → Recipe/Product
- processes      # 作业：Equipment → Lot
- operates_on    # 操作对象：Operation → Carrier/Port
- references     # 引用：Lot → Route/ProcessVersion
- triggers       # 触发：Event → Alarm/History
- constrained_by # 约束：Lot → QTime/Hold
- produced_by    # 溯源：Wafer → Equipment
- applies_to     # 生效点：Rule → API（规则在哪个接口执行时校验，见 rule card `applies_to`）
- invokes        # 调用：Scenario → API（流程步骤调用了哪个动作卡，见 scenario card Steps 表）
