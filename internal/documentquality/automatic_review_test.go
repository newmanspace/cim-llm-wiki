package documentquality

import (
	"context"
	"testing"
)

func TestEvaluationCreatesPolicyBasedApproval(t *testing.T) {
	for _, tc := range []struct {
		name                     string
		score                    float64
		missing, blocking, human bool
		want                     string
	}{
		{name: "above", score: 87.75, want: "approved"},
		{name: "at threshold", score: 80, want: "approved"},
		{name: "below without rounding", score: 79.99999, want: "pending"},
		{name: "incomplete evidence", score: 100, missing: true, want: "pending"},
		{name: "blocking issue", score: 100, blocking: true, want: "pending"},
		{name: "explicit human policy", score: 100, human: true, want: "pending"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo := &memoryRepository{rows: map[string][]Record{}}
			artifact, _ := repo.Insert("artifact_versions", Record{"target_path": "doc/00-overview/glossary.md", "content_sha256": "hash", "logical_key": "glossary", "version": 1.0})
			if tc.human {
				_, _ = repo.Insert("quality_policies", Record{"path": "doc", "policy_revision": 1.0, "patch": map[string]any{"require_human": true}})
			}
			policy, err := effective(repo, "doc/00-overview")
			if err != nil {
				t.Fatal(err)
			}
			dims := map[string]any{}
			for _, key := range Dimensions {
				dims[key] = map[string]any{"score": tc.score, "evidence": []any{"source sheet A1"}, "reason": "Compared with source"}
			}
			if tc.missing {
				delete(dims, "fidelity")
			}
			issues := []any{}
			if tc.blocking {
				issues = append(issues, map[string]any{"origin": "source", "code": "major_omission", "severity": "warning", "description": "Critical condition missing"})
			}
			input := Record{"artifact_id": id(artifact), "artifact_sha256": "hash", "policy_digest": policy.Digest, "dimensions": dims, "issues": issues, "evaluator_version": "test-v1"}
			service := Service{Repository: repo}
			eval, err := service.Execute(context.Background(), "demo", "skill-service", "document-evaluations", "eval", input)
			if err != nil {
				t.Fatal(err)
			}
			task, err := repo.Get("review_tasks", Text(eval, "review_task_id"))
			if err != nil || Text(task, "status") != tc.want {
				t.Fatalf("task=%+v err=%v", task, err)
			}
			_, err = service.Execute(context.Background(), "demo", "skill-service", "document-evaluations", "eval", input)
			if err != nil || len(repo.rows["review_tasks"]) != 1 {
				t.Fatal("idempotent evaluation created duplicate review")
			}
			if tc.want == "approved" {
				if Text(task, "approval_mode") != "auto" || len(repo.rows["review_events"]) != 1 {
					t.Fatal("automatic approval lacks auditable mode and event")
				}
				event := repo.rows["review_events"][0]
				if Text(event, "actor_id") != "system:quality-policy" || Text(event, "decision") != "approve" || Text(event, "policy_digest") != policy.Digest {
					t.Fatalf("approval evidence %+v", event)
				}
			} else if len(repo.rows["review_events"]) != 0 {
				t.Fatal("pending review was automatically approved")
			}
			_, err = service.Execute(context.Background(), "demo", "skill-service", "publication-start", "publish", Record{"artifact_id": id(artifact), "evaluation_id": id(eval)})
			if (err == nil) != (tc.want == "approved") {
				t.Fatalf("publication eligibility: %v", err)
			}
		})
	}
}
