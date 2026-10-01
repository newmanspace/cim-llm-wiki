// Package evaluator implements Stage 3 of the knowledge pipeline:
// []KnowledgeNode → []KnowledgeNode with QualityScore + ReviewLevel assigned.
//
// Scoring formula (see spec §4.3):
//   Total = Σ(wᵢ · Sᵢ),  i ∈ {auth, comp, rel, fresh, struct, reuse, risk}
//   S_risk is inverted: its contribution = w_risk × (1 − S_risk)
//
// POC initial weights are in config.EvaluatorConfig; they MUST be calibrated
// against a Golden Dataset before production deployment.
package evaluator

import (
"context"
"math"
"regexp"
"strings"
"time"

"cim-llm-wiki/internal/config"
"cim-llm-wiki/internal/types"
)

// Evaluator scores knowledge nodes on 7 dimensions and assigns a ReviewLevel.
type Evaluator struct {
cfg *config.EvaluatorConfig
}

// New creates an Evaluator from config.
func New(cfg *config.EvaluatorConfig) *Evaluator {
return &Evaluator{cfg: cfg}
}

// Evaluate scores all nodes and sets QScore + ReviewLevel.
// Conflict detection uses a simple ID-based index over the current batch;
// cross-batch conflict detection is handled by the lint runner (§7.2 rule 4).
func (e *Evaluator) Evaluate(_ context.Context, nodes []types.KnowledgeNode) []types.KnowledgeNode {
// Build ID index for intra-batch conflict detection
idIndex := make(map[string]string, len(nodes)) // id → content hash

for i := range nodes {
n := &nodes[i]

score := e.score(n)
n.QScore = score
n.ReviewLevel = e.classify(score.Total)

// Intra-batch conflict: same ID, different content
if prev, exists := idIndex[n.ID]; exists {
if prev != n.Content {
n.ConflictWith = append(n.ConflictWith, n.ID)
}
} else {
idIndex[n.ID] = n.Content
}
}
return nodes
}

// classify maps a total score to a ReviewLevel gate.
func (e *Evaluator) classify(total float64) types.ReviewLevel {
switch {
case total >= e.cfg.ThreshL0Auto:
return types.ReviewL0Auto
case total >= e.cfg.ThreshL1Expert:
return types.ReviewL1Expert
case total >= e.cfg.ThreshL2Arch:
return types.ReviewL2Arch
default:
return types.ReviewArchive
}
}

// score computes all 7 dimension scores and the weighted total.
func (e *Evaluator) score(n *types.KnowledgeNode) types.QualityScore {
sAuth   := e.scoreAuthority(n)
sComp   := e.scoreCompleteness(n)
sRel    := e.scoreRelevance(n)
sFresh  := e.scoreFreshness(n)
sStruct := e.scoreStructure(n)
sReuse  := e.scoreReusability(n)
sRisk   := e.scoreRisk(n)

total := e.cfg.WAuth*sAuth +
e.cfg.WComp*sComp +
e.cfg.WRel*sRel +
e.cfg.WFresh*sFresh +
e.cfg.WStruct*sStruct +
e.cfg.WReuse*sReuse +
e.cfg.WRisk*(1-sRisk) // risk is inverted

total = math.Round(math.Min(math.Max(total, 0), 1)*10000) / 10000

return types.QualityScore{
SAuth:   sAuth,
SComp:   sComp,
SRel:    sRel,
SFresh:  sFresh,
SStruct: sStruct,
SReuse:  sReuse,
SRisk:   sRisk,
Total:   total,
}
}

// ── S_auth: 来源可信度 ────────────────────────────────────────────────────────
// 官方设计文档 (.pdf / .docx / .pptx) > Markdown > 代码注释 > 未知
var trustedExts = []string{".pdf", ".docx", ".pptx", ".doc", ".ppt", ".xlsx"}

