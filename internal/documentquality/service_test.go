package documentquality

import (
	"context"
	"fmt"
	"testing"
)

type memoryRepository struct {
	rows    map[string][]Record
	counter int
}

func (m *memoryRepository) WithProject(_ context.Context, _, _ string, fn func(Tx) error) error {
	return fn(m)
}
func (m *memoryRepository) Get(kind, id string) (Record, error) {
	for _, r := range m.rows[kind] {
		if Text(r, "id") == id {
			return copyRecord(r), nil
		}
	}
	return nil, problem(404, "Not found")
}
func (m *memoryRepository) List(kind string) ([]Record, error) { return m.rows[kind], nil }
func (m *memoryRepository) Insert(kind string, r Record) (Record, error) {
	m.counter++
	n := copyRecord(r)
	n["id"] = fmt.Sprint(m.counter)
	n["revision"] = 1.0
	m.rows[kind] = append(m.rows[kind], n)
	return copyRecord(n), nil
}
func (m *memoryRepository) Update(kind, id string, rev int, r Record) (Record, error) {
	for i, old := range m.rows[kind] {
		if Text(old, "id") == id {
			if revision(old) != rev {
				return nil, problem(409, "Changed")
			}
			n := copyRecord(r)
			n["id"] = id
			n["revision"] = float64(rev + 1)
			m.rows[kind][i] = n
			return copyRecord(n), nil
		}
	}
	return nil, problem(404, "Missing")
}
func TestServiceIdempotencyAndPolicyConflicts(t *testing.T) {
	repo := &memoryRepository{rows: map[string][]Record{}}
	service := Service{Repository: repo}
	ctx := context.Background()
	input := Record{"path": "doc", "expected_revision": 0.0, "patch": map[string]any{"review_threshold": 85.0}}
	first, e := service.Execute(ctx, "demo", "admin", "quality-policies", "same", input)
	if e != nil {
		t.Fatal(e)
	}
	second, e := service.Execute(ctx, "demo", "admin", "quality-policies", "same", input)
	if e != nil || id(first) != id(second) || len(repo.rows["quality_policies"]) != 1 {
		t.Fatal("Idempotent retry was not replayed")
	}
	_, e = service.Execute(ctx, "demo", "admin", "quality-policies", "same", Record{"path": "doc"})
	if e == nil {
		t.Fatal("different body reused receipt")
	}
	cases := []struct {
		op string
		r  Record
	}{
		{"quality-policies", input},
		{"quality-policies", Record{"path": "../bad", "patch": map[string]any{}}},
		{"quality-policies", Record{"path": "doc/x", "patch": map[string]any{"review_threshold": nil}}},
		{"data-sources", Record{"name": "SVN", "type": "svn", "url": "https://user:pass@example.test/repo", "revision_selector": "HEAD"}},
		{"data-sources", Record{"name": "SVN", "type": "unsupported", "url": "https://example.test/repo", "revision_selector": "HEAD"}},
		{"data-sources", Record{"name": "SVN", "type": "svn", "url": "https://example.test/repo", "revision_selector": "floating"}},
		{"data-sources", Record{"name": "SVN", "type": "svn", "url": "https://example.test/repo", "subpath": "../x", "revision_selector": "HEAD"}},
		{"unknown", Record{}},
	}
	for i, c := range cases {
		if _, e = service.Execute(ctx, "demo", "admin", c.op, fmt.Sprint(i), c.r); e == nil {
			t.Fatalf("accepted invalid operation %s: %+v", c.op, c.r)
		}
	}
	if _, e = service.Execute(ctx, "demo", "admin", "quality-policies", "", input); e == nil {
		t.Fatal("missing idempotency key accepted")
	}
	if _, e = service.Execute(ctx, "", "admin", "quality-policies", "key", input); e == nil {
		t.Fatal("missing project accepted")
	}
}
func TestDescendantPolicyAndMissingEvidence(t *testing.T) {
	ps := []Policy{{Path: "doc", Revision: 1, Patch: map[string]any{"dimensions": map[string]any{"fidelity": map[string]any{"weight": .3}, "completeness": map[string]any{"weight": .1}}}}, {Path: "doc/50-designs", Revision: 1, Patch: map[string]any{"dimensions": map[string]any{"fidelity": map[string]any{"weight": .2}}}}}
	if _, e := Resolve(ps, "doc/50-designs"); e == nil {
		t.Fatal("invalid inherited weights accepted")
	}
	p, _ := Resolve(nil, "doc")
	for _, severity := range []string{"blocking", "warning"} {
		assessment, e := Assess(p, nil, []Issue{{Origin: "source", Code: "critical_fact_error", Severity: severity, Description: "Wrong condition"}})
		if e != nil || !assessment.Blocking || !assessment.NeedsReview {
			t.Fatal("blocking fact error was diluted")
		}
	}
	if _, e := Assess(p, nil, []Issue{{Origin: "unknown", Severity: "warning"}}); e == nil {
		t.Fatal("invalid quality issue accepted")
	}
}

