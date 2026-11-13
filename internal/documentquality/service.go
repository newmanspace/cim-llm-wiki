package documentquality

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
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
	Status  int
	Message string
}

func (e *Error) Error() string                 { return e.Message }
func problem(status int, message string) error { return &Error{status, message} }
func Text(r Record, key string) string         { v, _ := r[key].(string); return v }
func number(r Record, key string) float64 {
	switch v := r[key].(type) {
	case float64:
		return v
	case int:
		return float64(v)
	}
	return 0
}
func object(r Record, key string) map[string]any { v, _ := r[key].(map[string]any); return v }
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
		digest := Digest(input)
		for _, r := range receipts {
			if Text(r, "operation") == operation && Text(r, "key") == key {
				if Text(r, "request_digest") != digest {
					return problem(409, "Idempotency key was used with different input")
				}
				out = Record(object(r, "response"))
				return nil
			}
		}
		out, e = s.mutate(tx, actor, operation, input)
		if e != nil {
			return e
		}
		_, e = tx.Insert("command_receipts", Record{"operation": operation, "key": key, "request_digest": digest, "response": out})
		return e
	})
	return out, err
}
func (s Service) Read(ctx context.Context, project, actor, resource string) ([]Record, error) {
	var rows []Record
	err := s.Repository.WithProject(ctx, project, actor, func(tx Tx) error { var e error; rows, e = tx.List(resource); return e })
	if resource == "directories" {
		active := []Record{}
		for _, row := range rows {
			if liveDirectory(row) {
				active = append(active, row)
			}
		}
		rows = active
	}
	return rows, err
}
func (s Service) Policy(ctx context.Context, project, actor, path string) (Effective, error) {
	var p Effective
	e := s.Repository.WithProject(ctx, project, actor, func(tx Tx) error { var err error; p, err = effective(tx, path); return err })
	return p, e
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
	}
	return nil, problem(404, "Unknown document quality operation")
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
	config := Record{"source_id": id(current), "name": name, "url": remote, "subpath": sub, "type": kind, "revision_selector": selector, "auth": auth, "config_revision": number(current, "config_revision") + 1}
	cfg, e := tx.Insert("source_revisions", config)
	if e != nil {
		return nil, e
	}
	return tx.Update("data_sources", id(current), revision(current), Record{"name": name, "type": kind, "enabled": r["enabled"] != false, "config_id": id(cfg), "config_revision": config["config_revision"]})
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
	for _, p := range ps {
		if _, e = Resolve(ps, p.Path); e != nil {
			return nil, problem(422, fmt.Sprintf("Invalid effective policy at %s: %v", p.Path, e))
		}
	}
	return tx.Insert("quality_policies", Record{"path": path, "patch": patch, "policy_revision": n})
}
func saveRun(tx Tx, r Record) (Record, error) {
	if Text(r, "id") != "" {
		old, e := tx.Get("ingest_runs", Text(r, "id"))
		if e != nil {
			return nil, e
		}
		status := Text(r, "status")
		if status != "completed" && status != "partial" && status != "failed" && status != "cancelled" {
			return nil, problem(422, "Invalid terminal run status")
		}
		if Text(old, "status") != "running" {
			return nil, problem(409, "Run is already finished")
		}
		next := copyRecord(old)
		next["status"] = status
		next["error_code"] = r["error_code"]
		return tx.Update("ingest_runs", id(old), revision(old), next)
	}
	if Text(r, "status") == "failed" && Text(r, "error_code") != "" && Text(r, "operative_revision") == "" && Text(r, "commit_sha") == "" {
		source, e := tx.Get("data_sources", Text(r, "source_id"))
		if e != nil {
			return nil, e
		}
		cfg, e := tx.Get("source_revisions", Text(r, "source_config_id"))
		if e != nil {
			return nil, e
		}
		if Text(cfg, "source_id") != id(source) {
			return nil, problem(409, "Source configuration does not match")
		}
		return tx.Insert("ingest_runs", Record{"source_id": id(source), "source_config_id": id(cfg), "recipe_version": r["recipe_version"], "status": "failed", "error_code": r["error_code"], "source_type": Text(source, "type"), "failure_phase": Text(source, "type") + "_collection"})
	}
	if e := required(r, "source_id", "source_config_id", "recipe_version"); e != nil {
		return nil, e
	}
	source, e := tx.Get("data_sources", Text(r, "source_id"))
	if e != nil {
		return nil, e
	}
	cfg, e := tx.Get("source_revisions", Text(r, "source_config_id"))
	if e != nil {
		return nil, e
	}
	if source["enabled"] != true || Text(cfg, "source_id") != id(source) || Text(source, "config_id") != id(cfg) {
		return nil, problem(409, "Data source configuration is disabled or stale")
	}
	out := Record{"source_id": id(source), "source_config_id": id(cfg), "source_type": Text(source, "type"), "recipe_version": r["recipe_version"], "status": "running"}
	if Text(source, "type") == "git" {
		if !gitCommit.MatchString(Text(r, "commit_sha")) {
			return nil, problem(422, "Git collection requires a full pinned commit SHA")
		}
		remote, e := normalizeGitURL(Text(r, "repository_url"))
		if e != nil {
			return nil, e
		}
		if remote != Text(cfg, "url") {
			return nil, problem(409, "Git repository does not match the bound source configuration")
		}
		out["repository_url"] = remote
		out["commit_sha"] = r["commit_sha"]
	} else {
		if e := required(r, "operative_revision", "repository_uuid"); e != nil {
			return nil, e
		}
		if _, e := strconv.ParseUint(Text(r, "operative_revision"), 10, 64); e != nil {
			return nil, problem(422, "SVN revision must be fixed")
		}
		out["operative_revision"] = r["operative_revision"]
		out["repository_uuid"] = r["repository_uuid"]
	}
	return tx.Insert("ingest_runs", out)
}
func linkRun(tx Tx, kind, field string, run, record Record) error {
	links, e := tx.List(kind)
	if e != nil {
		return e
	}
	for _, link := range links {
		if Text(link, "run_id") == id(run) && Text(link, field) == id(record) {
			return nil
		}
	}
	_, e = tx.Insert(kind, Record{"run_id": id(run), field: id(record)})
	return e
}
func saveObservation(tx Tx, r Record) (Record, error) {
	if e := required(r, "run_id", "repository_path", "original_uri", "original_sha256"); e != nil {
		return nil, e
	}
	run, e := tx.Get("ingest_runs", Text(r, "run_id"))
	if e != nil {
		return nil, e
	}
	if sourceType(run) == "git" {
		if e := required(r, "git_info_uri", "git_blob_oid"); e != nil {
			return nil, e
		}
		if !gitCommit.MatchString(Text(r, "git_blob_oid")) {
			return nil, problem(422, "A full Git blob object ID is required")
		}
	} else {
		if e := required(r, "svn_info_uri"); e != nil {
			return nil, e
		}
	}
	if Text(run, "status") != "running" {
		return nil, problem(409, "Run is not active")
	}
	if len(Text(r, "original_sha256")) != 64 {
		return nil, problem(422, "Invalid source hash")
	}
	rows, e := tx.List("source_versions")
	if e != nil {
		return nil, e
	}
	for _, old := range rows {
		if Text(old, "source_id") == Text(run, "source_id") && repositoryIdentity(old) == repositoryIdentity(run) && Text(old, "repository_path") == Text(r, "repository_path") && sourceRevision(old) == sourceRevision(run) {
			if Text(old, "original_sha256") != Text(r, "original_sha256") {
				return nil, problem(409, "Same repository source version has different content")
			}
			if e := linkRun(tx, "ingest_sources", "source_version_id", run, old); e != nil {
				return nil, e
			}
			return old, nil
		}
	}
	outPayload := Record{"run_id": id(run), "source_id": run["source_id"], "source_type": sourceType(run), "repository_path": r["repository_path"], "original_uri": r["original_uri"], "original_sha256": r["original_sha256"], "snapshot_path": r["snapshot_path"], "provenance_method": "skill_observed"}
	if sourceType(run) == "git" {
		for _, field := range []string{"git_info_uri", "git_info_sha256", "git_blob_oid"} {
			outPayload[field] = r[field]
		}
		outPayload["repository_url"] = run["repository_url"]
		outPayload["commit_sha"] = run["commit_sha"]
	} else {
		outPayload["svn_info_uri"] = r["svn_info_uri"]
		outPayload["repository_uuid"] = run["repository_uuid"]
		outPayload["operative_revision"] = run["operative_revision"]
	}
	out, e := tx.Insert("source_versions", outPayload)
	if e != nil {
		return nil, e
	}
	if e = linkRun(tx, "ingest_sources", "source_version_id", run, out); e != nil {
		return nil, e
	}
	return out, nil

}
func saveArtifact(tx Tx, r Record) (Record, error) {
	if e := required(r, "run_id", "target_path", "content_uri", "content_sha256", "logical_key", "recipe_version", "parsed_uri"); e != nil {
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
	links, ok := r["source_links"].([]any)
	if !ok || len(links) == 0 {
		return nil, problem(422, "Source links are required")
	}
	for _, raw := range links {
		link, ok := raw.(map[string]any)
		if !ok {
			return nil, problem(422, "Invalid source link")
		}
		source, e := tx.Get("source_versions", Text(Record(link), "source_version_id"))
		if e != nil {
			return nil, e
		}
		if Text(source, "source_id") != Text(run, "source_id") || sourceRevision(source) != sourceRevision(run) {
			return nil, problem(409, "Source does not belong to the pinned run revision")
		}
	}
	rows, e := tx.List("artifact_versions")
	if e != nil {
		return nil, e
	}
	version := 1
	parent := ""
	for _, old := range rows {
		if Text(old, "logical_key") == Text(r, "logical_key") {
			if int(number(old, "version")) >= version {
				version = int(number(old, "version")) + 1
				parent = id(old)
			}
			if Text(old, "content_sha256") == Text(r, "content_sha256") && Text(old, "target_path") == Text(r, "target_path") && Text(old, "recipe_version") == Text(r, "recipe_version") && Digest(old["source_links"]) == Digest(r["source_links"]) {
				if e := linkRun(tx, "ingest_artifacts", "artifact_id", run, old); e != nil {
					return nil, e
				}
				return old, nil
			}
		}
	}
	out := Record{}
	for _, field := range []string{"run_id", "logical_key", "target_path", "content_uri", "content_sha256", "snapshot_path", "parsed_uri", "recipe_version", "source_links"} {
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
	return saved, nil
}
func supersedePending(tx Tx, artifactID string) error {
	tasks, e := tx.List("review_tasks")
	if e != nil {
		return e
	}
	for _, task := range tasks {
		if Text(task, "artifact_id") != artifactID || Text(task, "status") != "pending" {
			continue
		}
		next := copyRecord(task)
		next["status"] = "superseded"
		if _, e = tx.Insert("review_events", Record{"task_id": id(task), "decision": "supersede", "note": "A newer document revision or assessment supersedes this pending task", "actor_id": "system", "from_status": "pending", "to_status": "superseded"}); e != nil {
			return e
		}
		if _, e = tx.Update("review_tasks", id(task), revision(task), next); e != nil {
			return e
		}
	}
	return nil
}
func saveEvaluation(tx Tx, r Record) (Record, error) {
	artifact, e := tx.Get("artifact_versions", Text(r, "artifact_id"))
	if e != nil {
		return nil, e
	}
	if Text(artifact, "content_sha256") != Text(r, "artifact_sha256") {
		return nil, problem(409, "Artifact hash changed")
	}
	p, e := effective(tx, folder(Text(artifact, "target_path")))
	if e != nil {
		return nil, e
	}
	if p.Digest != Text(r, "policy_digest") {
		return nil, problem(409, "Quality policy changed")
	}
	var dims map[string]Dimension
	var issues []Issue
	b, _ := json.Marshal(r["dimensions"])
	if e = json.Unmarshal(b, &dims); e != nil {
		return nil, problem(422, "Invalid dimension scores")
	}
	b, _ = json.Marshal(r["issues"])
	if e = json.Unmarshal(b, &issues); e != nil {
		return nil, problem(422, "Invalid issues")
	}
	assessment, e := Assess(p, dims, issues)
	if e != nil {
		return nil, e
	}
	if Text(r, "evaluator_version") == "" {
		return nil, problem(422, "Evaluator version is required")
	}
	eval, e := tx.Insert("evaluations", Record{"artifact_id": id(artifact), "artifact_sha256": artifact["content_sha256"], "policy_snapshot": p, "policy_digest": p.Digest, "dimensions": dims, "total": assessment.Total, "needs_review": assessment.NeedsReview, "blocking": assessment.Blocking, "evaluator_version": r["evaluator_version"]})
	if e != nil {
		return nil, e
	}
	for _, i := range issues {
		raw, _ := json.Marshal(i)
		var v Record
		_ = json.Unmarshal(raw, &v)
		v["evaluation_id"] = id(eval)
		if _, e = tx.Insert("quality_issues", v); e != nil {
			return nil, e
		}
	}
	if e = supersedePending(tx, id(artifact)); e != nil {
		return nil, e
	}
	// Default all document evaluations require an independent human decision.
	task, e := tx.Insert("review_tasks", Record{"artifact_id": id(artifact), "evaluation_id": id(eval), "artifact_digest": artifact["content_sha256"], "policy_digest": p.Digest, "status": "pending"})
	if e != nil {
		return nil, e
	}
	eval["review_task_id"] = id(task)
	return eval, nil
}
func saveDecision(tx Tx, actor string, r Record) (Record, error) {
	if e := required(r, "task_id", "note", "decision"); e != nil {
		return nil, e
	}
	task, e := tx.Get("review_tasks", Text(r, "task_id"))
	if e != nil {
		return nil, e
	}
	if Text(task, "status") != "pending" || revision(task) != int(number(r, "expected_revision")) {
		return nil, problem(409, "Review task is no longer current")
	}
	artifact, e := tx.Get("artifact_versions", Text(task, "artifact_id"))
	if e != nil {
		return nil, e
	}
	p, e := effective(tx, folder(Text(artifact, "target_path")))
	if e != nil {
		return nil, e
	}
	if p.Digest != Text(task, "policy_digest") {
		return nil, problem(409, "Quality policy changed; reassessment is required")
	}
	versions, err := tx.List("artifact_versions")
	if err != nil {
		return nil, err
	}
	for _, version := range versions {
		if Text(version, "logical_key") == Text(artifact, "logical_key") && number(version, "version") > number(artifact, "version") {
			return nil, problem(409, "Artifact version is superseded")
		}
	}
	evaluation, e := tx.Get("evaluations", Text(task, "evaluation_id"))
	if e != nil {
		return nil, e
	}
	decision := Text(r, "decision")
	states := map[string]string{"approve": "approved", "reject": "rejected", "changes_requested": "changes_requested"}
	status, ok := states[decision]
	if !ok {
		return nil, problem(422, "Invalid review decision")
	}
	if decision == "approve" && evaluation["blocking"] == true {
		return nil, problem(409, "Blocking issues must be corrected and reassessed")
	}
	next := copyRecord(task)
	next["status"] = status
	event, e := tx.Insert("review_events", Record{"task_id": id(task), "decision": decision, "note": r["note"], "actor_id": actor, "from_status": "pending", "to_status": status})
	if e != nil {
		return nil, e
	}
	if _, e = tx.Update("review_tasks", id(task), revision(task), next); e != nil {
		return nil, e
	}
	return event, nil
}
func beginPublication(tx Tx, r Record) (Record, error) {
	artifact, e := tx.Get("artifact_versions", Text(r, "artifact_id"))
	if e != nil {
		return nil, e
	}
	eval, e := tx.Get("evaluations", Text(r, "evaluation_id"))
	if e != nil {
		return nil, e
	}
	if Text(eval, "artifact_id") != id(artifact) {
		return nil, problem(409, "Evaluation does not match artifact")
	}
	p, e := effective(tx, folder(Text(artifact, "target_path")))
	if e != nil {
		return nil, e
	}
	if Text(eval, "policy_digest") != p.Digest || eval["blocking"] == true {
		return nil, problem(409, "Quality eligibility is stale or blocked")
	}
	artifacts, e := tx.List("artifact_versions")
	if e != nil {
		return nil, e
	}
	for _, a := range artifacts {
		if Text(a, "logical_key") == Text(artifact, "logical_key") && number(a, "version") > number(artifact, "version") {
			return nil, problem(409, "Artifact version has been superseded")
		}
	}
	assessments, err := tx.List("evaluations")
	if err != nil {
		return nil, err
	}
	latest := ""
	for _, assessment := range assessments {
		if Text(assessment, "artifact_id") == id(artifact) {
			latest = id(assessment)
		}
	}
	if latest != id(eval) {
		return nil, problem(409, "A newer quality assessment supersedes this approval")
	}
	tasks, e := tx.List("review_tasks")
	if e != nil {
		return nil, e
	}
	approved := false
	for _, task := range tasks {
		if Text(task, "evaluation_id") == id(eval) && Text(task, "status") == "approved" {
			approved = true
		}
	}
	if !approved {
		return nil, problem(409, "Document requires independent human approval")
	}
	pubs, e := tx.List("publications")
	if e != nil {
		return nil, e
	}
	for _, p := range pubs {
		if Text(p, "artifact_id") == id(artifact) && Text(p, "evaluation_id") == id(eval) && Text(p, "status") == "publishing" {
			return p, nil
		}
	}
	return tx.Insert("publications", Record{"artifact_id": id(artifact), "evaluation_id": id(eval), "digest": artifact["content_sha256"], "target_path": artifact["target_path"], "policy_digest": p.Digest, "status": "publishing"})
}
func finishPublication(tx Tx, r Record) (Record, error) {
	pub, e := tx.Get("publications", Text(r, "id"))
	if e != nil {
		return nil, e
	}
	if Text(pub, "status") != "publishing" {
		return nil, problem(409, "Publication is not active")
	}
	status := Text(r, "status")
	if status != "published" && status != "failed" {
		return nil, problem(422, "Invalid publication status")
	}
	next := copyRecord(pub)
	next["status"] = status
	return tx.Update("publications", id(pub), revision(pub), next)
}

func saveDirectory(tx Tx, r Record) (Record, error) {
	return mutateDirectory(tx, r)
}
