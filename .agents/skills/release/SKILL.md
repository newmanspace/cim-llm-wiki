---
name: release
description: >
  执行版本发布流程，包含版本号确认、Release Notes 生成和发布前验证。
  不负责实际的容器构建和部署执行（交由 deploy）。
---

# 版本发布 (Release)

本技能负责执行完整的版本发布流程，确保每次发布都遵循语义化版本规范，并生成完整的发布材料。

## 发布流程 (Release Workflow)

### 1. 版本号确认 (Version Check)

确认本次发布的版本号遵循 **Semantic Versioning** 格式：`MAJOR.MINOR.PATCH`

| 版本类型 | 使用场景 |
|---------|---------|
| **MAJOR** | 不兼容的 API 变更 |
| **MINOR** | 向后兼容的功能增加 |
| **PATCH** | 向后兼容的问题修复 |

**检查项**:
- [ ] 当前版本号是什么？
- [ ] 本次变更类型（新功能/Bug 修复/破坏性变更）？
- [ ] 新版本号是否合理？

---

### 2. 生成 Release Notes

生成 Release Notes 更新内容，格式参照模板：
**[release-notes-template.md](./assets/release-notes-template.md)**

**检查项**:
- [ ] CHANGELOG.md 已更新
- [ ] 版本号与 Git tag 一致
- [ ] 日期格式正确 (ISO 8601)

---

### 3. 数据库迁移脚本检查 (SQL Migration Check)

检查本次发布是否包含数据库 Schema 变更：

```bash
# 检查新增的迁移脚本
ls -la deploy/init-scripts/*.sql
```

**检查项**:
- [ ] 迁移脚本命名规范
- [ ] 脚本幂等性 (使用 `IF NOT EXISTS` / `IF EXISTS`)
- [ ] 索引命名规范
- [ ] 已准备生产环境执行命令

> 具体执行命令参见 **[sql-migration-commands.md](./references/sql-migration-commands.md)**

---

### 4. 配置文件检查 (Config Check)

检查所有配置文件的版本号是否同步更新：

**检查清单**:
- [ ] `pyproject.toml` - `version` 字段
- [ ] 主模块 `__init__.py` - `__version__` (如存在)
- [ ] `.env.example` - 新增的环境变量
- [ ] `docker-compose.yml` - 镜像 tag

---

### 5. 发布前验证 (Pre-release Checklist)

**必须全部满足**:
- [ ] 所有 `pytest` 测试通过（零失败）
- [ ] 代码覆盖率 >80%
- [ ] `ruff check` 无问题
- [ ] 无 Critical/High 级别 Code Review 问题
- [ ] 安全审计通过（无硬编码密钥、SQL 参数化）
- [ ] 文档同步更新（README、API 文档）

**测试命令**:
```bash
# 运行测试并生成覆盖率
docker compose run --rm app pytest --cov=src --cov-report=html

# Ruff 检查
docker compose run --rm app ruff check --fix .
```

---

### 6. SQL 脚本执行 (SQL Migration Execution)

**执行顺序**: 数据库迁移必须在应用部署之前执行。具体命令参见 **[sql-migration-commands.md](./references/sql-migration-commands.md)**。

**检查项**:
- [ ] SQL 脚本执行无错误
- [ ] 新表/字段/索引已创建
- [ ] 数据迁移完成（如有）

---

### 7. 配置文件更新 (Config Update)

更新所有配置文件中的版本号和新增配置：

**需要更新的文件**:
| 文件 | 字段 | 示例 |
|------|------|------|
| `pyproject.toml` | `version` | `version = "X.Y.Z"` |
| 主模块 `__init__.py` | `__version__` | `__version__ = "X.Y.Z"` |
| `.env.example` | 新增环境变量 | `NEW_FEATURE_ENABLED=true` |
| `docker-compose.yml` | 镜像 tag | `image: app:vX.Y.Z` |

**新增环境变量同步**:
- 本地 `.env` 文件
- 生产环境 `.env` 文件（需 SSH 更新）

**检查项**:
- [ ] 所有配置文件版本号一致
- [ ] 新增环境变量已添加
- [ ] 敏感配置未提交到 git

---

### 8. 基础数据初始化 (Seed Data)

如本次发布包含基础数据/字典数据变更，需执行 seed 数据脚本。具体命令参见 **[sql-migration-commands.md](./references/sql-migration-commands.md)**。

**检查是否有初始化脚本**:
```bash
ls -la deploy/init-scripts/seed-*.sql
```

**检查项**:
- [ ] 基础数据已插入
- [ ] 数据字典已更新
- [ ] 无重复数据冲突

---

### 9. 应用部署 (Deploy Application)

**执行部署**:
```bash
./deploy/deploy.sh
```

**部署后验证**:
- [ ] 健康检查通过：`curl http://localhost:8000/health`
- [ ] 容器正常运行：`docker compose ps`
- [ ] 日志无 ERROR：`docker compose logs -f app`
- [ ] 核心功能调用正常
- [ ] 新功能验证通过

---

### 10. Git Tag 与 Release

**打 Tag**:
```bash
git tag -a vX.Y.Z -m "Release version X.Y.Z"
git push origin vX.Y.Z
```

**发布检查**:
- [ ] Git tag 已创建并推送
- [ ] GitHub Release 已创建（如适用）
- [ ] CHANGELOG.md 已推送

---

## 输出动作

触发 `/release` 技能后，将依次执行：

1. **版本确认** - 询问用户本次发布类型和版本号
2. **生成 Release Notes** - 输出 CHANGELOG 更新内容
3. **SQL 脚本检查** - 列出迁移脚本及生产执行命令
4. **配置文件检查** - 列出需更新的文件和当前版本号
5. **发布前验证** - 运行测试和检查清单
6. **SQL 迁移执行** - 执行数据库迁移脚本（本地 + 生产）
7. **配置文件更新** - 更新版本号和新增环境变量
8. **基础数据初始化** - 执行 seed 数据脚本（如有）
9. **等待用户 Approve** - 所有准备完成后等待确认
10. **应用部署** - 用户确认后执行部署
11. **Git Tag** - 打 tag 并推送

---

## ⛔ 红线约束

- **禁止跳过检查**: 任何一项检查不通过都不得继续
- **禁止自动推送**: Git push 和部署必须等待用户明确确认
- **执行顺序严格**: 必须按 SQL→配置→数据→应用 顺序执行
- **回滚预案**: 发布前必须确认回滚方案可用

---

## 回滚操作

```bash
# 停止当前容器
docker compose down

# 回退到上一个版本
git checkout HEAD~1 -- .
./deploy/deploy.sh
```
