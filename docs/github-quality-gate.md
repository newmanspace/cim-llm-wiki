# GitHub 代码质量门禁

流水线由 `.github/workflows/quality.yml` 和 `codeql.yml` 定义。默认分支与 Pull Request 均运行检查；CodeQL 另每周执行一次。公共 PR 使用 GitHub 托管 Runner，不向贡献者提供共享目录、业务文件或部署凭证。

## 必需检查

| 检查 | 内容 |
|---|---|
| JavaScript checks | 锁定依赖安装、ESLint（零警告）、Node 自动化测试 |
| Go checks | go vet、带竞态检测的测试、服务构建 |
| Python checks | Ruff 的语法/未定义/未使用检查、Python 编译 |
| Admin build | Vue/TypeScript 类型检查及生产构建 |
| Wiki build | 在临时目录生成合规的合成 Wiki，执行静态站点构建 |
| Configuration checks | Compose 配置、actionlint 工作流验证 |
| Secret scan | Gitleaks 扫描完整 Git 历史，输出自动脱敏 |
| Quality Gate | 汇总上述任务；失败、取消、跳过均不算通过 |
| CodeQL | JavaScript/TypeScript、Go、Python 的 security-extended 分析 |

ESLint 使用推荐缺陷检查；允许现有 TypeScript explicit any、Vue 声明脚手架和既有路由组件命名，避免把本次安全门禁扩大成全面类型重构。新代码仍受未定义变量、未使用变量、错误处理及 Vue 语法规则约束。历史 `.qoder` 文档中的单条 `cimwt_xxx...` 占位令牌通过完整 fingerprint 精确豁免，不屏蔽整份文档或任何真实令牌。

站点构建使用 `scripts/ci-wiki-fixture.mjs` 在 Runner 临时目录生成样本。它拒绝向代码目录或非空目录写入；不读取、上传或发布生产知识库。构建任务不部署服务。业务目录中的 XLSX/PPTX、`.env` 和其他忽略文件不会被 CI 自动提交。

## GitHub 设置

`.github/quality-ruleset.json` 声明默认分支规则：

- 必须经 PR 合并，禁止强制推送及删除分支。
- Quality Gate 和三个 CodeQL 分析任务必须成功，绑定 GitHub Actions 应用身份。
- 分支必须与目标分支保持最新，讨论线程必须解决。
- 原生 Code scanning 门禁阻断 High/Critical 安全告警及 errors；扫描任务成功并不代表没有告警。
- 不设置绕过角色。当前自动门禁不额外强制人工批准数量，可在确定团队审核人后提高 required_approving_review_count。

状态检查与原生 Code scanning 规则必须同时配置；单独上传 SARIF 不能保证漏洞阻断合并。配置语义参见 [GitHub Code scanning 合并保护](https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/manage-your-configuration/set-merge-protection)。

管理员确认现有规则后，可创建新的规则集，不覆盖其他规则：

```bash
gh api --method POST repos/newmanspace/cim-llm-wiki/rulesets \
  --input .github/quality-ruleset.json
```

重复配置时先查询同名规则，使用其 ID 更新，避免创建重复规则。公开仓库前先检查历史凭证和现有 Actions 日志；变更可见性会公开代码与 Actions 历史，参见 [GitHub 可见性说明](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility)。

## 本地验证

```bash
npm ci
npm run lint
npm test
go vet ./...
go test -race ./...
npm ci --prefix admin
npm run build --prefix admin
docker compose -f deploy/docker-compose.yml config --quiet
```

本地 Wiki 构建需设置 CIM_WIKI_WORKSPACE 和 WIKI_ROOT 指向生成的合成目录，避免使用真实业务数据。CodeQL 结果和 GitHub 强制阻断效果以实际 PR 运行记录为准。

## 门禁生效验证

在测试 PR 中暂时加入必然失败的用例，确认 Quality Gate 失败且 GitHub 显示禁止合并，再移除该用例。等待最新提交全部检查通过后才能合并。检查结果必须属于当前 PR 提交，不能使用先前提交的绿色结果。服务发布和代码合并是独立操作，本流水线不会自动部署业务服务。
