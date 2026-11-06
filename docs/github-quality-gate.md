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

本次先在独立提交接入规则并实测失败阻断，再统一修复。历史扫描和整改结果见 [quality-baseline.md](quality-baseline.md)。不降低阈值、不关闭门禁、不伪造测试通过。

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

## 密码配置迁移

`AUTH_PASSWORD_SHA256` 不再支持，启动时明确拒绝旧配置；请重新设置密码并用可信 bcrypt 工具生成 cost 至少 12 的摘要，改存为 `AUTH_PASSWORD_HASH`。摘要优先于开发环境的 `AUTH_PASSWORD`，无效摘要不能回退明文口令。保留会话 HMAC-SHA256 签名；密码存储与会话完整性使用不同机制。升级前完成配置迁移，避免登录不可用。

开启认证时，`AUTH_SESSION_SECRET` 必须是至少 32 字符的独立随机密钥；旧开发默认值会阻止启动。Compose 不再提供默认密码或默认签名密钥。无密码配置时登录拒绝访问；只有显式 `AUTH_ENABLED=false` 才保留透明门控。此 PR 不会自动重启或部署服务，升级前须完成配置迁移。

## 依赖兼容与测试范围

根包和 Admin 分别锁定修复后的 minimatch/glob，避免静态检查与测试工具继续引入已知拒绝服务漏洞；Wiki 的 Vite 固定在兼容的 6.4 补丁线，保留 VitePress 1.6.4，并通过合成站点构建验证。Go 升级至 1.26.10，更新受影响的 net/text/quic-go 依赖。Node 开发环境最低 22.22.2，对齐浏览器测试环境的依赖要求；独立 skill 客户端仍不需要 npm 安装。

Admin 测试保留 Vue 状态、事件、路由调用及国际化，使用 UI 组件替身隔离第三方控件；它们不等价于真实浏览器端到端测试。Python 测试使用真实 FastAPI 类型与临时文件，但模拟重量级转换引擎，不下载模型；不将适配层 100% 覆盖率解释为 Docling/MarkItDown 引擎质量保证。Go 管理接口测试使用每个测试独立的 PostgreSQL schema，测试结束后删除；CI 使用独立服务容器，不连接生产数据库。

覆盖率门槛针对所声明源码范围的整体结果，未测试文件也计入分母；不宣称每个文件均达到 80%。复杂度门槛针对生产源码，测试代码仍接受缺陷和安全检查。

具体正常文件/HTTP 数据流告警的复核依据见 [CodeQL 预期数据流复核](codeql-reviewed-flows.md)。这不是查询排除配置，也不豁免后续扩大输入或输出权限的修改。

## 依赖 PR 管理

Dependabot 每周检查依赖。GitHub Actions 按一组提交，确保 CodeQL init/analyze 一起升级；npm 和 Go 的补丁、次版本更新分别分组，主版本升级保留独立 PR 以核对迁移要求。安全更新继续沿用独立处理，不等待普通版本更新的分组周期。分组规则见 `.github/dependabot.yml`，语义参见 [GitHub Dependabot groups](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference#groups--)。

已有积压可汇总到一个 PR：保留来源 PR 和更新版本清单，解决组合冲突，核对主版本兼容性，并在当前提交通过全部门禁后合并。原 PR 仅在更新已进入主分支后按已替代关闭，不将原 PR 各自通过视作组合验证通过。不启用依赖更新自动合并，也不放宽现有门禁。

当前兼容性约束：Node 运行和 CI 基线为 22，`@types/node` 保留 22 系列；Vue 类型检查链使用 TypeScript 6 的编译器 API，暂不接受 TypeScript 7（PR #20 的 `vue-tsc` 构建已实测 `ERR_PACKAGE_PATH_NOT_EXPORTED`，新版 Volar 的 peer 范围也为 `<7`）。Dependabot 只忽略这两个已知不兼容版本范围，仍接收兼容系列的补丁和安全修复。升级 Node 基线、或 Vue 工具链支持 TypeScript 7 并通过构建后，应相应移除约束；不通过关闭类型检查来迁移。

Admin 使用 Vite 8 的 `rolldownOptions.output.codeSplitting` 保留 TDesign 分包，并显式保留升级前的 Chrome/Edge 107、Firefox 104、Safari 16 构建目标，避免默认浏览器基线悄然提高。Vue Router 5 沿用手工路由，新增真实路由测试覆盖 `/admin/` 基路径、默认重定向、命名路由、中文项目参数与查询参数；不宣称该测试覆盖浏览器完整界面。迁移依据：[Vite 8](https://vite.dev/guide/migration)、[Vue Router 5](https://router.vuejs.org/guide/migration/v4-to-v5.html)。
