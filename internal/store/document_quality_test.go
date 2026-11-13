package store

import (
	"cim-llm-wiki/internal/documentquality"
	"cim-llm-wiki/internal/types"
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"
)

func TestDocumentQualityLifecycle(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL is required")
	}
	ctx := context.Background()
	base, e := New(ctx, dsn)
	if e != nil {
		t.Fatal(e)
	}
	defer base.Close()
	schema := fmt.Sprintf("dq_test_%d", time.Now().UnixNano())
	if e = base.Migrate(ctx, "CREATE SCHEMA "+schema); e != nil {
		t.Fatal(e)
	}
	defer func() { _ = base.Migrate(ctx, "DROP SCHEMA "+schema+" CASCADE") }()
	u, _ := url.Parse(dsn)
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	s, e := New(ctx, u.String())
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	for _, file := range []string{"001_init.sql", "002_document_quality.sql", "003_git_document_sources.sql", "004_document_directories.sql", "007_code_repository_sources.sql"} {
		b, e := os.ReadFile("../../deploy/postgres/" + file)
		if e != nil {
			t.Fatal(e)
		}
		if e = s.Migrate(ctx, string(b)); e != nil {
			t.Fatal(e)
		}
	}
	if e = s.Migrate(ctx, "INSERT INTO projects(id,name) VALUES('demo','Demo'),('other','Other')"); e != nil {
		t.Fatal(e)
	}

	// Existing projects and their local configuration must survive initialization.
	if e = s.Migrate(ctx, `INSERT INTO dq_directories(project_id,payload,created_by) VALUES('demo','{"path":"doc/custom"}','tester'),('demo','{"path":"doc/50-designs"}','tester');
 INSERT INTO dq_quality_policies(project_id,payload,created_by) VALUES('demo','{"path":"doc/custom","patch":{"review_threshold":87},"policy_revision":1}','tester');`); e != nil {
		t.Fatal(e)
	}
	defaults, err := os.ReadFile("../../deploy/postgres/005_default_document_directories.sql")
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Migrate(ctx, string(defaults)); err != nil {
		t.Fatal(err)
	}
	assertFolders := func(project string, want int) {
		t.Helper()
		var count int
		if err := s.pool.QueryRow(ctx, "SELECT count(*) FROM dq_directories WHERE project_id=$1", project).Scan(&count); err != nil || count != want {
			t.Fatalf("directory count for %s: got %d want %d: %v", project, count, want, err)
		}
	}
	assertFolders("demo", 12)
	var preserved int
	if err = s.pool.QueryRow(ctx, "SELECT count(*) FROM dq_directories WHERE project_id='demo' AND payload->>'path'='doc/50-designs' AND created_by='tester'").Scan(&preserved); err != nil || preserved != 1 {
		t.Fatalf("existing default path was replaced: %d %v", preserved, err)
	}

	assertFolders("other", 11)
	if err = s.UpsertProject(ctx, &types.ProjectConfig{ID: "new-project", Name: "New project"}); err != nil {
		t.Fatal(err)
	}
	assertFolders("new-project", 11)
	if err = s.UpsertProject(ctx, &types.ProjectConfig{ID: "new-project", Name: "Updated project"}); err != nil {
		t.Fatal(err)
	}
	assertFolders("new-project", 11)
	if err = s.Migrate(ctx, string(defaults)); err != nil {
		t.Fatal(err)
	}
	assertFolders("demo", 12)
	var threshold int
	if err = s.pool.QueryRow(ctx, "SELECT (payload->'patch'->>'review_threshold')::int FROM dq_quality_policies WHERE project_id='demo' AND payload->>'path'='doc/custom'").Scan(&threshold); err != nil || threshold != 87 {
		t.Fatalf("existing policy changed: %d %v", threshold, err)
	}
	var initialized int
	if err = s.pool.QueryRow(ctx, "SELECT count(*) FROM dq_directories WHERE project_id='new-project' AND payload->>'path' IN ('doc/00-overview','doc/10-planning','doc/20-architecture','doc/30-standards','doc/40-requirements','doc/50-designs','doc/60-test','doc/70-release','doc/80-deploy','doc/90-guides','doc/99-templates')").Scan(&initialized); err != nil || initialized != 11 {
		t.Fatalf("default directory set: %d %v", initialized, err)
	}
	if err = s.DeleteProject(ctx, "new-project"); err != nil {
		t.Fatal(err)
	}
	assertFolders("new-project", 0)
	workspaceSQL, err := os.ReadFile("../../deploy/postgres/006_directory_workspace.sql")
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Migrate(ctx, string(workspaceSQL)); err != nil {
		t.Fatal(err)
	}
	service := documentquality.Service{Repository: s}
	n := 0
	call := func(op string, r documentquality.Record) documentquality.Record {
		t.Helper()
		n++
		raw, _ := json.Marshal(r)
		_ = json.Unmarshal(raw, &r)
		v, e := service.Execute(ctx, "demo", "test-user", op, fmt.Sprint(n), r)
		if e != nil {
			t.Fatalf("%s: %v", op, e)
		}
		return v
	}
	source := call("data-sources", documentquality.Record{"name": "Documents", "type": "svn", "url": "https://example.test/svn", "revision_selector": "HEAD"})
	run := call("ingest-runs", documentquality.Record{"source_id": source["id"], "source_config_id": source["config_id"], "operative_revision": "42", "repository_uuid": "repo", "recipe_version": "v1"})
	observed := call("source-observations", documentquality.Record{"run_id": run["id"], "repository_path": "design.docx", "original_uri": "shared://team/source.docx", "original_sha256": strings.Repeat("a", 64), "svn_info_uri": "shared://team/info.xml"})
	artifact := call("artifacts", documentquality.Record{"run_id": run["id"], "target_path": "doc/50-designs/design.md", "logical_key": "design", "template_id": "sdd", "document_contract_digest": "test-contract", "content_uri": "shared://team/design.md", "content_sha256": strings.Repeat("b", 64), "parsed_uri": "shared://team/parsed.md", "source_links": []any{map[string]any{"source_version_id": observed["id"], "location": map[string]any{"section": "1"}}}, "recipe_version": "v1"})
	p, e := service.Policy(ctx, "demo", "reader", "doc/50-designs")
	if e != nil {
		t.Fatal(e)
	}
	dims := map[string]any{}
	for _, d := range documentquality.Dimensions {
		dims[d] = map[string]any{"score": 75.0, "reason": "Compared source", "evidence": []any{"section 1"}}
	}
	eval := call("document-evaluations", documentquality.Record{"artifact_id": artifact["id"], "artifact_sha256": artifact["content_sha256"], "policy_digest": p.Digest, "dimensions": dims, "issues": []any{}, "evaluator_version": "test-v1"})
	event := call("document-review-decisions", documentquality.Record{"task_id": eval["review_task_id"], "expected_revision": 1, "decision": "approve", "note": "Checked the source"})
	if event["actor_id"] != "test-user" {
		t.Fatal("review identity missing")
	}
	pub := call("publication-start", documentquality.Record{"artifact_id": artifact["id"], "evaluation_id": eval["id"]})
	_, e = service.Execute(ctx, "demo", "test", "quality-policies", "blocked", documentquality.Record{"path": "doc", "expected_revision": 0, "patch": map[string]any{"review_threshold": 90.0}})
	if e == nil {
		t.Fatal("policy changed during publication")
	}
	call("publication-finish", documentquality.Record{"id": pub["id"], "status": "published"})
	call("quality-policies", documentquality.Record{"path": "doc", "expected_revision": 0, "patch": map[string]any{"review_threshold": 90.0}})
	_, e = service.Execute(ctx, "demo", "test", "publication-start", "stale", documentquality.Record{"artifact_id": artifact["id"], "evaluation_id": eval["id"]})
	if e == nil {
		t.Fatal("stale evaluation published")
	}
	_, e = service.Execute(ctx, "other", "test", "publication-start", "cross-project", documentquality.Record{"artifact_id": artifact["id"], "evaluation_id": eval["id"]})
	if e == nil {
		t.Fatal("cross project record accepted")
	}
	err = s.Migrate(ctx, "UPDATE dq_review_events SET payload='{}'")
	if err == nil {
		t.Fatal("audit event was mutable")
	}
	rows, e := service.Read(ctx, "demo", "reader", "review_events")
	if e != nil || len(rows) != 1 {
		t.Fatal("history was lost", e)
	}
	migration, err := os.ReadFile("../../deploy/postgres/008_document_template_defaults.sql")
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Migrate(ctx, string(migration)); err != nil {
		t.Fatal(err)
	}
	if err = s.UpsertProject(ctx, &types.ProjectConfig{ID: "template-project", Name: "Template project"}, []map[string]string{{"path": "doc", "title": "Docs"}, {"path": "doc/custom-default", "title": "Custom default"}}); err != nil {
		t.Fatal(err)
	}
	assertFolders("template-project", 2)
	if err = s.EnsureDocumentDirectories(ctx, "template-project", []map[string]string{{"path": "doc/custom-default", "title": "Custom default"}}); err != nil {
		t.Fatal(err)
	}
	assertFolders("template-project", 2)
}

