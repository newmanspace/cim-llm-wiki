# 半导体 CIM/MES 专业术语名词字典 (myCIM 4.0 标准对照库)

> 来源文件：`docs/myCIM4.0名词对应表-V2.8.xlsx`（版本 V2.8，维护人：周琪林 / 闫宁 / Joseph 等）
> 适用范围：泛半导体 12 英寸制造晶圆厂 CIM/MES 系统研发、功能需求规格书 (FRD)、架构设计 (SDD)、接口契约 (IDD) 与 Wiki 知识库抽取标准。
> 对照基准：已全面对齐 **AMAT 300Works** 行业事实标准命名体系。

## 一、 名词定义与缩写规范 (Naming & Abbreviation Rules)

1. **代码与契约规范**：**代码与 API 强契约中严禁出现随意简写或非标准缩写**；必须使用受控词表全称（PascalCase 或 camelCase）。
2. **单单词缩写规范**：针对单个英文单词的缩写，强制采用「**首字母大写 + 其余小写**」形式：
   - Quantity $\rightarrow$ `Qty`
   - Number $\rightarrow$ `No`
   - Group $\rightarrow$ `Grp`
   - Product $\rightarrow$ `Prod`
3. **多单词缩写规范**：针对多个单词组合的业务缩写，强制采用「**全大写 (UPPERCASE)**」形式：
   - Overhead Buffer $\rightarrow$ `OHB`
   - Manufacturing Definition Services $\rightarrow$ `MDS`
   - Operation Management Services $\rightarrow$ `OMS`
   - Equipment $\rightarrow$ 通用简写 `EQP`
   - Physical Recipe $\rightarrow$ `PPID`
   - Future Split Merge $\rightarrow$ `FSM`
   - Non-Production Wafer $\rightarrow$ `NPW`

---

## 二、 专业名词对照表 (按业务领域分层)

### 1. 基础系统与服务架构 (System Services & Infrastructure) (共 10 项)

| 序号 | 中文命名 | myCIM 标准英文 | 缩写 | 对照与AMAT 300Works用法 | 释义与工程约束 |
|---|---|---|---|---|---|
| 1 | **建模管理系统** | `Manufacturing Definition Services` | MDS | Manufacturing Definition Services (MDS) | - |
| 2 | **操作管理系统** | `Operation Management Services` | OMS | Operation Management Services (OMS) | - |
| 3 | **排程管理系统** | `Schedule Planning Services` | SPS | Schedule Planning Services（SPS) | - |
| 4 | **传输管理系统** | `Transfer Management Services` | TMS | Transfer Management Services（TMS） | - |
| 5 | **设备自动化程序** | `Equipment Automation Program` | EAP | Equipment Automation Program（EAP) | - |
| 154 | **光罩管理系统** | `Reticle Management Services` | RTMS | - | - |
| 193 | **物料控制系统** | `Material Control System` | MCS | - | - |
| 245 | **自动物料搬运系统** | `Automated Material Handling System` | AMHS | - | - |
| 246 | **自动光罩搬运系统** | `Automated Reticle Handling System` | ARHS | - | - |
| 247 | **自动搬运管理** | `Auto Delivery Manager` | ADM | - | - |

### 10. 用户权限、操作事务与审计 (User, Transaction & Audit) (共 12 项)

| 序号 | 中文命名 | myCIM 标准英文 | 缩写 | 对照与AMAT 300Works用法 | 释义与工程约束 |
|---|---|---|---|---|---|
| 10 | **用户名称** | `User Name` | - | User ID | 操作者 |
| 11 | **用户号** | `User ID` | - | - | - |
| 13 | **操作备注** | `Memo` | - | Comment | 操作时的备注 |
| 14 | **Lot备注** | `Lot Memo` | - | - | - |
| 16 | **订单备注** | `PO Memo` | - | - | 系统应该还有采用Comment部分。 Memo (Note)和Comment都会有<br/>Lot Create时设置Lot Comment |
| 66 | **原因代码** | `Reason Code` | - | Reason Code | - |
| 67 | **原因代码组** | `Reason Code Category` | - | Reason Code Group | - |
| 70 | **优先级** | `Priority / Priority Class` | PRI | Priority( PRI ) | - |
| 71 | **外部优先级** | `External Priority` | - | External Priority( E-PRI) | - |
| 72 | **内部优先级** | `Internal Priority` | I-PRI | Internal Priority( I-PRI) | - |
| 98 | **操作** | `Transaction` | - | Activity / Transaction（TXN） | - |
| 248 | **故障代码** | `Failure Code` | - | - | - |

