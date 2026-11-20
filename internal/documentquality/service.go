package documentquality

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

type Record map[string]any
type Tx interface {
	Get(string, string) (Record, error)
	List(string) ([]Record, error)
	Insert(string, Record) (Record, error)
	Update(string, string, int, Record) (Record, error)
}
type Repository interface {
	WithProject(context.Context, string, string, func(Tx) error) error
}
type Service struct{ Repository Repository }
type Error struct {
	Status   int
	Message  string
	Code     string
	Existing Record
}

func (e *Error) Error() string                 { return e.Message }
func problem(status int, message string) error { return &Error{Status: status, Message: message} }
func Text(r Record, key string) string {
	v, _ := r[key].(string)
	return v
}
func number(r Record, key string) float64 {
	switch v := r[key].(type) {
	case float64:
		return v
	case int:
		return float64(v)
	default:
		return 0
	}
}
func object(r Record, key string) map[string]any {
	v, _ := r[key].(map[string]any)
	return v
}
func copyRecord(r Record) Record {
	b, _ := json.Marshal(r)
	var n Record
	_ = json.Unmarshal(b, &n)
	return n
}
func id(r Record) string    { return Text(r, "id") }
func revision(r Record) int { return int(number(r, "revision")) }
func required(r Record, keys ...string) error {
	for _, k := range keys {
		if strings.TrimSpace(Text(r, k)) == "" {
			return problem(422, k+" is required")
		}
	}
	return nil
}
func policies(tx Tx) ([]Policy, error) {
	rows, err := tx.List("quality_policies")
	if err != nil {
		return nil, err
	}
	latest := map[string]Policy{}
	for _, r := range rows {
		p := Policy{Path: Text(r, "path"), Revision: int(number(r, "policy_revision")), Patch: object(r, "patch")}
		if p.Revision > latest[p.Path].Revision {
			latest[p.Path] = p
		}
	}
	out := []Policy{}
	for _, p := range latest {
		out = append(out, p)
	}
	return out, nil
}
func effective(tx Tx, path string) (Effective, error) {
	p, err := policies(tx)
	if err != nil {
		return Effective{}, err
	}
	return Resolve(p, path)
}
func folder(path string) string {
	i := strings.LastIndex(path, "/")
	if i < 0 {
		return ""
	}
	return path[:i]
}
func nonPublishing(tx Tx) error {
	rows, e := tx.List("publications")
	if e != nil {
		return e
	}
	for _, r := range rows {
		if Text(r, "status") == "publishing" {
			return problem(409, "A publication is in progress; reconcile it before changing configuration")
		}
	}
	return nil
}

// Execute serializes project mutations with their idempotency receipt in one transaction.
func (s Service) Execute(ctx context.Context, project, actor, operation, key string, input Record) (Record, error) {
	if key == "" || len(key) > 200 {
		return nil, problem(422, "Idempotency-Key is required")
	}
	if project == "" || actor == "" {
		return nil, problem(403, "Project and authenticated actor are required")
	}
	var out Record
	err := s.Repository.WithProject(ctx, project, actor, func(tx Tx) error {
		receipts, e := tx.List("command_receipts")
		if e != nil {
			return e
		}
		digest := commandDigest(operation, input)
		for _, r := range receipts {
			if Text(r, "operation") == operation && Text(r, "key") == key {
				if Text(r, "request_digest") != digest {
					return problem(409, "Idempotency key was used with different input")
				}
				out = Record(object(r, "response"))
				return nil
			}
		}
		out, e = s.executeOperation(tx, actor, operation, input)
		if e != nil {
			return e
		}
		_, e = tx.Insert("command_receipts", Record{
			"operation":      operation,
			"key":            key,
			"request_digest": digest,
			"response":       out,
		})
		return e
	})
	return out, err
}

