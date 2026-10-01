// Package compiler implements Stage 5 of the knowledge pipeline:
// []KnowledgeNode → wiki/ Markdown files with YAML Frontmatter.
//
// Each KnowledgeNode maps to exactly one file:
//
//   business_rule    → wiki/business/br-{id}.md
//   business_object  → wiki/business/bo-{id}.md
//   workflow         → wiki/business/wf-{id}.md
//   api              → wiki/apis/{id}.md
//   design           → wiki/designs/{id}.md
//   module           → wiki/modules/{id}.md
//   requirement      → wiki/requirements/{id}.md
//   test_case        → wiki/tests/{id}.md
//   release          → wiki/releases/{id}.md
//   deployment       → wiki/deployments/{id}.md
//   incident         → wiki/incidents/{id}.md
//   faq/knowledge    → wiki/knowledge/{id}.md
//
// The wiki/ root is a runtime-generated directory (.gitignore'd).
// It is managed as a git repo for atomic commit / rollback (§5.4).
package compiler

import (
"context"
"fmt"
"os"
"path/filepath"
"regexp"
"strings"
"text/template"
"time"

"cim-llm-wiki/internal/types"
)

// Compiler writes KnowledgeNodes to the wiki output directory.
type Compiler struct {
wikiRoot string
}

// New creates a Compiler that writes to wikiRoot.
// wikiRoot is created (with subdirectories) if it does not exist.
func New(wikiRoot string) (*Compiler, error) {
// Ensure all standard subdirectories exist
for _, sub := range wikiSubdirs {
if err := os.MkdirAll(filepath.Join(wikiRoot, sub), 0755); err != nil {
return nil, fmt.Errorf("compiler: mkdir %s: %w", sub, err)
}
}
return &Compiler{wikiRoot: wikiRoot}, nil
}

// wikiSubdirs are the standard subdirectories under wiki/.
var wikiSubdirs = []string{
"products", "projects", "requirements", "designs",
"modules", "business", "apis", "tests",
"releases", "deployments", "operations",
"incidents", "knowledge", "sources",
}

// Compile writes nodes to wiki/ and returns the list of written file paths.
// Only nodes with ReviewLevel L0_auto (auto-approved) should be passed here;
// nodes requiring HITL review are handled by the hitl package.
func (c *Compiler) Compile(_ context.Context, nodes []types.KnowledgeNode) ([]string, error) {
var written []string
for _, n := range nodes {
path, err := c.compileOne(n)
if err != nil {
return written, fmt.Errorf("compiler: node %s: %w", n.ID, err)
}
written = append(written, path)
}
return written, nil
}

// compileOne writes a single KnowledgeNode to wiki/ and returns the file path.
func (c *Compiler) compileOne(n types.KnowledgeNode) (string, error) {
subdir := typeToSubdir(n.Type)
filename := nodeFilename(n)
filePath := filepath.Join(c.wikiRoot, subdir, filename)

content, err := renderNode(n)
if err != nil {
return "", err
}
if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
return "", fmt.Errorf("write %s: %w", filePath, err)
}
return filePath, nil
}

// CompileVirtualDocument synthesises a long-form SDD/IDD view from all nodes
// belonging to moduleID (§5.2 – Virtual Document View).
// docType: "sdd" | "idd"
func (c *Compiler) CompileVirtualDocument(_ context.Context, moduleID, docType string) (string, error) {
// Walk business/ and apis/ to find nodes for this module
var sections []string
sections = append(sections, fmt.Sprintf("# %s – Virtual %s View\n\n> Auto-generated from atomic wiki nodes. Last rendered: %s\n\n",
moduleID, strings.ToUpper(docType), time.Now().Format("2006-01-02 15:04:05")))

dirs := []string{"modules", "business", "apis", "designs", "requirements"}
for _, dir := range dirs {
dirPath := filepath.Join(c.wikiRoot, dir)
entries, err := os.ReadDir(dirPath)
if err != nil {
continue
}
for _, e := range entries {
if e.IsDir() || !strings.HasSuffix(e.Name(), ".md") {
continue
}
raw, err := os.ReadFile(filepath.Join(dirPath, e.Name()))
if err != nil {
continue
}
content := string(raw)
// Include only nodes belonging to this module
if strings.Contains(content, "module: "+moduleID) ||
strings.Contains(content, "module: \""+moduleID+"\"") {
// Strip frontmatter, keep body
body := stripFrontmatter(content)
sections = append(sections, body+"\n\n---\n")
}
}
}
return strings.Join(sections, "\n"), nil
}

