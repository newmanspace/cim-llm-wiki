# SQL Migration Commands Reference

> `release` 技能在执行数据库迁移时参考本文件中的命令模板。

## Local Environment

```bash
# 执行迁移脚本（根据项目实际的数据库容器名替换）
docker compose exec <db_container> psql -U <user> -d <db> -f /path/to/migration.sql

# 验证新表/字段
docker compose exec <db_container> psql -U <user> -d <db> -c "\d <table_name>"
```

## Execution Order
1. **SQL Schema Migration** — 先执行结构变更
2. **Seed Data** — 再执行基础数据初始化（如有）
3. **Restart Application** — 最后通过 `./update.sh` 或 `docker compose restart` 重启服务加载新代码
