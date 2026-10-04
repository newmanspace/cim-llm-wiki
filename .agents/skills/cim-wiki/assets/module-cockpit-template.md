# Module Cockpit Template (模块驾驶舱与规格说明模板)

> 知识抽取（Stage 2）抽取 `doc/modules/` 下的 `module`（模块驾驶舱页）节点时，节点的 `content` 应当遵循此人读骨架结构。
> 编译落盘路径：`data/wiki/<project>/doc/modules/mod-<module_name>.md`

---

# 模块驾驶舱: [模块名称与代码]

## 1. 模块定位与核心职责 (Overview & Responsibilities)
- **模块标识**：`[module-id，如: wip-management]`
- **核心定位**：[一句话说明该模块在整机 CIM/MES 系统中的分层与定位]
- **核心职责清单**：
  1. **[职责 1]**：[具体负责什么业务或技术契约]
  2. **[职责 2]**：...
- **边界划分**：[明确本模块不负责什么，交由哪个上下游模块处理]

## 2. 核心功能特性矩阵 (Feature Matrix)
| 特性 ID | 特性名称 | 功能简述 | 关联业务流程 (Workflow) | 适用版本 |
|---|---|---|---|---|
| F-01 | [特性 1] | [简述] | [[doc/business/frd-xxx.md]] | V1.0.0 |

## 3. 对外服务与接口契约导航 (API & Contracts)
- **UI 交互接口卡片**：
  - `[[code/apis/api-xxx-ui-001.md]]` - [接口描述]
- **外部集成接口卡片**：
  - `[[code/apis/api-int-xxx-001.md]]` - [对接系统与事务码]
- **核心功能契约校验**：
  - `[[code/rules/br-xxx-001.md]]` - [核心校验规则]

## 4. 依赖拓扑与环境配置 (Dependencies & Configuration)
- **上游服务依赖**：`[[doc/modules/mod-xxx.md]]`
- **下游服务依赖**：`[[doc/modules/mod-yyy.md]]`
- **关键配置项与环境变量**：
  | 配置键 / 变量名 | 类型 | 默认值 | 作用说明 |
  |---|---|---|---|
  | `CONFIG_KEY` | String | `default_value` | [配置项的作用与调优建议] |

## 5. 运维监控与故障诊断 (Operations & Health Check)
- **健康检查接口**：`GET /healthz`
- **核心排障日志**：`[日志路径与关键关键字]`