### 2. 工厂物理与组织空间建模 (FAB Physical & Area Modeling) (共 13 项)

| 序号 | 中文命名 | myCIM 标准英文 | 缩写 | 对照与AMAT 300Works用法 | 释义与工程约束 |
|---|---|---|---|---|---|
| 38 | **区域组** | `Area Group` | - | Area Group | Location+Permission |
| 39 | **MFG工作区域** | `MFG Area` | - | Work Area / Sub Area | - |
| 40 | **PE工作区域** | `PE Area` | - | PE Area / Work Area | Resonsible Dept |
| 41 | **EE工作区域** | `EE Area` | - | EE Area | - |
| 218 | **仓储设备** | `Stocker` | - | - | 自动化仓储设备 |
| 219 | **裸晶圆仓储设备** | `Bare Wafer Stocker` | BWS | - | - |
| 221 | **电子货架** | `eRack` | - | - | 支持通过EAP进行信息交换 |
| 222 | **货架** | `Shelf` | - | - | 不与MES进行数据交换 |
| 224 | **入库** | `Stock In` | - | - | Durable进入存储设备 |
| 225 | **出库** | `Stock Out` | - | - | Durable离开存储设备 |
| 226 | **物理区域** | `Work Area` | - | Area | 设备所处的物理区域 |
| 227 | **主干** | `Inter Bay` | - | - | 不同Work Area间，传输主干道 |
| 228 | **支干** | `Intra Bay` | - | - | 同一个Work Area内，传输支干道 |

### 3. 设备、腔体与资源建模 (Equipment & Process Resource Modeling) (共 31 项)

| 序号 | 中文命名 | myCIM 标准英文 | 缩写 | 对照与AMAT 300Works用法 | 释义与工程约束 |
|---|---|---|---|---|---|
| 42 | **顶部缓存区编组** | `Overhead Buffer Group` | OHB Group | - | 多个OHB组成的一组缓存区 |
| 43 | **顶部缓存区** | `Overhead Buffer` | OHB | - | Overhead Buffer |
| 46 | **设备** | `Equipment` | EQP | Equipment(EQP) | - |
| 47 | **设备类别** | `Equipment Category` | Equipment Category | Equipment kind / Equipment Category | - |
| 48 | **设备类型** | `Equipment Type` | EQP Type | EQP Type / Equipment Type | - |
| 49 | **设备型号** | `Equipment Model` | EQP Model | EQP Model / Equipment Model | - |
| 51 | **设备E10状态** | `EQP E10 State` | E10 State | Equipment E10 State | - |
| 52 | **设备状态** | `EQP State` | - | EQP State / Equipment State | - |
| 53 | **设备操作历史** | `EQP Operation History` | - | Process History/Equipment History / Equipment History | - |
| 54 | **设备加工历史** | `EQP Process History` | - | - | - |
| 85 | **设备预约** | `Equipment Reserve` | - | Equipment Reserve | Q: 需要定义Reserve对象 EQP Reserve还是Load Port Reserve<br/>A: 将设备预约的名称定义为Equipment Reserve, 它和Load Port Reserve是两个概念. |
| 140 | **禁用设备** | `Inhibit Equipment` | - | Inhibit Equipment | - |
| 145 | **端口类型** | `Port Usage` | - | Port Type | myCIM命名为Port Usage，Port的类型：Input – Output、Input、Output |
| 194 | **设备备注** | `EQP Memo` | - | - | 对设备、运输设备添加的备注 |
| 195 | **固定加工区域设备** | `Fixed Buffer Equipment` | Fixed Buffer | - | 无内部缓存位置的设备 |
| 196 | **内部加工区域设备** | `Internal Buffer Equipment` | Internal Buffer | - | 有内部缓存位置的设备 |
| 199 | **设备加工资源** | `Process Resource` | - | - | 设备的加工资源，如Chamber、Tank、Boat等 |
| 200 | **设备腔室** | `Chamber` | - | - | - |
| 201 | **酸洗槽** | `Tank` | - | - | - |
| 202 | **晶舟** | `Boat` | - | - | Furnace机台制程时，放置Wafer的机构 |
| 203 | **炉管** | `Tube` | - | - | Furnace机台制程时，升温机构 |
| 204 | **头** | `Head` | - | - | 将晶圆面朝下并使晶圆与抛光垫接触的部件 |
| 205 | **炉管设备** | `Furnace` | - | - | - |
| 206 | **光刻设备** | `Litho` | - | - | - |
| 207 | **刻蚀** | `Etch` | - | - | 刻蚀设备包含干式和湿式刻蚀设备 |
| 208 | **化学机械研磨** | `Chemical Mechanical Planarization` | CMP | - | - |
| 214 | **端口** | `Port` | - | - | 设备进出Carrier的端口 |
| 215 | **端口状态** | `Port State` | - | - | Read to Load、Load Comp、Ready to Unload、Unload Comp、Down |
| 216 | **运输设备** | `Transport Equipment` | Transport EQP | - | - |
| 217 | **运输设备类别** | `Transport Equipment Category` | Transport EQP Category | - | Auto、Shelf等 |
| 223 | **天车** | `Overhead Hoist Transport` | OHT | - | - |

