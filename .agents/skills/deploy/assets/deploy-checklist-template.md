# Deploy Checklist Template

> `deploy` 技能在执行部署前参考此清单确认就绪状态。

## Pre-Deploy Checklist

- [ ] 所有 `pytest` 测试在本地通过（零失败）
- [ ] `.env` 文件中的关键配置已确认正确
- [ ] 数据库 Schema 迁移 SQL 已手动执行
- [ ] `pyproject.toml` 依赖变更已同步到 `uv.lock`
- [ ] Docker 镜像构建不依赖外部网络资源

## Post-Deploy Verification

- [ ] 健康检查通过：`curl http://localhost:8000/health`
- [ ] 容器正常运行：`docker compose ps`
- [ ] 日志无 ERROR：`docker compose logs -f app`
- [ ] 核心功能端到端验证

## Rollback Plan

```bash
docker compose down
git checkout HEAD~1 -- .
./deploy/deploy.sh
```