func commandDigest(operation string, input Record) string {
	if operation == "reserve-document-identity" {
		return Digest(Record{"doc_type": input["doc_type"], "module": input["module"], "topic": input["topic"]})
	}
	return Digest(input)
}
func populateArtifactWorkflowStates(tx Tx, rows []Record) error {
	hasWorkflow := false
	for _, row := range rows {
		if Text(row, "workflow_version") != "" {
			hasWorkflow = true
			break
		}
	}
	if !hasWorkflow {
		return nil
	}
	states, err := tx.List("document_states")
	if err != nil {
		return err
	}
	for index, row := range rows {
		rows[index] = projectDocumentState(row, states)
	}
	return nil
}

func filterLiveDirectories(rows []Record) []Record {
	active := []Record{}
	for _, row := range rows {
		if liveDirectory(row) {
			active = append(active, row)
		}
	}
	return active
}

func (s Service) Read(ctx context.Context, project, actor, resource string) ([]Record, error) {
	var rows []Record
	err := s.Repository.WithProject(ctx, project, actor, func(tx Tx) error {
		var e error
		rows, e = tx.List(resource)
		if e != nil || resource != "artifact_versions" {
			return e
		}
		return populateArtifactWorkflowStates(tx, rows)
	})
	if resource == "directories" {
		rows = filterLiveDirectories(rows)
	}
	return rows, err
}
func (s Service) Policy(ctx context.Context, project, actor, path string) (Effective, error) {
	var p Effective
	e := s.Repository.WithProject(ctx, project, actor, func(tx Tx) error {
		var err error
		p, err = effective(tx, path)
		return err
	})
	return p, e
}
func (s Service) executeOperation(tx Tx, actor, operation string, input Record) (Record, error) {
	handlers := map[string]func(Tx, Record) (Record, error){
		"naming-settings":           saveNamingSettings,
		"reserve-document-identity": reserveDocumentIdentity,
		"document-drafts": func(tx Tx, r Record) (Record, error) {
			return saveDocument(tx, r, "draft")
		},
		"document-submit": func(tx Tx, r Record) (Record, error) {
			return saveDocument(tx, r, "submitted")
		},
		"document-freeze":          freezeDocument,
		"document-review-requests": requestDocumentReview,
	}
	if handler := handlers[operation]; handler != nil {
		if err := nonPublishing(tx); err != nil {
			return nil, err
		}
		return handler(tx, input)
	}
	return s.mutate(tx, actor, operation, input)
}
func (s Service) mutate(tx Tx, actor, op string, r Record) (Record, error) {
	if op != "publication-start" && op != "publication-finish" && op != "ingest-runs" {
		if e := nonPublishing(tx); e != nil {
			return nil, e
		}
	}

	switch op {
	case "data-sources":
		return saveSource(tx, r)
	case "document-directories":
		return saveDirectory(tx, r)
	case "quality-policies":
		return savePolicy(tx, r)
	case "ingest-runs":
		return saveRun(tx, r)
	case "source-observations":
		return saveObservation(tx, r)
	case "artifacts":
		return saveArtifact(tx, r)
	case "document-evaluations":
		return saveEvaluation(tx, r)
	case "document-review-decisions":
		return saveDecision(tx, actor, r)
	case "publication-start":
		return beginPublication(tx, r)
	case "publication-finish":
		return finishPublication(tx, r)
	default:
		return nil, problem(404, "Unknown document quality operation")
	}
}
func saveSource(tx Tx, r Record) (Record, error) {
	normalized, e := NormalizeSourceConfig(r)
	if e != nil {
		return nil, e
	}
	kind := Text(normalized, "type")
	remote := Text(normalized, "url")
	auth := Text(normalized, "auth")
	sub := Text(normalized, "subpath")
	selector := Text(normalized, "revision_selector")
	if e := nonPublishing(tx); e != nil {
		return nil, e
	}
	name := Text(r, "name")
	var current Record
	if Text(r, "id") != "" {
		current, e = tx.Get("data_sources", Text(r, "id"))
		if e != nil {
			return nil, e
		}
		if Text(current, "type") != kind {
			return nil, problem(409, "Create a new data source to change its repository type")
		}
		if int(number(r, "expected_revision")) != revision(current) {
			return nil, problem(409, "Data source revision changed")
		}
	} else {
		current, e = tx.Insert("data_sources", Record{"name": name, "type": kind, "enabled": true})
		if e != nil {
			return nil, e
		}
	}
	config := Record{
		"source_id":         id(current),
		"name":              name,
		"url":               remote,
		"subpath":           sub,
		"type":              kind,
		"revision_selector": selector,
		"auth":              auth,
		"config_revision":   number(current, "config_revision") + 1,
	}
	cfg, e := tx.Insert("source_revisions", config)
	if e != nil {
		return nil, e
	}
	return tx.Update("data_sources", id(current), revision(current), Record{
		"name":            name,
		"type":            kind,
		"enabled":         r["enabled"] != false,
		"config_id":       id(cfg),
		"config_revision": config["config_revision"],
	})
}
func savePolicy(tx Tx, r Record) (Record, error) {
	if expected := Text(r, "expected_digest"); expected != "" {
		current, e := effective(tx, Text(r, "path"))
		if e != nil {
			return nil, e
		}
		if current.Digest != expected {
			return nil, problem(409, "Inherited policy changed; preview again")
		}
	}
	path := Text(r, "path")
	if path != "" && !ValidPath(path, false) {
		return nil, problem(422, "Invalid policy directory")
	}
	patch := object(r, "patch")
	if patch == nil {
		return nil, problem(422, "Policy patch must be an object")
	}
	if e := nonPublishing(tx); e != nil {
		return nil, e
	}
	ps, e := policies(tx)
	if e != nil {
		return nil, e
	}
	n := 1
	found := false
	for i, p := range ps {
		if p.Path == path {
			found = true
			if int(number(r, "expected_revision")) != p.Revision {
				return nil, problem(409, "Policy revision changed")
			}
			n = p.Revision + 1
			ps[i] = Policy{path, n, patch}
		}
	}
	if !found {
		if number(r, "expected_revision") != 0 {
			return nil, problem(409, "Policy does not exist at expected revision")
		}
		ps = append(ps, Policy{path, n, patch})
	}
	if e := validateEffectivePolicies(ps); e != nil {
		return nil, e
	}
	return tx.Insert("quality_policies", Record{"path": path, "patch": patch, "policy_revision": n})
}
func saveArtifact(tx Tx, r Record) (Record, error) {
	requiredFields := []string{
		"run_id", "target_path", "content_uri", "content_sha256",
		"logical_key", "recipe_version", "parsed_uri", "document_contract_digest",
	}
	if e := required(r, requiredFields...); e != nil {
		return nil, e
	}
	if !ValidPath(Text(r, "target_path"), true) {
		return nil, problem(422, "Invalid artifact path")
	}
	run, e := tx.Get("ingest_runs", Text(r, "run_id"))
	if e != nil {
		return nil, e
	}
	if Text(run, "status") != "running" {
		return nil, problem(409, "Run is not active")
	}
	if e := validateArtifactSources(tx, r, run); e != nil {
		return nil, e
	}
	rows, e := tx.List("artifact_versions")
	if e != nil {
		return nil, e
	}
	previous, version, parent := artifactVersion(rows, r)
	if previous != nil {
		if e := linkRun(tx, "ingest_artifacts", "artifact_id", run, previous); e != nil {
			return nil, e
		}
		return documentArtifact(tx, id(previous))
	}

	out := Record{}
	artifactFields := []string{
		"document_id", "naming_digest", "run_id", "logical_key",
		"target_path", "content_uri", "content_sha256", "snapshot_path",
		"parsed_uri", "recipe_version", "source_links", "template_id",
		"document_contract_digest", "workflow_version", "workflow_state",
		"local_report", "parsed_sha256", "parsed_snapshot_path", "qscore",
		"package_sha256", "parsed_package_sha256", "parsed_source_id",
	}
	for _, field := range artifactFields {
		out[field] = r[field]
	}
	out["version"] = version
	out["parent_artifact_id"] = parent
	if parent != "" {
		if e = supersedePending(tx, parent); e != nil {
			return nil, e
		}
	}
	saved, e := tx.Insert("artifact_versions", out)
	if e != nil {
		return nil, e
	}
	if e = linkRun(tx, "ingest_artifacts", "artifact_id", run, saved); e != nil {
		return nil, e
	}
	return initializeDocumentState(tx, saved, r)
}
func saveDirectory(tx Tx, r Record) (Record, error) {
	return mutateDirectory(tx, r)
}