### 4. 产品、工艺路线与配方管理 (Product, Process Flow & Recipe) (共 34 项)

| 序号 | 中文命名 | myCIM 标准英文 | 缩写 | 对照与AMAT 300Works用法 | 释义与工程约束 |
|---|---|---|---|---|---|
| 7 | **动态加工控制** | `Dynamic Operation Control` | DOC | Dynamic Operation Control（DOC) | - |
| 15 | **Lot站点备注** | `Lot Operation Memo` | - | - | - |
| 22 | **产品** | `Product` | Prod | Product | - |
| 23 | **源产品** | `Source Product` | - | Source Product | - |
| 24 | **主流程** | `Process Flow` | - | Top plan / Process | - |
| 26 | **工步** | `Step` | - | Step | - |
| 27 | **工序号** | `Operation Number` | Operation No | Step Seq / Operation Number | - |
| 29 | **光罩层** | `Mask Layer` | - | Photo Layer | - |
| 30 | **制程阶段** | `Stage` | - | Stage | Q: 需要确定一个Route可不可以有多过一个Stage。Stage也可以跨Route。<br/>A: 当前设计一个Route只能对应一个Stage, 但是一个Stage可以拥有多个Route；该设计后续会有所调整 |
| 31 | **逻辑配方** | `Logical Recipe` | - | Flow Recipe/Recipe / Logical Recipe | - |
| 32 | **设备配方** | `Machine Recipe` | - | Machine Recipe/Namespace.Physical Recipe / Recipe/Namespace.Physical Recipe | Machine Recipe = Base Recipe when further ppid resolution is required. |
| 33 | **物理配方** | `Physical Recipe` | PPID | - | - |
| 34 | **工程数据采集计划** | `EDC Plan` | - | EDC Plan | - |
| 35 | **工程数据采集规范** | `EDC Specification` | - | - | - |
| 36 | **工程数据项** | `Data Item` | - | Spec Item | - |
| 37 | **工程数据项规范** | `Specification Item` | - | Specification/Spec | - |
| 109 | **工步暂停** | `Step Hold` | - | Step Hod | - |
| 110 | **取消预设工步暂停** | `Step Hold Cancel` | - | - | - |
| 111 | **流程工步暂停** | `Process Step Hold` | - | - | - |
| 112 | **取消预设流程工步暂停** | `Process Step Hold Cancel` | - | - | - |
| 131 | **工步预览** | `Process Flow Overview` | - | Fetch Step | - |
| 134 | **站点名称** | `Step Name` | - | Step Name | - |
| 137 | **批次工步状态** | `Lot Step Status` | - | Step Status | - |
| 141 | **禁用配方** | `Inhibit PPID` | - | Inhibit Recipe | - |
| 253 | **配方组** | `Recipe Group` | - | - | - |
| 259 | **触发工步** | `Trigger Operation` | - | - | - |
| 260 | **目标工步** | `Target Operation` | - | - | - |
| 281 | **产品变更** | `Product Change` | - | - | - |
| 292 | **MR配方组** | `MR Recipe Group` | - | - | 简称B Group |
| 293 | **产品配方组** | `Product Recipe Group` | - | - | 简称A Group |
| 297 | **工步类型** | `Step Type` | - | Step Type | 工步类型（如表示Process/Measurement/Sorter等不同的工步类型） |
| 298 | **工步子类型** | `Step Sub Type` | - | Step Sub Type | 对同一个工步类型存在不同的Step Task Map进行区分 |
| 299 | **工步任务集合** | `Step Task Map` | - | Step Task Map | 表示Lot在一个工步加工的时候，经历的不同的阶段 |
| 300 | **工步任务** | `Step Task` | - | Step Rule / Step Task | 表示Lot在一个工步加工的某一个加工阶段 |

### 5. 批次与在制品流转管理 (Lot & WIP Tracking) (共 124 项)