func TestQualityMigrationAdoptionAndChecksums(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL is required")
	}
	ctx := context.Background()
	base, e := New(ctx, dsn)
	if e != nil {
		t.Fatal(e)
	}
	defer base.Close()
	schema := fmt.Sprintf("dq_migration_%d", time.Now().UnixNano())
	if e = base.Migrate(ctx, "CREATE SCHEMA "+schema); e != nil {
		t.Fatal(e)
	}
	defer func() { _ = base.Migrate(ctx, "DROP SCHEMA "+schema+" CASCADE") }()
	u, _ := url.Parse(dsn)
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	s, e := New(ctx, u.String())
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	initial, _ := os.ReadFile("../../deploy/postgres/001_init.sql")
	upgrade, _ := os.ReadFile("../../deploy/postgres/002_document_quality.sql")
	if e = s.Migrate(ctx, string(initial)); e != nil {
		t.Fatal(e)
	}
	for i := 0; i < 2; i++ {
		if e = s.ApplyMigration(ctx, "001_init.sql", string(initial)); e != nil {
			t.Fatal(e)
		}
		if e = s.ApplyMigration(ctx, "002_document_quality.sql", string(upgrade)); e != nil {
			t.Fatal(e)
		}
	}
	if e = s.ApplyMigration(ctx, "002_document_quality.sql", string(upgrade)+"\n-- changed"); e == nil {
		t.Fatal("applied migration edit was accepted")
	}
}