func TestRevisionReviewAndSourceTransitions(t *testing.T) {
	repo := &memoryRepository{rows: map[string][]Record{}}
	service := Service{Repository: repo}
	ctx := context.Background()
	n := 0
	call := func(op string, r Record) (Record, error) {
		n++
		return service.Execute(ctx, "demo", "reviewer", op, fmt.Sprint(n), r)
	}
	must := func(op string, r Record) Record {
		t.Helper()
		v, e := call(op, r)
		if e != nil {
			t.Fatalf("%s: %v", op, e)
		}
		return v
	}
	reject := func(op string, r Record) {
		t.Helper()
		if _, e := call(op, r); e == nil {
			t.Fatalf("accepted invalid %s: %+v", op, r)
		}
	}
	source := must("data-sources", Record{"name": "Source", "type": "svn", "url": "https://example.test/repo", "revision_selector": "HEAD"})
	reject("data-sources", Record{"id": source["id"], "name": "Source", "type": "svn", "url": "https://example.test/repo", "revision_selector": "HEAD", "expected_revision": 0.0})
	source = must("data-sources", Record{"id": source["id"], "name": "Source", "type": "svn", "url": "https://example.test/repo", "revision_selector": "HEAD", "expected_revision": source["revision"]})
	must("ingest-runs", Record{"source_id": source["id"], "source_config_id": source["config_id"], "status": "failed", "error_code": "SVN_COLLECTION_FAILED", "recipe_version": "v1"})
	run := must("ingest-runs", Record{"source_id": source["id"], "source_config_id": source["config_id"], "operative_revision": "42", "repository_uuid": "repo", "recipe_version": "v1"})
	originalInput := Record{"run_id": run["id"], "repository_path": "source.docx", "original_uri": "shared://team/original.docx", "original_sha256": fmt.Sprintf("%064d", 1), "svn_info_uri": "shared://team/info.xml"}
	original := must("source-observations", originalInput)
	retry := must("source-observations", originalInput)
	if id(original) != id(retry) {
		t.Fatal("source retry duplicated content")
	}
	changed := copyRecord(originalInput)
	changed["original_sha256"] = fmt.Sprintf("%064d", 2)
	reject("source-observations", changed)
	artifactInput := Record{"run_id": run["id"], "logical_key": "design", "target_path": "doc/50-designs/design.md", "content_uri": "shared://team/design.md", "parsed_uri": "shared://team/parsed.md", "content_sha256": fmt.Sprintf("%064d", 2), "recipe_version": "v1", "source_links": []any{map[string]any{"source_version_id": id(original)}}}
	artifact := must("artifacts", artifactInput)
	retry = must("artifacts", artifactInput)
	if id(artifact) != id(retry) {
		t.Fatal("artifact retry duplicated version")
	}
	p, _ := Resolve(nil, "doc/50-designs")
	input := Record{"artifact_id": id(artifact), "artifact_sha256": artifact["content_sha256"], "policy_digest": p.Digest, "dimensions": map[string]any{}, "issues": []any{map[string]any{"origin": "source", "code": "major_omission", "severity": "blocking", "description": "Important condition missing"}}, "evaluator_version": "v1"}
	eval := must("document-evaluations", input)
	reject("document-review-decisions", Record{"task_id": eval["review_task_id"], "expected_revision": 1.0, "decision": "approve", "note": "Attempted bypass"})
	must("document-review-decisions", Record{"task_id": eval["review_task_id"], "expected_revision": 1.0, "decision": "changes_requested", "note": "Restore condition"})
	reject("document-review-decisions", Record{"task_id": eval["review_task_id"], "expected_revision": 1.0, "decision": "reject", "note": "Already closed"})
	revised := copyRecord(artifactInput)
	revised["content_sha256"] = fmt.Sprintf("%064d", 3)
	newVersion := must("artifacts", revised)
	if number(newVersion, "version") != 2 {
		t.Fatal("revision history not advanced")
	}
	missingInput := copyRecord(input)
	missingInput["artifact_id"] = id(newVersion)
	missingInput["artifact_sha256"] = newVersion["content_sha256"]
	missingInput["issues"] = []any{}
	nextEval := must("document-evaluations", missingInput)
	must("document-review-decisions", Record{"task_id": nextEval["review_task_id"], "expected_revision": 1.0, "decision": "reject", "note": "Needs source comparison"})
	reject("publication-start", Record{"artifact_id": id(newVersion), "evaluation_id": id(nextEval)})
	must("ingest-runs", Record{"id": run["id"], "status": "partial"})
	reject("ingest-runs", Record{"id": run["id"], "status": "completed"})
	reject("source-observations", originalInput)
	if len(repo.rows["review_events"]) != 2 {
		t.Fatal("review history overwritten")
	}
}