// ─── Rendering ───────────────────────────────────────────────────────────────

var pageTmpl = template.Must(template.New("wiki_page").Funcs(template.FuncMap{
	"mulf": func(a, b float64) float64 { return a * b },
}).Parse(`---
id: {{.ID}}
type: {{.Type}}{{if .APIType}}
api_type: {{.APIType}}{{end}}{{if .IntegrationTier}}
integration_tier: {{.IntegrationTier}}{{end}}{{if .IntegrationSystem}}
integration_system: {{.IntegrationSystem}}{{end}}{{if .ISA95Mapping}}
isa95_mapping: {{.ISA95Mapping}}{{end}}{{if .Endpoint}}
endpoint: "{{.Endpoint}}"{{end}}{{if .Protocol}}
protocol: {{.Protocol}}{{end}}
product: {{.Product}}
version: {{.Version}}
domain: {{.Domain}}
module: {{.Module}}
source: {{.Source}}{{if .RelatedRequirements}}
related_requirements:{{range .RelatedRequirements}}
  - "{{.}}"{{end}}{{end}}{{if .RelatedRules}}
related_rules:{{range .RelatedRules}}
  - "{{.}}"{{end}}{{end}}{{if .RelatedCode}}
related_code:{{range .RelatedCode}}
  - "{{.}}"{{end}}{{end}}{{if .RelatedTests}}
related_tests:{{range .RelatedTests}}
  - "{{.}}"{{end}}{{end}}{{if .CodeRepository}}
code_repository: {{.CodeRepository}}
code_class: {{.CodeClass}}
code_method: {{.CodeMethod}}
git_ref: {{.GitRef}}{{end}}
confidence: {{printf "%.4f" .QScore.Total}}
review_level: {{.ReviewLevel}}
status: {{.Status}}
created_at: {{.CreatedAt.Format "2006-01-02T15:04:05Z07:00"}}
updated_at: {{.UpdatedAt.Format "2006-01-02T15:04:05Z07:00"}}
---

# {{.Title}}
{{.Content}}

---
> **来源文档**: ` + "`{{.Source}}`" + `  
> **置信度**: {{printf "%.2f%%" (mulf .QScore.Total 100)}}  
> **适用版本**: {{.Version}}
`))

func renderNode(n types.KnowledgeNode) (string, error) {
	var buf strings.Builder
	if err := pageTmpl.Execute(&buf, n); err != nil {
		return "", fmt.Errorf("render template: %w", err)
	}
	return buf.String(), nil
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// typeToSubdir maps ObjectType to the wiki/ subdirectory.
func typeToSubdir(t types.ObjectType) string {
switch t {
case types.ObjBusinessRule, types.ObjBusinessObject, types.ObjWorkflow:
return "business"
case types.ObjAPI:
return "apis"
case types.ObjDesign:
return "designs"
case types.ObjModule:
return "modules"
case types.ObjRequirement, types.ObjProject:
return "requirements"
case types.ObjTestCase:
return "tests"
case types.ObjRelease:
return "releases"
case types.ObjDeployment:
return "deployments"
case types.ObjIncident, types.ObjDefect:
return "incidents"
case types.ObjFAQ, types.ObjKnowledgeArticle:
return "knowledge"
default:
return "knowledge"
}
}

// nodeFilename generates the wiki filename from a node's ID.
// e.g. BR-WIP-001 → br-wip-001.md
var nonAlnum = regexp.MustCompile(`[^a-z0-9-]`)

func nodeFilename(n types.KnowledgeNode) string {
slug := strings.ToLower(n.ID)
slug = nonAlnum.ReplaceAllString(slug, "-")
slug = regexp.MustCompile(`-+`).ReplaceAllString(slug, "-")
slug = strings.Trim(slug, "-")
if slug == "" {
slug = "unknown-" + fmt.Sprintf("%d", time.Now().UnixNano())
}
return slug + ".md"
}

// stripFrontmatter removes the YAML frontmatter block from a wiki page.
func stripFrontmatter(content string) string {
if !strings.HasPrefix(content, "---") {
return content
}
parts := strings.SplitN(content, "---", 3)
if len(parts) >= 3 {
return strings.TrimSpace(parts[2])
}
return content
}