| 序号 | 中文命名 | myCIM 标准英文 | 缩写 | 对照与AMAT 300Works用法 | 释义与工程约束 |
|---|---|---|---|---|---|
| 6 | **流程控制脚本** | `Process Control Script` | PCS | Process Control Script （PCS） | - |
| 8 | **号** | `ID` | - | ID/Id / ID | - |
| 9 | **号** | `Number` | No | Number（No） | - |
| 12 | **描述** | `Description` | Desc | Description（DESC) | - |
| 17 | **类别** | `Category` | - | Kind / Category | 定义角度大类划分。是不是上一层还会有Class？ |
| 18 | **类型** | `Type` | - | Type | 定义角度细分类型 |
| 19 | **组** | `Group` | Grp | Group | 使用角度分类，一般可以灵活划分 |
| 20 | **流程关系管理** | `Flow Management` | - | Process Relationship Planning（PRP） / Flow Management | - |
| 21 | **产品工艺** | `Technology` | - | Technology | - |
| 25 | **子流程** | `Route` | - | Sub Plan | - |
| 28 | **制造层** | `Manufacturing Layer` | - | Manufacturing Layer | - |
| 44 | **仓库** | `Start Bank+ End Bank` | - | Inventory | Indicate the stock Inventory, system still track start end bank internally |
| 45 | **线边仓** | `Bank` | - | Bank | Inventory on floor |
| 50 | **设备能力** | `Capability` | - | EQP Capability / Equipment Capability | - |
| 55 | **耐用品** | `Durable` | - | Durable | - |
| 58 | **载具使用类型** | `Usage Type` | - | Carrier Category | eg：Production，Monitor |
| 61 | **载具传输状态** | `Xfer State` | - | Pyhsical Status / Carrier Transfer State | - |
| 64 | **光罩进盒** | `Just In` | - | Pod In | - |
| 65 | **光罩出盒** | `Just Out` | - | Pod Out | - |
| 68 | **批次类型** | `Lot Type` | - | - | - |
| 69 | **批次子类型** | `Sub Lot Type` | - | Lot Type | Q: Lot Type 还会保存 ？应该是中芯Lot Type 对应myCIM SubLot Type<br/>A: 是的, Lot Type会保留, 已增加名词定义。 |
| 73 | **晶圆号** | `Wafer ID` | - | Wafer ID/Component ID / Wafer ID | - |
| 74 | **原料晶圆** | `Raw Wafer` | - | Raw Wafer | - |
| 75 | **晶圆类型** | `Wafer Type` | - | Wafer Type | - |
| 76 | **原物料** | `Raw Material` | - | Raw Material | - |
| 77 | **原物料号** | `Raw Material No` | - | Material No | Raw Material No 在MDS中定义为Source Product |
| 78 | **客户号** | `Customer ID` | - | Customer ID | - |
| 79 | **厂商号** | `Vendor Name` | - | Vendor Name / Vendor ID | - |
| 80 | **厂商批次号** | `Vendor Lot ID` | - | Vendor Lot ID | - |
| 81 | **源批次** | `Source Lot` | - | Source Lot | - |
| 82 | **最后加工设备** | `Process Location` | P-Location | Process Location（P-Location） | Process Location（P-Location） |
| 83 | **最后设备** | `Last Location` | L-Location | Last Location（L-Location） | - |
| 84 | **物理位置** | `Location` | - | Physical Location | - |
| 86 | **Load Port 预约** | `Move In Reserve` | - | Load Port Reserve | - |
| 87 | **控制任务** | `Control Job` | - | Control Job（CJ) | 中芯体系还是有Control Job, Process Job,加上Batch ID |
| 88 | **Batch ID** | `Batch ID` | - | Batch ID | - |
| 89 | **加工任务** | `Process Job` | - | Process Job（PJ） | - |
| 97 | **选片规则** | `Wafer Sampling` | - | Wafer Selection Rule / Wafer Sampling Rule | - |
| 99 | **原物料接受** | `Material Receive` | - | Material Receive | - |
| 100 | **批次创建** | `Lot Create` | - | Create Lot/Scheduled Lot / Lot Create | - |
| 101 | **批次下线** | `Lot / Wafer Start` | - | Wafer start / Lot start | 在当前MES设计中Lot Start和Wafer Start是相同的含义. |
| 102 | **预约作业** | `Setup` | - | Job Prep/Setup / Setup | 目前命名规范都是Object+Action。Move-In Reserve类似Action+Action, 另外和EQP Reservation有冲突。建议采用Setup （也是中芯用户认可的名词） |
| 103 | **作业开始** | `Move In` | - | Job In / Move In | - |
| 104 | **作业结束** | `Move Out` | - | Job Out / Move Out | - |
| 105 | **批次暂停** | `Hold` | - | Hold Lot / Lot Hold | - |
| 106 | **批次放行** | `Release` | - | Release | - |
| 107 | **预设暂停** | `Future Hold` | - | Future Hold | - |
| 108 | **取消预设暂停** | `Future Hold Cancel` | - | Cancel Future Hold / Future Hold Cancel | - |
| 113 | **批次分批** | `Split` | - | Lot Split / Lot split | - |
| 114 | **逻辑分批** | `Logical Split` | - | Internal Split / Logical Split | - |
| 115 | **物理分批** | `Physical Split` | - | External Split / Physical Split | - |
| 116 | **批次合批** | `Logical Merge` | - | Lot Merge | - |
| 117 | **物理合批** | `Physical Merge` | - | Physical Merge | - |
| 118 | **预设分批** | `Future Split Merge` | - | Future Split | - |
| 119 | **Plan Split Merge** | `Plan Split Merge` | - | - | - |
| 120 | **批次报废** | `Scrap` | - | Scrap Lot / Lot Scrap | - |
| 121 | **取消批次报废** | `Scrap Cancel` | - | UnScrap / Lot Scrap Cancel | - |
| 122 | **批次终止** | `Terminate` | - | Lot Terminate | - |
| 123 | **取消批次终止** | `Terminate Cancel` | - | UnTerminate / Lot Terminate Cancel | - |
| 124 | **批次信息变更** | `Lot Information Change` | - | Lot Information Change / lot Info/Attributes Change | Change of lot comment etc. |
| 125 | **批次属性变更** | `Lot Attribute Change` | - | Lot Attribute Change | - |
| 126 | **工步重定位** | `Reposition` | - | Reposition | - |
| 127 | **入线边仓** | `Bank In` | - | Bank In | - |
| 128 | **出线边仓** | `Bank Out` | - | Bank Out | - |
| 129 | **批次完成/结批** | `Lot Finish` | - | Lot Finish | 应该还有一个Lot Finish |
| 130 | **批次出货** | `Ship` | - | Ship Lot / Lot Ship | - |
| 132 | **批次历史** | `Lot History` | - | Full Lot Report / Lot History | - |
| 133 | **光阻/光刻胶** | `PR` | - | Photo Resist（PR） | - |
| 135 | **预设合批** | `Future Merge` | - | Future Merge | - |
| 136 | **批次状态** | `Lot Status` | - | Lot Status | - |
| 138 | **Hold处理责任人** | `Sponsor` | - | Hold Sponsor / Sponsor ID | - |
| 139 | **Hold 类型** | `Hold Type` | - | Hold Type | 目前myCIM的hold类型（HoldLot、FutureHold、HoldLotInBank、MergeHold、OcapHold、ProcessHold、QtimeOverHold、ReworkHold、SpecOverHold、WaitingMonitorHold、SPCOutofRangeHold、RunningHold、LockHold） |
| 144 | **自动模式/操作模式** | `Auto Mode` | - | Auto Mode | Auto-3、Auto-2、、、、、 |
| 146 | **控制模式** | `Control Mode` | - | Control Mode | Q：myCIM命名Online Mode，On-Line、On-Line Local、Off-Line<br/>A：Control Mode is actually industry standrd, so we'd better use Control Mode (OMS UI And SMIC also use Control Mode) |
| 156 | **薄膜类型** | `Pellicle Type` | - | - | 保护光罩用的薄膜的类型 |
| 157 | **雾状缺陷** | `Haze` | - | - | - |
| 158 | **集成掩膜探测系统** | `IRIS` | - | - | Integrated Reticle Inspection System |
| 160 | **光罩盒开门次数** | `Open Count` | - | - | - |
| 162 | **Hold Memo模板** | `Hold Template` | - | - | - |
| 176 | **使用次数** | `Usage Count` | - | - | - |
| 188 | **自动结束使用Wafer数限度** | `EndUse Wafer Count Limit` | - | - | 用于判断达到Limit的Wafer数量即可自动EndUse |
| 189 | **自动结束使用标识** | `Auto EndUse Flag` | - | - | 标识可否自动合批进入Recycle Bank |
| 191 | **可使用标识** | `Usable Flag` | - | - | 标识Lot是否可再次使用 |
| 192 | **可回收标识** | `Recyclable Flag` | - | - | 标识Lot是否可再次回收 |
| 197 | **构造类型** | `Construct Type` | - | - | 设备的构造类型，如Multi Chamber、Chamber、Multi Tank、Tank等 |
| 198 | **加工对象** | `Tracking Unit` | - | - | 设备加工的对象，如Lot、Carrier等 |
| 209 | **化学气相沉积** | `Chemical Vapor Deposition` | CVD | CVD | - |
| 210 | **物理气相沉积** | `Physical Vapor Deposition` | PVD | PVD | - |
| 211 | **状态模型** | `State Model` | - | - | 设备状态转换规则模式 |
| 212 | **存取模式** | `Access Mode` | - | - | - |
| 213 | **派工模式** | `Dispatch Mode` | - | - | - |
| 235 | **操作码** | `Action Code` | - | - | Sorter执行的动作代码 |
| 251 | **闲置** | `IDLE` | - | - | - |
| 252 | **零闲置** | `Zero IDLE` | - | - | - |
| 254 | **预防性维护** | `Preventive Maintenance` | PM | - | - |
| 261 | **触发点** | `Trigger Point` | - | - | - |
| 262 | **结束点** | `Target Point` | - | - | - |
| 263 | **时长** | `Duration` | - | - | Q-Time等设置的时间间隔 |
| 265 | **Q-Time的触发类型** | `Trigger Type` | - | - | - |
| 266 | **Wafer开始加工** | `Wafer Process Start` | - | - | - |
| 267 | **Wafer结束加工** | `Wafer Process End` | - | - | - |
| 268 | **Q-Time到期时间** | `Target Time` | - | - | - |
| 271 | **供应商序列号** | `Vendor Serial No` | - | - | - |
| 272 | **前开式晶圆出货盒** | `FOSB` | - | - | 前开式晶圆出货盒(Front Opening Shipping Box) |
| 275 | **清洗周期** | `Clean Period` | - | - | - |
| 276 | **超过清洗周期的时长** | `Clean Overdue` | - | - | - |
| 277 | **最大可Move In的次数** | `Max Move In Count` | - | - | - |
| 278 | **最长可用时间** | `Max Run Time` | - | - | - |
| 280 | **流程重定位** | `Reassign` | - | - | - |
| 282 | **流程升版** | `Flow Version Up` | - | - | - |
| 283 | **后置阶段流程重定位** | `Post Reassign` | - | - | Post阶段执行的Reassign |
| 284 | **预设流程重定位** | `Future Reassign` | - | - | 设置在未来工步执行Reassign |
| 285 | **交替加工** | `Mix Run` | MR | - | - |
| 286 | **交替加工计划** | `MR Plan` | - | - | Mix Run Plan |
| 287 | **交替加工任务** | `MR Job` | - | - | Mix Run Job |
| 288 | **进行MR加工** | `In MR` | - | - | In Mix Run |
| 289 | **进行Product Lot加工** | `In PR` | - | - | In Product Lot Run |
| 290 | **等待MR加工** | `Wait for MR` | - | - | Wait for Mix Run |
| 291 | **等待Product Lot加工** | `Wait for PR` | - | - | Wait for Product Run |
| 301 | **分批流程卡** | `Split Run Card` | SRC | SRC | 表示分批实验用户需要处理的流程单 |
| 302 | **复机流程卡** | `Recovery Run Card` | RRC | RRC | 表示Lot加工过程中异常Hold情况下，用户处理异常的流程单 |
| 303 | **动态加工控制** | `Dynamic Process Control` | DPC | DPC | 表示SRC和RRC动态生成Flow的底层机制 |
| 305 | **母批** | `Parent Lot` | - | - | - |
| 306 | **子批** | `Child Lot` | - | - | - |