func TestReassessmentSupersedesPendingTaskWithHistory(t *testing.T) {
	repo := &memoryRepository{rows: map[string][]Record{}}
	artifact, _ := repo.Insert("artifact_versions", Record{"target_path": "doc/50-designs/design.md", "content_sha256": "hash", "logical_key": "design", "version": 1.0})
	service := Service{Repository: repo}
	ctx := context.Background()
	p, _ := Resolve(nil, "doc/50-designs")
	input := Record{"artifact_id": id(artifact), "artifact_sha256": "hash", "policy_digest": p.Digest, "dimensions": map[string]any{}, "issues": []any{}, "evaluator_version": "v1"}
	first, e := service.Execute(ctx, "demo", "skill", "document-evaluations", "first", input)
	if e != nil {
		t.Fatal(e)
	}
	second, e := service.Execute(ctx, "demo", "skill", "document-evaluations", "second", input)
	if e != nil {
		t.Fatal(e)
	}
	old, _ := repo.Get("review_tasks", Text(first, "review_task_id"))
	current, _ := repo.Get("review_tasks", Text(second, "review_task_id"))
	if Text(old, "status") != "superseded" || Text(current, "status") != "pending" {
		t.Fatal("reassessment did not supersede old pending task")
	}
	if len(repo.rows["review_events"]) != 1 || Text(repo.rows["review_events"][0], "actor_id") != "system" {
		t.Fatal("automatic supersession lacks history")
	}
	_, e = service.Execute(ctx, "demo", "reviewer", "document-review-decisions", "stale", Record{"task_id": id(old), "expected_revision": 1.0, "decision": "approve", "note": "Old task"})
	if e == nil {
		t.Fatal("superseded task accepted human decision")
	}
}

func TestScoringRejectsInvalidValuesBeforeEvidenceCheck(t *testing.T) {
	p, _ := Resolve(nil, "doc")
	invalid := 101.0
	if _, e := Assess(p, map[string]Dimension{"fidelity": {Score: &invalid}}, nil); e == nil {
		t.Fatal("invalid score accepted because evidence was missing")
	}
	for _, evidence := range [][]any{{nil}, {map[string]any{}}, {" "}, {42.0}} {
		valid := 100.0
		result, e := Assess(p, map[string]Dimension{"fidelity": {Score: &valid, Evidence: evidence, Reason: "Compared"}}, nil)
		if e != nil || !result.NeedsReview || result.Total != nil {
			t.Fatal("empty or invalid evidence was treated as complete")
		}
	}
	for _, patch := range []map[string]any{{"require_human": true}, {"dimensions": map[string]any{"fidelity": map[string]any{"rubric": "Compare every diagram"}}}} {
		resolved, e := Resolve([]Policy{{Path: "doc", Revision: 1, Patch: patch}}, "doc")
		if e != nil {
			t.Fatal(e)
		}
		if _, ok := patch["require_human"]; ok && !resolved.RequireHuman {
			t.Fatal("human requirement was not inherited")
		}
	}
}

