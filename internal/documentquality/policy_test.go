package documentquality

import "testing"

func TestInheritanceAndStrictScoring(t *testing.T) {
	policies := []Policy{{Path: "doc/50-designs", Revision: 1, Patch: map[string]any{"review_threshold": 85.0}}, {Path: "doc/50-designs/modules", Revision: 1, Patch: map[string]any{"dimensions": map[string]any{"fidelity": map[string]any{"rubric": "Verify diagrams"}}}}}
	p, err := Resolve(policies, "doc/50-designs/modules")
	if err != nil || p.Threshold != 85 || p.Origins["review_threshold"] != "doc/50-designs@1" {
		t.Fatalf("inheritance: %+v %v", p, err)
	}
	other, err := Resolve(policies, "doc/50-designs-old")
	if err != nil || other.Threshold != 80 {
		t.Fatal("prefix must match complete segments")
	}
	scores := map[string]Dimension{}
	for _, id := range Dimensions {
		v := 85.0
		scores[id] = Dimension{Score: &v, Reason: "Source compared", Evidence: []any{map[string]any{"section": "1"}}}
	}
	result, err := Assess(p, scores, nil)
	if err != nil || result.Total == nil || *result.Total != 85 || result.NeedsReview {
		t.Fatalf("assessment: %+v %v", result, err)
	}
	v := 84.9999
	scores["fidelity"] = Dimension{Score: &v, Reason: "Source compared", Evidence: []any{"page 1"}}
	result, _ = Assess(p, scores, nil)
	if !result.NeedsReview {
		t.Fatal("must compare unrounded total")
	}
	delete(scores, "fidelity")
	result, err = Assess(p, scores, nil)
	if err != nil || !result.NeedsReview || result.Total != nil {
		t.Fatal("missing evidence requires review")
	}
}

func TestPolicyValidation(t *testing.T) {
	for _, path := range []string{"../x", "/doc", "doc//x", "doc/%2e%2e", "doc/../x", "other/x"} {
		if _, err := Resolve(nil, path); err == nil {
			t.Fatalf("accepted %q", path)
		}
	}
	for _, patch := range []map[string]any{{"review_threshold": nil}, {"review_threshold": 101.0}, {"unknown": true}, {"dimensions": map[string]any{"fidelity": map[string]any{"weight": 0.9}}}} {
		if _, err := Resolve([]Policy{{Path: "doc", Revision: 1, Patch: patch}}, "doc"); err == nil {
			t.Fatalf("accepted %+v", patch)
		}
	}
}