### 6. 载具与光罩管理 (Carrier & Reticle Management) (共 22 项)

| 序号 | 中文命名 | myCIM 标准英文 | 缩写 | 对照与AMAT 300Works用法 | 释义与工程约束 |
|---|---|---|---|---|---|
| 56 | **载具** | `Carrier` | - | Carrier | - |
| 57 | **载具类型** | `Carrier Type` | - | Carrier Kind | eg：FOUP，FOSB |
| 59 | **载具类别** | `Carrier Category` | - | Carrier Type | eg：Fe,BE,AI,Ni,Cu |
| 60 | **载具状态** | `Carrier State` | - | Carrier State | eg：AVAILABLE/INUSE/NOTAVAILABLE/SCRAPPED |
| 62 | **光罩盒** | `Reticle Pod` | Pod | Pod | - |
| 63 | **光罩** | `Reticle` | - | Reticle | - |
| 147 | **站点载具使用类型** | `Operation Carrier Category` | - | - | - |
| 148 | **光罩类型** | `Reticle Type` | - | - | - |
| 149 | **光罩等级** | `Reticle Grade` | Grade | - | - |
| 150 | **光罩装载** | `Reticle Load` | - | - | 将Reticle装载到机台 |
| 151 | **装载卸载** | `Reticle Unload` | - | - | 将Reticle从机台中卸载 |
| 152 | **曝光检查** | `Print Down` | PD | - | - |
| 153 | **反射光检查** | `Starlight` | SL | - | Simultaneous Transmitted And Reflected Light：同时传输和反射光检查 |
| 155 | **光罩类别** | `Reticle Category` | - | - | Product、Monitor、Product  Monitor， 固定值 |
| 159 | **光罩重装** | `Remount` | - | - | 光罩与保护薄膜重新安装 |
| 161 | **光罩盒类型** | `Reticle Pod Type` | Pod Type | - | - |
| 220 | **裸光罩仓储设备** | `Bare Reticle Stocker` | BRS | - | - |
| 269 | **载具型号** | `Carrier Model No` | - | - | - |
| 270 | **载具备注** | `Carrier Memo` | - | - | - |
| 273 | **前开式晶圆传送盒** | `FOUP` | - | - | 前开式晶圆传送盒(Front Opening Unified Pod) |
| 274 | **载具的尺寸规格** | `Carrier Size` | - | - | - |
| 279 | **载具子状态** | `Carrier Status` | - | - | 载具的子状态,比如：Free/In_Use/Hold/Wait_Clean/In_Clean/Wait_Check/In_Check/Scrap/.... |