func TestGitSourceConfigurationAndPinnedCommits(t *testing.T) {
	repo := &memoryRepository{rows: map[string][]Record{}}
	service := Service{Repository: repo}
	ctx := context.Background()
	source, e := service.Execute(ctx, "demo", "admin", "data-sources", "git-source", Record{"name": "Git docs", "type": "git", "url": "git@example.test:team/docs.git", "subpath": "docs", "revision_selector": "main"})
	if e != nil {
		t.Fatal(e)
	}
	config, _ := repo.Get("source_revisions", Text(source, "config_id"))
	if Text(config, "url") != "ssh://git@example.test/team/docs.git" || Text(config, "auth") != "git_local" {
		t.Fatalf("unexpected config: %+v", config)
	}
	commit := "0123456789abcdef0123456789abcdef01234567"
	input := Record{"source_id": source["id"], "source_config_id": source["config_id"], "commit_sha": commit, "repository_url": config["url"], "recipe_version": "git-skill-v1"}
	run, e := service.Execute(ctx, "demo", "skill", "ingest-runs", "git-run", input)
	if e != nil {
		t.Fatal(e)
	}
	if Text(run, "source_type") != "git" || Text(run, "commit_sha") != commit {
		t.Fatal("Git commit provenance missing")
	}
	observation := Record{"run_id": run["id"], "repository_path": "docs/design.md", "original_uri": "shared://team/design.md", "original_sha256": fmt.Sprintf("%064d", 1), "git_info_uri": "shared://team/git-info.json", "git_blob_oid": commit}
	first, e := service.Execute(ctx, "demo", "skill", "source-observations", "git-observation", observation)
	if e != nil {
		t.Fatal(e)
	}
	second, e := service.Execute(ctx, "demo", "skill", "source-observations", "git-retry", observation)
	if e != nil || id(first) != id(second) {
		t.Fatal("same Git commit was duplicated", e)
	}
	if Text(first, "commit_sha") != commit || Text(first, "repository_url") != config["url"] {
		t.Fatal("source commit provenance lost")
	}
	for _, bad := range []string{"main", "abc123", commit + "x"} {
		r := copyRecord(input)
		r["commit_sha"] = bad
		if _, e = service.Execute(ctx, "demo", "skill", "ingest-runs", "bad-"+bad, r); e == nil {
			t.Fatalf("accepted unpinned commit %s", bad)
		}
	}
	r := copyRecord(input)
	r["repository_url"] = "https://another.test/repo.git"
	if _, e = service.Execute(ctx, "demo", "skill", "ingest-runs", "wrong-remote", r); e == nil {
		t.Fatal("accepted unrelated Git repository")
	}
	for _, bad := range []string{"file:///private/repo", "ext::touch /tmp/x", "https://user:token@example.test/repo.git", "ssh://git:password@example.test/repo.git"} {
		if _, e = normalizeGitURL(bad); e == nil {
			t.Fatalf("accepted unsafe remote %s", bad)
		}
	}
}

func TestProjectDocumentDirectories(t *testing.T) {
	repo := &memoryRepository{rows: map[string][]Record{}}
	s := Service{Repository: repo}
	ctx := context.Background()
	r, err := s.Execute(ctx, "demo", "admin", "document-directories", "folder-1", Record{"path": "doc/50-designs/empty", "create_parents": true})
	if err != nil || Text(r, "path") != "doc/50-designs/empty" {
		t.Fatalf("directory: %v %v", r, err)
	}
	if len(repo.rows["quality_policies"]) != 0 {
		t.Fatal("directory creation must not override inherited scores")
	}
	_, err = s.Execute(ctx, "demo", "admin", "document-directories", "folder-2", Record{"path": "doc/50-designs/empty", "create_parents": true})
	if err == nil {
		t.Fatal("duplicate directory accepted")
	}
	for i, path := range []string{"", "../other", "doc/../code", "/doc", "other/folder"} {
		if _, err = s.Execute(ctx, "demo", "admin", "document-directories", fmt.Sprint("invalid-", i), Record{"path": path}); err == nil {
			t.Fatalf("invalid directory accepted: %q", path)
		}
	}
}
