package documentquality

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestDirectoryWorkspaceMaintenance(t *testing.T) {
	repo := &memoryRepository{rows: map[string][]Record{}}
	s := Service{Repository: repo}
	ctx := context.Background()
	n := 0
	call := func(input Record) (Record, error) {
		n++
		return s.Execute(ctx, "demo", "admin", "document-directories", fmt.Sprint(n), input)
	}
	root, e := call(Record{"path": "doc", "display_name": "文档"})
	if e != nil {
		t.Fatal(e)
	}
	parent, e := call(Record{"path": "doc/design", "display_name": "设计"})
	if e != nil {
		t.Fatal(e)
	}
	leaf, e := call(Record{"path": "doc/design/api", "display_name": "接口"})
	if e != nil {
		t.Fatal(e)
	}
	updated, e := call(Record{"action": "update", "id": id(leaf), "expected_revision": 1, "path": "doc/design/api", "display_name": "接口方案"})
	if e != nil || Text(updated, "display_name") != "接口方案" {
		t.Fatalf("name: %v %v", updated, e)
	}
	if _, e = call(Record{"action": "update", "id": id(leaf), "expected_revision": 1, "path": "doc/design/api"}); e == nil {
		t.Fatal("stale update accepted")
	}
	if _, e = call(Record{"action": "delete", "id": id(root), "expected_revision": 1}); e == nil {
		t.Fatal("root deleted")
	}
	if _, e = call(Record{"action": "delete", "id": id(parent), "expected_revision": 1}); e == nil {
		t.Fatal("parent deleted")
	}
	moved, e := call(Record{"action": "update", "id": id(updated), "expected_revision": 2, "path": "doc/design/interfaces", "display_name": "接口设计"})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = call(Record{"action": "delete", "id": id(moved), "expected_revision": 3}); e != nil {
		t.Fatal(e)
	}
	active, e := s.Read(ctx, "demo", "reader", "directories")
	if e != nil || len(active) != 2 {
		t.Fatalf("deleted directory visible: %v %v", active, e)
	}
	if _, e = call(Record{"path": "doc/design/interfaces", "display_name": "新接口"}); e != nil {
		t.Fatal(e)
	}
	if len(repo.rows["directory_events"]) != 7 {
		t.Fatalf("audit: %d", len(repo.rows["directory_events"]))
	}
	if _, e = call(Record{"path": "doc/missing/deep"}); e == nil {
		t.Fatal("missing parents created without consent")
	}
	if _, e = call(Record{"path": "doc/missing/deep", "create_parents": true}); e != nil {
		t.Fatal(e)
	}
	for _, input := range []Record{{"path": "doc/other", "action": "unknown"}, {"path": "doc/other", "display_name": "bad\nname"}, {"path": "doc/other", "display_name": strings.Repeat("文", 101)}, {"path": "doc/design"}} {
		if _, e = call(input); e == nil {
			t.Fatalf("invalid accepted: %v", input)
		}
	}
	rows, e := s.DirectoryCatalog(ctx, "demo")
	if e != nil || len(rows) != 5 {
		t.Fatalf("catalog %d: %v", len(rows), e)
	}
	for _, r := range rows {
		if Text(r, "path") == "doc/design" && (number(r, "child_count") != 1 || r["path_locked"] != true) {
			t.Fatalf("catalog metadata: %v", r)
		}
	}
}
func TestDirectoryPolicyImpactAndReferences(t *testing.T) {
	repo := &memoryRepository{rows: map[string][]Record{}}
	s := Service{Repository: repo}
	ctx := context.Background()
	for _, p := range []string{"doc", "doc/design", "doc/design/isolated", "doc/empty"} {
		_, _ = repo.Insert("directories", Record{"path": p, "display_name": directoryName(p)})
	}
	seq := 0
	call := func(op string, input Record) (Record, error) {
		seq++
		raw, _ := json.Marshal(input)
		_ = json.Unmarshal(raw, &input)
		return s.Execute(ctx, "demo", "admin", op, fmt.Sprint(seq), input)
	}
	if _, e := call("quality-policies", Record{"path": "doc", "expected_revision": 0, "patch": Record{"review_threshold": 85.0}}); e != nil {
		t.Fatal(e)
	}
	e, _ := Resolve(nil, "")
	full := Record{"review_threshold": 80.0, "dimensions": e.Dimensions}
	if _, err := call("quality-policies", Record{"path": "doc/design/isolated", "expected_revision": 0, "patch": full}); err != nil {
		t.Fatal(err)
	}
	preview, err := s.PreviewPolicy(ctx, "demo", Record{"path": "doc", "expected_revision": 1, "patch": map[string]any{"review_threshold": 95.0}})
	if err != nil {
		t.Fatal(err)
	}
	paths := preview["changed_paths"].([]string)
	for _, path := range paths {
		if path == "doc/design/isolated" {
			t.Fatal("independent directory affected")
		}
	}
	if len(paths) != 3 {
		t.Fatalf("affected paths: %v", paths)
	}
	if _, err = call("quality-policies", Record{"path": "", "expected_revision": 0, "patch": Record{"dimensions": Record{"fidelity": Record{"rubric": "Updated"}}}}); err != nil {
		t.Fatal(err)
	}
	if _, err = call("quality-policies", Record{"path": "doc", "expected_revision": 1, "expected_digest": preview["expected_digest"], "patch": Record{}}); err == nil {
		t.Fatal("changed ancestor accepted")
	}
	for _, input := range []Record{{"path": "../bad", "patch": map[string]any{}}, {"path": "doc", "patch": nil}, {"path": "doc", "expected_revision": 0, "patch": map[string]any{}}, {"path": "doc", "expected_revision": 1, "patch": map[string]any{"review_threshold": 101.0}}} {
		if _, err = s.PreviewPolicy(ctx, "demo", input); err == nil {
			t.Fatalf("invalid preview accepted: %v", input)
		}
	}
	_, _ = repo.Insert("artifact_versions", Record{"target_path": "doc/design/report.md", "logical_key": "report"})
	_, _ = repo.Insert("artifact_versions", Record{"target_path": "doc/design/report.md", "logical_key": "report"})
	rows, err := s.DirectoryCatalog(ctx, "demo")
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		if Text(row, "path") == "doc/design" && (number(row, "document_count") != 1 || row["can_delete"] != false) {
			t.Fatalf("references not protected: %v", row)
		}
	}
	for _, path := range []string{"doc/design", "doc/design/isolated"} {
		blocked, err := directoryBlocked(repo, path)
		if err != nil || !blocked {
			t.Fatal("reference not protected", path, err)
		}
	}
	_, _ = repo.Insert("publications", Record{"target_path": "doc/empty/output.md"})
	blocked, _ := directoryBlocked(repo, "doc/empty")
	if !blocked {
		t.Fatal("publication reference ignored")
	}
	if directoryMode(map[string]any{"dimensions": map[string]any{"fidelity": map[string]any{"weight": .2}}}) != "partial" {
		t.Fatal("partial mode")
	}
}