### 7. 非生产晶圆与机台维护管控 (NPW, Dummy, Season, Monitor & Mix Run) (共 33 项)

| 序号 | 中文命名 | myCIM 标准英文 | 缩写 | 对照与AMAT 300Works用法 | 释义与工程约束 |
|---|---|---|---|---|---|
| 90 | **炉管Batch号** | `Monitor Group` | - | Furnace Batch ID | Q: Process Type+ Batch ID。 如果Prod+Prod 做Batch， 也叫做Monitor Group ? myCIM 应该也有Batch<br/>A: 是的, Prod + Prod 也叫做Monitor Group. |
| 91 | **设备监控** | `Equipment Monitor` | - | Equipment Monitor | - |
| 92 | **制程监控** | `Process Monitor` | - | Furance Monitor / Process Monitor | - |
| 163 | **非生产片** | `NPW Wafer` | - | - | - |
| 164 | **暖机** | `Season` | - | - | - |
| 165 | **陪片** | `Dummy` | - | - | - |
| 166 | **NPW准备制程段** | `NPW Preparation Process` | - | - | 表示NPW Process Flow三段式Modeling中的Prepare段 |
| 167 | **NPW使用制程段** | `NPW InUse Process` | - | - | 表示NPW Process Flow三段式Modeling中的In Use段 |
| 168 | **NPW回收制程段** | `NPW Recycle Process` | - | - | 表示NPW Process Flow三段式Modeling中的Recycle段 |
| 169 | **NPW分支制程段** | `NPW Branch Process` | - | - | 表示具体的一种In Use Process，如Monitor, Season, Dummy |
| 170 | **NPW源材料仓库** | `NPW Source Bank` | - | - | - |
| 171 | **NPW待使用仓库** | `NPW Wafer Bank` | - | - | - |
| 172 | **NPW待回收仓库** | `NPW Recycle Bank` | - | - | - |
| 173 | **使用起点** | `InUse Start` | - | - | InUse Process Lot分批，然后绑定Job进入Branch的Dummy站点 |
| 174 | **使用终点** | `InUse End` | - | - | InUse Process Lot合批，进入Recycle Bank的Dummy站点 |
| 175 | **回收终点** | `RecycleEnd` | - | - | - |
| 177 | **回收次数** | `Recycle Count` | - | - | - |
| 178 | **最多可使用次数** | `Max Usage Count` | - | - | - |
| 179 | **最多可回收次数** | `Max Recycle Count` | - | - | - |
| 180 | **重复使用** | `Reuse` | - | - | - |
| 181 | **回收** | `Recycle` | - | - | - |
| 182 | **降级** | `Downgrade` | - | - | - |
| 183 | **NPW计划** | `NPW Plan` | - | - | NPW所有Plan的统称，具体有Monitor Plan，Season Plan |
| 184 | **NPW任务** | `NPW Job` | - | - | NPW所有Job的统称，具体有Monitor Job，Season Job |
| 185 | **翻新** | `Reclaim` | - | - | Wafer使用到不能再回收使用后可做翻新处理，处理后wafer可再次使用 |
| 186 | **厂内翻新** | `InFab Reclaim` | - | - | - |
| 187 | **厂外翻新** | `Subcon Reclaim` | - | - | - |
| 190 | **In Use段降级标识** | `InUse Downgrade Flag` | - | - | 用于标识在In Use End点执行了Downgrade操作的Lot |
| 249 | **暖机计划** | `Season Plan` | - | - | - |
| 250 | **暖机任务** | `Season Job` | - | - | - |
| 294 | **领跑生产批** | `Pilot` | - | - | 分出进行领跑的小批量的Lot |
| 295 | **领跑** | `Pi-Run` | - | - | - |
| 296 | **领跑计划** | `Pi-Run Plan` | - | - | - |

