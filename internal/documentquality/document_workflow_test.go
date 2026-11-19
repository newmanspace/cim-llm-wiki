package documentquality

import (
	"context"
	"strings"
	"testing"
)

func TestDocumentSubmitIsListedBeforeFreezeOrScores(t *testing.T) {
	repo := &memoryRepository{rows: map[string][]Record{}}
	service := Service{Repository: repo}
	run, _ := repo.Insert("ingest_runs", Record{"source_id": "source", "operative_revision": "42", "status": "running"})
	source, _ := repo.Insert("source_versions", Record{"source_id": "source", "operative_revision": "42"})
	input := Record{"run_id": id(run), "target_path": "doc/50-designs/design.md", "content_uri": "shared://team/candidate.md", "content_sha256": strings.Repeat("a", 64), "logical_key": "design", "recipe_version": "v1", "parsed_uri": "shared://team/parsed.md", "document_contract_digest": "rules", "source_links": []any{map[string]any{"source_version_id": id(source)}}}
	execute := func(op, key string, r Record) (Record, error) {
		return service.Execute(context.Background(), "demo", "agent", op, key, r)
	}
	submitted, err := execute("document-submit", "submit", input)
	if err != nil {
		t.Fatal(err)
	}
	if Text(submitted, "workflow_state") != "submitted" || submitted["qscore"] != nil {
		t.Fatal(submitted)
	}
	rows, err := service.Read(context.Background(), "demo", "reader", "artifact_versions")
	if err != nil || len(rows) != 1 || id(rows[0]) != id(submitted) {
		t.Fatalf("Submit not visible in document-results: %v %v", rows, err)
	}
	retry, err := execute("document-submit", "submit", input)
	if err != nil || id(retry) != id(submitted) {
		t.Fatal("submit retry did not replay", err)
	}
	if _, err = execute("document-review-requests", "too-early", Record{"artifact_id": id(submitted)}); err == nil {
		t.Fatal("unfrozen document entered review")
	}
	freeze := Record{"artifact_id": id(submitted), "expected_revision": 0.0, "content_sha256": input["content_sha256"]}
	if _, err = execute("document-freeze", "stale", freeze); err == nil {
		t.Fatal("stale revision froze")
	}
	freeze["expected_revision"] = 1.0
	frozen, err := execute("document-freeze", "freeze", freeze)
	if err != nil || Text(frozen, "workflow_state") != "frozen" {
		t.Fatal(frozen, err)
	}
	task, err := execute("document-review-requests", "review", Record{"artifact_id": id(frozen)})
	if err != nil || Text(task, "approval_mode") != "manual" || task["evaluation_id"] != nil {
		t.Fatal(task, err)
	}
	decision := Record{"task_id": id(task), "expected_revision": 1.0, "decision": "approve", "note": "Compared with original"}
	event, err := service.Execute(context.Background(), "demo", "Independent Reviewer", "document-review-decisions", "decision", decision)
	if err != nil || Text(event, "actor_id") != "Independent Reviewer" || Text(event, "artifact_digest") != Text(frozen, "content_sha256") {
		t.Fatal(event, err)
	}
}
