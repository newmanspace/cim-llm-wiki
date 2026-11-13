// Package types defines all core domain types for cim-llm-wiki.
// These types flow through every pipeline stage: parser → extractor → evaluator → compiler.
package types

import "time"

// ─── 知识对象类型（共 19 种，见方案 §2.2）────────────────────────────────────

type ObjectType string

const (
	ObjProduct          ObjectType = "product"
	ObjVersion          ObjectType = "version"
	ObjProject          ObjectType = "project"
	ObjRequirement      ObjectType = "requirement"
	ObjModule           ObjectType = "module"
	ObjBusinessObject   ObjectType = "business_object"
	ObjBusinessRule     ObjectType = "business_rule"
	ObjScenario         ObjectType = "scenario"
	ObjInteraction      ObjectType = "interaction"
	ObjDesign           ObjectType = "design"
	ObjAPI              ObjectType = "api"
	ObjCode             ObjectType = "code"
	ObjTestCase         ObjectType = "test_case"
	ObjDefect           ObjectType = "defect"
	ObjRelease          ObjectType = "release"
	ObjDeployment       ObjectType = "deployment"
	ObjConfiguration    ObjectType = "configuration"
	ObjIncident         ObjectType = "incident"
	ObjFAQ              ObjectType = "faq"
	ObjKnowledgeArticle ObjectType = "knowledge_article"
)

// APIType 区分两大接口类别（见方案 §3.2）
type APIType string

const (
	APITypeUI       APIType = "ui_api"               // MES 内部前端接口
	APITypeExternal APIType = "external_integration" // CIM 分层外部集成接口
)

// IntegrationTier 对应 CIM 5 层集成体系（见方案 §3.2）
type IntegrationTier string

const (
	TierEngineering IntegrationTier = "engineering" // Tier1: PLM/CAPP
	TierBusiness    IntegrationTier = "business"    // Tier2: ERP
	TierAutomation  IntegrationTier = "automation"  // Tier3: EAP
	TierQuality     IntegrationTier = "quality"     // Tier4: QMS/SPC/YMS
	TierLogistics   IntegrationTier = "logistics"   // Tier5: WMS/AGV/MCS
)

// ReviewLevel 是评分后的审核分级门限（见方案 §4.3 & §5.3）
type ReviewLevel string

const (
	ReviewL0Auto   ReviewLevel = "L0_auto"   // score≥0.95 → 自动发布
	ReviewL1Expert ReviewLevel = "L1_expert" // 0.80≤score<0.95 → 专家审核
	ReviewL2Arch   ReviewLevel = "L2_arch"   // 0.55≤score<0.80 → 架构师裁决
	ReviewArchive  ReviewLevel = "archive"   // score<0.55 → 归档不编译
)

// NodeStatus 知识节点生命周期状态
type NodeStatus string

const (
	StatusDraft      NodeStatus = "draft"
	StatusPending    NodeStatus = "pending" // 待 HITL 审核
	StatusApproved   NodeStatus = "approved"
	StatusRejected   NodeStatus = "rejected"
	StatusDeprecated NodeStatus = "deprecated"
	StatusArchived   NodeStatus = "archived"
)

// ─── KnowledgeNode：流水线处理的原子单元────────────────────────────────────
// 经 compiler 写入后，每个 node 对应 wiki/ 下一个 Markdown 文件。