### 8. 时间约束与制造规则防呆 (Q-Time & Manufacturing Constraints) (共 10 项)

| 序号 | 中文命名 | myCIM 标准英文 | 缩写 | 对照与AMAT 300Works用法 | 释义与工程约束 |
|---|---|---|---|---|---|
| 93 | **最大Q-Time** | `Max Q-Time` | - | Max Q-Time / Q-time | 需要有Max， Min Q-time.myCIM不采用Lag Time |
| 94 | **最小Q-Time** | `Min Q-Time` | - | Min Q-Time | - |
| 95 | **限制** | `Constraint` | - | Constraint | Constraint包含Equipment Constraint, Recipe Constraint, Load Port Constraint, Product Constraint,.... |
| 96 | **设备限制** | `Equipment Constraint` | - | - | - |
| 255 | **Q-Time** | `Q-Time` | - | - | - |
| 256 | **时间间隔Q-Time** | `Interval Q-Time` | - | - | - |
| 257 | **充氮气等待时间** | `N2 Purge Q-Time` | - | - | - |
| 258 | **等待时间管控区域** | `Q-Time Section` | - | - | - |
| 264 | **Q-Time的类型** | `Q-Time Type` | - | - | - |
| 304 | **预估污染等级** | `Plan On Contamination Level` | - | Plan On Contamination Level | 表示对SRC Lot进入分批站点污染等级的预测 |

