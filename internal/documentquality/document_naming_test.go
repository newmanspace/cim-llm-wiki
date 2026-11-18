package documentquality

import (
	"testing"
)

func TestDocumentNameRules(t *testing.T) {
	name, err := DocumentFilename("mycim-spc", "sdd", "chart", "control-chart", 2)
	if err != nil || name != "mycim-spc-sdd-chart-control-chart-002.md" {
		t.Fatalf("unexpected name %q: %v", name, err)
	}
	name, err = DocumentFilename("mycim-spc", "idd", "chart", "query", 1000)
	if err != nil || name != "mycim-spc-idd-chart-query-1000.md" {
		t.Fatal(name, err)
	}
	for _, code := range []string{"", "Chart", "a_b", "../chart", "chart--x"} {
		if _, err = DocumentFilename("mycim-spc", "sdd", code, "query", 1); err == nil {
			t.Fatalf("accepted invalid module %q", code)
		}
	}
}
