# Shared Design

维护跨模块共用的详细设计。

## 放入什么内容

- 公共服务、共享数据模型和跨模块接口。

## 维护边界

通用技术规范归 Engineering Standards，模块私有设计归 Modules。

## 子目录

- [Common Services](common-services/README.md)：权限、调度、通知、配置等实际公共服务的职责、契约和异常处理。
- [Shared Data Model](shared-data-model/README.md)：ER 图、共享实体、数据字典、约束及数据生命周期。
- [Cross-module Interfaces](cross-module-interfaces/README.md)：调用关系、消息、时序、事务一致性、失败处理和数据所有权。

[上级目录](../README.md)