### 9. 晶圆分选与自动化操作 (Wafer Sorter & Handling Actions) (共 15 项)

| 序号 | 中文命名 | myCIM 标准英文 | 缩写 | 对照与AMAT 300Works用法 | 释义与工程约束 |
|---|---|---|---|---|---|
| 229 | **晶圆分选机** | `Wafer Sorter` | Sorter | - | - |
| 230 | **流程中的Sorter** | `On-Route Sorter` | - | - | - |
| 231 | **流程外的Sorter** | `Off-Route Sorter` | - | - | - |
| 232 | **Sorter预约作业** | `Sorter Setup` | - | - | - |
| 233 | **Sorter作业开始** | `Sorter Move In` | - | - | - |
| 234 | **Sorter作业结束** | `Sorter Move Out` | - | - | - |
| 236 | **批次传输** | `LotTransfer` | - | - | Action Code，选中一个Lot或多个Lots传送到另一个FOUP中 |
| 237 | **正序** | `SortingAsc` | - | - | Action Code，选中有且只有一个Lot的FOUP，正序填充 slot 1->25 |
| 238 | **倒序** | `SortingDesc` | - | - | Action Code，选中有且只有一个Lot的FOUP，倒序填充 slot 25->1 |
| 239 | **随机** | `SortingRandom` | - | - | Action Code，选中有且只有一个Lot的FOUP，随机填充 slot |
| 240 | **恢复** | `SortingReset` | - | - | Action Code，选中有且只有一个Lot的FOUP，按Wafer ID恢复成下线时的 slot |
| 241 | **调整** | `SortingAdjust` | - | - | Action Code，按需求手动界面选中Lot(s), 调整在FOUP中的Wafer slot |
| 242 | **转动** | `Rotate` | - | - | Action Code，选中一个Lot或多个Lots，相对Wafer校准原点，转动角度 |
| 243 | **翻面** | `Flip` | - | - | Action Code，选中一个Lot或多个Lots，对Wafer进行翻面 |
| 244 | **核实** | `Verify` | - | - | Action Code，读取一个FOUP中的Slot map，及存在的Wafer T7Cdoe上报结果 |