func (e *Evaluator) scoreAuthority(n *types.KnowledgeNode) float64 {
src := strings.ToLower(n.Source)
for _, ext := range trustedExts {
if strings.HasSuffix(src, ext) {
return 1.0
}
}
if strings.HasSuffix(src, ".md") || strings.HasSuffix(src, ".txt") {
return 0.75
}
if strings.Contains(src, "git") || strings.Contains(src, "commit") {
return 0.65
}
if n.Source == "" {
return 0.30
}
return 0.50
}

// ── S_comp: 内容完整性 ────────────────────────────────────────────────────────
// Required fields: id, type, title, content, domain, version, source
var requiredFields = []func(*types.KnowledgeNode) string{
func(n *types.KnowledgeNode) string { return n.ID },
func(n *types.KnowledgeNode) string { return string(n.Type) },
func(n *types.KnowledgeNode) string { return n.Title },
func(n *types.KnowledgeNode) string { return n.Content },
func(n *types.KnowledgeNode) string { return n.Domain },
func(n *types.KnowledgeNode) string { return n.Version },
func(n *types.KnowledgeNode) string { return n.Source },
}

func (e *Evaluator) scoreCompleteness(n *types.KnowledgeNode) float64 {
missing := 0
for _, f := range requiredFields {
if f(n) == "" {
missing++
}
}
return math.Max(0, 1.0-float64(missing)*0.15)
}

// ── S_rel: 产品相关性 ────────────────────────────────────────────────────────
func (e *Evaluator) scoreRelevance(n *types.KnowledgeNode) float64 {
s := 0.5
if n.Module != "" {
s += 0.20
}
if n.Version != "" {
s += 0.15
}
if n.Domain != "" {
s += 0.15
}
return math.Min(s, 1.0)
}

// ── S_fresh: 时效性 ────────────────────────────────────────────────────────
func (e *Evaluator) scoreFreshness(n *types.KnowledgeNode) float64 {
t := n.UpdatedAt
if t.IsZero() {
t = n.CreatedAt
}
if t.IsZero() {
return 0.60
}
days := time.Since(t).Hours() / 24
switch {
case days <= 90:
return 1.0
case days <= 365:
return 0.80
case days <= 730:
return 0.60
default:
return 0.40
}
}

// ── S_struct: 结构质量 ────────────────────────────────────────────────────────
var headingRe = regexp.MustCompile(`(?m)^#{1,3} `)

func (e *Evaluator) scoreStructure(n *types.KnowledgeNode) float64 {
c := n.Content
s := 0.4
if headingRe.MatchString(c) {
s += 0.20
}
if len(c) > 100 {
s += 0.15
}
if strings.Contains(c, "```") {
s += 0.15 // code block
}
if strings.Contains(c, "|") && strings.Contains(c, "---") {
s += 0.10 // markdown table
}
return math.Min(s, 1.0)
}

// ── S_reuse: 可复用性（关联关系数量）────────────────────────────────────────
func (e *Evaluator) scoreReusability(n *types.KnowledgeNode) float64 {
total := len(n.RelatedRequirements) + len(n.RelatedDesigns) +
len(n.RelatedRules) + len(n.RelatedAPIs) +
len(n.RelatedCode) + len(n.RelatedTests)
switch {
case total >= 4:
return 1.0
case total == 3:
return 0.85
case total == 2:
return 0.70
case total == 1:
return 0.55
default:
return 0.40
}
}

// ── S_risk: 冲突风险 ──────────────────────────────────────────────────────────
// High-risk keywords are core MES business logic that often conflicts across versions.
var highRiskKeywords = []string{
"hold", "release", "qtime", "state machine", "状态机",
"trackin", "trackout", "卡批", "解挂", "进站", "出站",
"plm", "erp", "bom", "route", "工艺路线",
}

func (e *Evaluator) scoreRisk(n *types.KnowledgeNode) float64 {
text := strings.ToLower(n.Content + " " + n.Title)
hits := 0
for _, kw := range highRiskKeywords {
if strings.Contains(text, kw) {
hits++
}
}
// Also boost risk if there are known conflicts
hits += len(n.ConflictWith) * 2

switch {
case hits >= 4:
return 0.9
case hits >= 2:
return 0.6
case hits == 1:
return 0.3
default:
return 0.1
}
}
