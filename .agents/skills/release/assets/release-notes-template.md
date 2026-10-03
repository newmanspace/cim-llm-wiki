# Release Notes Template

> 本模板用于 `release` 技能在版本发布时生成 CHANGELOG 条目。

## Review Profile
- **Release Date**: YYYY-MM-DD
- **Version**: vX.Y.Z
- **Release Type**: MAJOR / MINOR / PATCH
- **Releaser**: [Name]

---

## [vX.Y.Z] - YYYY-MM-DD

### Added
- 新增功能列表

### Fixed
- Bug 修复列表

### Changed
- 变更列表

### Security
- 安全相关修复

---

## Pre-release Checklist
- [ ] 所有 `pytest` 测试通过（零失败）
- [ ] 代码覆盖率 >80%
- [ ] `ruff check` 无问题
- [ ] 无 Critical/High 级别 Code Review 问题
- [ ] 安全审计通过（无硬编码密钥、SQL 参数化）
- [ ] 文档同步更新（README、API 文档）
- [ ] CHANGELOG.md 已更新
- [ ] 版本号与 Git tag 一致