func validateEffectivePolicies(ps []Policy) error {
	for _, p := range ps {
		if _, e := Resolve(ps, p.Path); e != nil {
			return problem(422, fmt.Sprintf("Invalid effective policy at %s: %v", p.Path, e))
		}
	}
	return nil
}

func sameArtifactVersion(old, r Record) bool {
	if !sameDocumentEvidence(old, r) {
		return false
	}
	if !sameArtifactMeta(old, r) {
		return false
	}
	return sameArtifactContract(old, r)
}

func sameArtifactMeta(old, r Record) bool {
	return Text(old, "workflow_version") == Text(r, "workflow_version") &&
		Text(old, "workflow_state") == Text(r, "workflow_state") &&
		Text(old, "content_sha256") == Text(r, "content_sha256")
}

func sameArtifactContract(old, r Record) bool {
	if Text(old, "target_path") != Text(r, "target_path") ||
		Text(old, "recipe_version") != Text(r, "recipe_version") {
		return false
	}
	return Text(old, "template_id") == Text(r, "template_id") &&
		Text(old, "document_contract_digest") == Text(r, "document_contract_digest") &&
		Digest(old["source_links"]) == Digest(r["source_links"])
}

func ensureLatestArtifact(tx Tx, artifact Record, message string) error {
	rows, err := tx.List("artifact_versions")
	if err != nil {
		return err
	}
	for _, row := range rows {
		if Text(row, "logical_key") == Text(artifact, "logical_key") && number(row, "version") > number(artifact, "version") {
			return problem(409, message)
		}
	}
	return nil
}