type KnowledgeNode struct {
	// 标识
	ID      string     `json:"id"` // 全局唯一，格式 TYPE-DOMAIN-SEQ，如 BR-WIP-001
	Type    ObjectType `json:"type"`
	Title   string     `json:"title"`
	Content string     `json:"content"` // Markdown 正文

	// 分类
	Product string `json:"product"` // 如 Semiconductor-MES
	Version string `json:"version"` // 如 V5.2
	Domain  string `json:"domain"`  // 如 manufacturing-execution
	Module  string `json:"module"`  // 如 wip-management

	// API 类节点专属字段
	APIType           APIType         `json:"api_type,omitempty"`
	IntegrationTier   IntegrationTier `json:"integration_tier,omitempty"`
	IntegrationSystem string          `json:"integration_system,omitempty"`
	ISA95Mapping      string          `json:"isa95_mapping,omitempty"`
	Endpoint          string          `json:"endpoint,omitempty"`
	Protocol          string          `json:"protocol,omitempty"`

	// 生命周期双向追溯关系（wikilink 格式，如 [[business/br-wip-001.md]]）
	RelatedRequirements []string `json:"related_requirements,omitempty"`
	RelatedDesigns      []string `json:"related_designs,omitempty"`
	RelatedRules        []string `json:"related_rules,omitempty"`
	RelatedAPIs         []string `json:"related_apis,omitempty"`
	RelatedCode         []string `json:"related_code,omitempty"`
	RelatedTests        []string `json:"related_tests,omitempty"`

	// 代码实现证据（见方案 §6.2，只建索引，不复制代码）
	CodeRepository string `json:"code_repository,omitempty"`
	CodeClass      string `json:"code_class,omitempty"`
	CodeMethod     string `json:"code_method,omitempty"`
	GitRef         string `json:"git_ref,omitempty"`

	// 溯源
	Source     string `json:"source"`      // raw/ 下的原始文档路径
	SourcePage int    `json:"source_page"` // 原始文档页码

	// 质量评估（由 evaluator 阶段填充）
	QScore       QualityScore `json:"q_score"`
	ReviewLevel  ReviewLevel  `json:"review_level"`
	ConflictWith []string     `json:"conflict_with,omitempty"` // 冲突节点 ID 列表

	// 生命周期
	Status     NodeStatus `json:"status"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
	VerifiedAt *time.Time `json:"verified_at,omitempty"`
}

// ─── QualityScore：7 维可解释质量评分（见方案 §4.3）─────────────────────────

type QualityScore struct {
	SAuth   float64 `json:"s_auth"`   // 来源可信度
	SComp   float64 `json:"s_comp"`   // 内容完整性
	SRel    float64 `json:"s_rel"`    // 产品相关性
	SFresh  float64 `json:"s_fresh"`  // 时效性
	SStruct float64 `json:"s_struct"` // 结构质量
	SReuse  float64 `json:"s_reuse"`  // 可复用性
	SRisk   float64 `json:"s_risk"`   // 冲突风险（越高则 Total 越低）
	Total   float64 `json:"total"`    // 加权总分 = Σ(wᵢ·Sᵢ)，S_risk 取 (1-SRisk)
}

// ─── ParsedDocument：解析阶段的中间产物────────────────────────────────────────

type ParsedDocument struct {
	Source   string            `json:"source"`    // 原始文件路径（raw/ 下）
	FileType string            `json:"file_type"` // pdf | docx | pptx | image | md | txt
	Engine   string            `json:"engine"`    // mineru | docling | ocr | simple
	Title    string            `json:"title"`
	Content  string            `json:"content"`  // 完整 Markdown 文本
	Tables   []ParsedTable     `json:"tables"`   // 结构化表格（保留原始结构）
	Metadata map[string]string `json:"metadata"` // 文档元信息（作者/日期/页数等）
}

type ParsedTable struct {
	Caption      string     `json:"caption"`
	Headers      []string   `json:"headers"`
	Rows         [][]string `json:"rows"`
	MarkdownRepr string     `json:"markdown_repr"` // pipe-table 格式
}

// ─── ChangeBundle：HITL 审核单元（见方案 §5.1）──────────────────────────────
// 一次文档解析产生的所有节点，聚合为一个 ChangeBundle 推送给审核工作台。

type ChangeBundle struct {
	ID          string          `json:"id"` // CR-YYYYMMDD-NNN
	SourceDoc   string          `json:"source_doc"`
	Module      string          `json:"module"`
	Nodes       []KnowledgeNode `json:"nodes"`
	ReviewLevel ReviewLevel     `json:"review_level"` // 取 nodes 中最高风险级别
	Status      BundleStatus    `json:"status"`
	Reviewer    string          `json:"reviewer,omitempty"`
	ReviewNote  string          `json:"review_note,omitempty"`
	GitCommit   string          `json:"git_commit,omitempty"` // 审核通过后的 commit hash
	CreatedAt   time.Time       `json:"created_at"`
	ReviewedAt  *time.Time      `json:"reviewed_at,omitempty"`
}

type BundleStatus string

const (
	BundlePending  BundleStatus = "pending"
	BundleApproved BundleStatus = "approved"
	BundleRejected BundleStatus = "rejected"
	BundleReverted BundleStatus = "reverted"
)

// ─── LintIssue：12 维 Lint 巡检发现项（见方案 §7.2）─────────────────────────

type LintRule string

const (
	LintBrokenLink      LintRule = "broken_link"
	LintOrphan          LintRule = "orphan_knowledge"
	LintDuplicate       LintRule = "duplicate_knowledge"
	LintVersionConflict LintRule = "version_conflict"
	LintReqNoDesign     LintRule = "req_without_design"
	LintReqNoTest       LintRule = "req_without_test"
	LintRuleNoCode      LintRule = "rule_without_code"
	LintAPINoTest       LintRule = "api_without_test"
	LintReleaseNoDeploy LintRule = "release_without_deploy"
	LintOutdated        LintRule = "outdated_knowledge"
	LintMissingSource   LintRule = "missing_source"
	LintMetadataError   LintRule = "metadata_error"
)

type LintSeverity string

const (
	SeverityInfo    LintSeverity = "info"
	SeverityWarning LintSeverity = "warning"
	SeverityError   LintSeverity = "error"
)

type LintIssue struct {
	Rule        LintRule     `json:"rule"`
	Severity    LintSeverity `json:"severity"`
	File        string       `json:"file"` // wiki/ 下的相对路径
	NodeID      string       `json:"node_id,omitempty"`
	Description string       `json:"description"`
	Suggestion  string       `json:"suggestion"`
	AutoFixed   bool         `json:"auto_fixed"`
}

// ─── Project Registry：Project ↔ Documents ↔ Code Repos 关联（Admin 下发）────

// ProjectToken 是 Admin 系统为每个 Project 签发的访问凭证。
// skill 使用此 token 调用 Admin API 获取项目配置、回写同步状态。
type ProjectToken struct {
	ProjectID string   `json:"project_id"` // 如 mes-wip
	Token     string   `json:"token"`      // JWT 或 opaque token
	AdminURL  string   `json:"admin_url"`  // Admin API base URL，如 https://admin.internal/api/v1
	ExpiresAt string   `json:"expires_at"` // ISO8601 过期时间
	Scopes    []string `json:"scopes"`     // 权限范围：read_config / write_status / trigger_sync
}

// ProjectConfig 是 Admin 下发的项目配置（skill 本地缓存于 data/documents/project-registry.json）。
type ProjectConfig struct {
	ID      string `json:"id"`      // 全局唯一，如 mes-wip
	Name    string `json:"name"`    // 人读名称
	Product string `json:"product"` // 如 Semiconductor-MES
	Version string `json:"version"` // 如 V2.22.4

	Docs    []DocSource   `json:"docs"`    // 关联的源文档
	Repos   []RepoBinding `json:"repos"`   // 关联的代码仓库
	Modules []string      `json:"modules"` // 业务模块列表

	WikiNodes ProjectWikiIndex `json:"wiki_nodes"` // 已生成的知识节点索引
	SyncState SyncState        `json:"sync_state"` // 增量同步状态

	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

// DocSource 描述项目关联的一份源文档。
type DocSource struct {
	DocID      string   `json:"doc_id"`      // 文档唯一标识，如 IDD-WIP-V2.22.4
	Path       string   `json:"path"`        // 本地路径（相对于项目根），如 data/sources/mes-wip/docs/idd_wip.md
	Type       string   `json:"type"`        // 文档类型：IDD / SDD / PRD / user-manual / admin-manual / ops-manual / release
	Submodule  string   `json:"submodule"`   // 所属 git submodule 路径（如 data/sources/mes-wip/docs）
	SHA256     string   `json:"sha256"`      // 文档内容哈希，用于变更检测
	IngestedAt string   `json:"ingested_at"` // 上次摄取时间
	Bundles    []string `json:"bundles"`     // 关联的 ChangeBundle ID 列表
}

// RepoBinding 描述项目关联的代码仓库及其模块映射。
type RepoBinding struct {
	Type             string            `json:"type"`
	Subpath          string            `json:"subpath"`
	RevisionSelector string            `json:"revision_selector"`
	Enabled          *bool             `json:"enabled,omitempty"`
	ConfigRevision   int               `json:"config_revision"`
	Auth             string            `json:"auth"`
	Name             string            `json:"name"`           // 仓库名称
	URL              string            `json:"url"`            // git clone URL
	Branch           string            `json:"branch"`         // 跟踪分支，默认 main
	Submodule        string            `json:"submodule"`      // 本地 submodule 路径（如 data/sources/mes-wip/code）
	ModuleMapping    map[string]string `json:"module_mapping"` // 代码路径前缀 → 业务模块 ID
	LastSyncSHA      string            `json:"last_sync_sha"`  // 上次同步的 git commit SHA
	SyncedAt         string            `json:"synced_at"`      // 上次同步时间
}

// ProjectWikiIndex 索引项目已生成的 wiki 页面路径。
type ProjectWikiIndex struct {
	Doc  []string `json:"doc"`  // doc/ 平面下的 wiki 页面路径
	Code []string `json:"code"` // code/ 平面下的 wiki 页面路径
}

// SyncState 记录增量同步状态。
type SyncState struct {
	LastDocSync    string `json:"last_doc_sync"`   // 上次文档同步时间
	LastCodeSync   string `json:"last_code_sync"`  // 上次代码同步时间
	PendingChanges int    `json:"pending_changes"` // 待处理变更数
	LastError      string `json:"last_error"`      // 上次同步错误（空=成功）
}

// ProjectRegistry 是 project-registry.json 的顶层结构。
// key 为 project ID，value 为 ProjectConfig。
type ProjectRegistry map[string]*ProjectConfig

// ─── SearchQuery / SearchResult：混合检索（见方案 §7.1）─────────────────────

type SearchQuery struct {
	Query           string          `json:"query"`
	Product         string          `json:"product,omitempty"`
	Version         string          `json:"version,omitempty"`
	Module          string          `json:"module,omitempty"`
	ObjectTypes     []ObjectType    `json:"object_types,omitempty"`
	APIType         APIType         `json:"api_type,omitempty"`
	IntegrationTier IntegrationTier `json:"integration_tier,omitempty"`
	TopK            int             `json:"top_k"`
}

type SearchResult struct {
	Node      KnowledgeNode `json:"node"`
	Score     float64       `json:"score"`
	MatchType string        `json:"match_type"` // bm25 | vector | relation
}
