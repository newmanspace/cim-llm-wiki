# GitHub 代码质量门禁

流水线由 `.github/workflows/quality.yml` 和 `codeql.yml` 定义。默认分支与 Pull Request 均运行检查；两条工作流另每周执行一次，以发现未改代码时新增的漏洞公告。公共 PR 使用 GitHub 托管 Runner，不向贡献者提供共享目录、业务文件或部署凭证。

## 必需检查

| 检查 | 内容 |
|---|---|
| JavaScript checks | ESLint 零警告及复杂度、安全规则，Node 全源码覆盖率，跨语言重复代码检查，根包与 Wiki 依赖审计 |
| Go checks | go vet、竞态测试、全服务覆盖率、gocyclo、govulncheck、服务构建 |
| Python checks | Ruff E9/F/B/S/C90 缺陷、安全与复杂度规则，编译和分支覆盖率 |
| Admin build | Vue/TypeScript 类型检查、生产构建、Vitest 全 src 覆盖率、依赖审计 |
| Wiki build | 在临时目录生成合规的合成 Wiki，执行静态站点构建 |
| Configuration checks | Compose 配置、actionlint 工作流验证 |
| Secret scan | Gitleaks 扫描完整 Git 历史，输出自动脱敏 |
| Quality Gate | 汇总上述任务；失败、取消、跳过均不算通过 |
| CodeQL | JavaScript/TypeScript、Go、Python 的 security-extended 分析 |

ESLint 使用推荐缺陷检查；允许现有 TypeScript explicit any、Vue 声明脚手架和既有路由组件命名，避免把本次安全门禁扩大成全面类型重构。新代码仍受未定义变量、未使用变量、错误处理及 Vue 语法规则约束。历史 `.qoder` 文档中的单条 `cimwt_xxx...` 占位令牌通过完整 fingerprint 精确豁免，不屏蔽整份文档或任何真实令牌。

站点构建使用 `scripts/ci-wiki-fixture.mjs` 在 Runner 临时目录生成样本。它拒绝向代码目录或非空目录写入；不读取、上传或发布生产知识库。构建任务不部署服务。业务目录中的 XLSX/PPTX、`.env` 和其他忽略文件不会被 CI 自动提交。

## 阈值与报告

- Node 与 Admin：行、语句、函数覆盖率均至少 80%，分支覆盖率至少 70%。未被测试加载的源文件计入分母；空测试集不能通过。
- Go：`internal` 与 `cmd` 的整体语句覆盖率至少 80%，包含未被测试触及的包；保留竞态检测。Go 原生覆盖率不提供分支覆盖率。
- Python：两个转换服务的行与分支联合覆盖率至少 80%；`tests/python` 的空测试集会产生 0% 并失败。
- JS/TS/Vue 与 Go 单函数圈复杂度不超过 15；Python 同一阈值。JS/TS/Vue 嵌套块深度不超过 4。结构类规则排除测试代码，缺陷规则仍检查测试代码。
- jscpd 扫描服务、工具、Admin、Python、Go、网关、独立 skill 客户端和 Wiki 配置；重复比例不超过 5%，片段需同时达到 10 行和 70 tokens。排除测试、依赖及生成文件，不使用历史重复豁免清单。
- npm 根包、Admin、Wiki 审计包含开发依赖，High/Critical 失败，Moderate 仍进入报告。使用官方 npm 审计接口，镜像不支持的接口不能视作“零漏洞”。Go 使用调用可达性分析；JSON 模式后独立检查实际 finding，发现涉及被调用符号的公告即失败，避免 JSON 输出模式的成功退出码造成漏拦；扫描工具可独立构建，但分析目标使用当前服务 Go 工具链，避免自动升级掩盖旧工具链漏洞。
- 现有 CodeQL、Gitleaks、类型检查、构建、Compose 和 actionlint 继续生效。Python 容器依赖审计、镜像扫描及端到端浏览器测试尚未接入，不宣称这些已被覆盖。

独立检查步骤在前一检查失败后继续执行（取消除外），作业仍保持失败。报告以 `node-quality-reports`、`go-quality-reports`、`python-quality-reports`、`admin-quality-reports` 上传至该次 Actions 运行，保留 14 天。Node/Python/Admin 提供覆盖率 HTML 和机器可读报告，Go 提供 coverprofile、HTML、测试 JSON 与漏洞 JSON。报告中只使用仓库源码与合成数据。

本次遵循“先增加规则，再统一修复”的顺序。基线见 [quality-baseline.md](quality-baseline.md)。基线不达标时保持 PR 红灯，不降低阈值、不关闭门禁、不伪造测试通过。

## 效率

检查作业并行运行，保留同分支新提交取消旧任务的设置。Wiki 构建只安装根包运行依赖，避免安装 ESLint、覆盖率工具等开发依赖；安装时不再隐式重复执行 npm 审计，审计改为独立、可见且强制的步骤。配置检查关闭 setup-go 的项目缓存，避免其较早保存的局部缓存占据 Go 测试缓存键。

2026-11-05 主分支运行 `42057208816`：Go 作业约 82 秒，根 npm 安装约 31 秒，Wiki 作业约 54 秒；最后一个检查结束到 Quality Gate 开始另有约 67 秒的 GitHub Runner 排队时间。排队属于托管平台调度，不能归因于测试本身。新规则增加的测试与扫描有额外成本，优化后的净耗时需以同类运行实测，不提前承诺加速比例。

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
npm run quality:lint
npm run test:coverage
npm run quality:duplicates
go vet ./internal/... ./cmd/...
go test -race -coverprofile=reports/go.cover -coverpkg=./internal/...,./cmd/... ./internal/... ./cmd/...
node scripts/check-go-coverage.mjs reports/go.cover
npm ci --prefix admin
npm run build --prefix admin
docker compose -f deploy/docker-compose.yml config --quiet
```

本地 Wiki 构建需设置 CIM_WIKI_WORKSPACE 和 WIKI_ROOT 指向生成的合成目录，避免使用真实业务数据。CodeQL 结果和 GitHub 强制阻断效果以实际 PR 运行记录为准。

## 门禁生效验证

在测试 PR 中暂时加入必然失败的用例，确认 Quality Gate 失败且 GitHub 显示禁止合并，再移除该用例。等待最新提交全部检查通过后才能合并。检查结果必须属于当前 PR 提交，不能使用先前提交的绿色结果。服务发布和代码合并是独立操作，本流水线不会自动部署业务服务。