func autoApprovalIneligible(eval Record, p Effective) bool {
	if p.RequireHuman || eval["needs_review"] == true {
		return true
	}
	return eval["total"] == nil || number(eval, "total") < p.Threshold
}

func verifyPublicationApproval(tx Tx, artifact, eval Record, p Effective) error {
	assessments, err := tx.List("evaluations")
	if err != nil {
		return err
	}
	latest := ""
	for _, assessment := range assessments {
		if Text(assessment, "artifact_id") == id(artifact) {
			latest = id(assessment)
		}
	}
	if latest != id(eval) {
		return problem(409, "A newer quality assessment supersedes this approval")
	}
	tasks, e := tx.List("review_tasks")
	if e != nil {
		return e
	}
	approved := false
	for _, task := range tasks {
		if Text(task, "evaluation_id") == id(eval) && Text(task, "status") == "approved" {
			if Text(task, "approval_mode") == "auto" && autoApprovalIneligible(eval, p) {
				return problem(409, "Automatic document approval is no longer eligible")
			}
			approved = true
		}
	}
	if !approved {
		return problem(409, "Document review approval is required")
	}
	return nil
}

func validateArtifactSources(tx Tx, r, run Record) error {
	links, ok := r["source_links"].([]any)
	if !ok || len(links) == 0 {
		return problem(422, "Source links are required")
	}
	for _, raw := range links {
		link, ok := raw.(map[string]any)
		if !ok {
			return problem(422, "Invalid source link")
		}
		source, e := tx.Get("source_versions", Text(Record(link), "source_version_id"))
		if e != nil {
			return e
		}
		if !sourceBelongsToRun(source, run) {
			return problem(409, "Source does not belong to the pinned run revision")
		}
	}
	return nil
}

func artifactVersion(rows []Record, r Record) (Record, int, string) {
	version := 1
	parent := ""
	for _, old := range rows {
		if Text(old, "logical_key") == Text(r, "logical_key") {
			if int(number(old, "version")) >= version {
				version = int(number(old, "version")) + 1
				parent = id(old)
			}
			if sameArtifactVersion(old, r) {
				return old, version, parent
			}
		}
	}
	return nil, version, parent
}
