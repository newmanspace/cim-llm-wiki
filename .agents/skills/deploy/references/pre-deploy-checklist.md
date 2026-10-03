# Pre-Deploy Checklist

> 在执行部署更新之前，必须确认以下条件全部满足。

## Required Checks
- [ ] 关键测试用例在本地通过（零失败）
- [ ] `.env` 文件中的关键配置已确认正确（数据库连接、API Key 等）
- [ ] 本次变更若涉及数据库 Schema 变更，已准备好对应 SQL（`deploy/postgres/`）
- [ ] 前端代码如有修改，`npm run build` 构建通过
- [ ] Docker 镜像构建不依赖外部网络资源（离线依赖已缓存）

## Rollback Plan
- 保留上一版本的 Docker 镜像 tag
- 如部署后出现异常，执行 `cd deploy && docker compose down && git checkout HEAD~1 -- . && docker compose up -d --build`
