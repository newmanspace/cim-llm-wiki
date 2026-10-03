---
name: deploy
description: >
  部署 CIM 文档知识工程系统应用服务到本地或容器环境（基于 deploy/docker-compose.yml）。
  不负责版本号管理和 Release Notes 生成（交由 release）。
---

# 部署 (Deploy)

本技能负责将经过测试验证的代码变更，安全地构建并部署到 CIM 知识工程流水线运行环境中。

## 前置约束
在执行任何部署动作前，必须确认以下条件全部满足：
- 关键测试用例通过（零失败）。
- `.env` 文件中的关键配置已确认正确。
- 本次变更若涉及数据库表结构变更，已准备好对应 SQL（`deploy/postgres/`）。

## 部署命令

### 标准部署与更新
通过 `deploy/docker-compose.yml` 执行全栈构建与更新：

```bash
cd deploy && docker compose up -d --build
```

### 服务状态检查
```bash
# 查看所有服务容器运行状态
cd deploy && docker compose ps

# 查看关键核心容器日志
cd deploy && docker compose logs -f server
cd deploy && docker compose logs -f admin
cd deploy && docker compose logs -f wiki
```

## 失败处理策略与回滚
当部署过程中出现异常时，按以下优先级排查与回滚：
1. **构建失败**：检查 Go 编译日志、Admin 前端构建或 Node 依赖环境。
2. **启动失败**：通过 `docker compose logs <服务名>` 查看容器启动日志，排查环境变量缺失或端口冲突。
3. **回滚操作**：
   ```bash
   git checkout HEAD~1 -- .
   cd deploy && docker compose up -d --build
   ```
