package extractor

import (
	"cim-llm-wiki/internal/config"
	"cim-llm-wiki/internal/types"
	"context"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHeuristicExtractionPreservesTypesAndProvenance(t *testing.T) {
	doc := &types.ParsedDocument{Source: "shared://team/original.md", Content: "# BR-WIP-001 Rules\nRule body\n# API interface\nEndpoint\n# Scenario\nFlow\n# Requirement\nNeed\n# Design\nDesign body"}
	nodes, err := New(nil).Extract(context.Background(), doc, "wip")
	if err != nil || len(nodes) != 5 {
		t.Fatal("heuristic extraction failed", err)
	}
	expected := []types.ObjectType{types.ObjBusinessRule, types.ObjAPI, types.ObjScenario, types.ObjRequirement, types.ObjDesign}
	for i, node := range nodes {
		if node.Type != expected[i] || node.Source != doc.Source || node.Module != "wip" || node.Status != types.StatusDraft || node.Product == "" || node.Version == "" || node.CreatedAt.IsZero() {
			t.Fatal("extraction lost type or provenance")
		}
	}
	if nodes[0].ID != "BR-WIP-001" {
		t.Fatal("explicit node id lost")
	}
	if _, err := New(nil).Extract(context.Background(), &types.ParsedDocument{}, "wip"); err == nil {
		t.Fatal("empty input accepted")
	}
	for title, want := range map[string]types.ObjectType{"业务规则": types.ObjBusinessRule, "接口": types.ObjAPI, "场景流程": types.ObjScenario, "需求": types.ObjRequirement, "BR-WIP-002": types.ObjBusinessRule, "br-wip-002": types.ObjDesign} {
		if classifyTitle(title) != want {
			t.Fatalf("classification changed for %s", title)
		}
	}
	if nodes := fallbackExtract(doc, "wip", "# Title only"); len(nodes) != 1 || nodes[0].Content != "Title only" {
		t.Fatal("title-only section lost")
	}
	if nodes := fallbackExtract(doc, "wip", "Plain source"); len(nodes) != 1 || nodes[0].Content != "Plain source" {
		t.Fatal("plain source lost")
	}
	chunks := chunkContent(strings.Repeat("a", 14000), 6000, 500)
	if len(chunks) != 3 || len(chunks[2]) != 3000 {
		t.Fatal("chunk overlap changed")
	}
}

func TestLLMContractAndFailurePaths(t *testing.T) {
	var response string
	status := 200
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" || r.Header.Get("Authorization") != "Bearer unit-key" {
			t.Error("LLM request authentication/route mismatch")
		}
		var request chatRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil || len(request.Messages) != 2 {
			t.Error("LLM request contract invalid")
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(response))
	}))
	defer server.Close()
	cfg := &config.LLMConfig{APIKey: "unit-key", BaseURL: server.URL, Model: "test-local-model"}
	e := New(cfg)
	doc := &types.ParsedDocument{Source: "original.md", FileType: "md", Content: "# Source\nMeaningful source"}
	for _, content := range []string{`[{"id":"REQ-WIP-001","type":"requirement","product":"MES","version":"v2"}]`, `{"nodes":[{"id":"REQ-WIP-001","type":"requirement"}]}`, "```json\n[{\"id\":\"REQ-WIP-001\",\"type\":\"requirement\"}]\n```"} {
		raw, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": content}}}})
		response = string(raw)
		nodes, err := e.Extract(context.Background(), doc, "wip")
		if err != nil || len(nodes) != 1 || nodes[0].ID != "REQ-WIP-001" || nodes[0].Source != "original.md" {
			t.Fatal("LLM response normalization failed", err)
		}
	}
	for _, body := range []string{"not-json", `{"error":{"message":"rejected"}}`, `{"choices":[]}`, `{"choices":[{"message":{"content":"not-json"}}]}`} {
		response = body
		if _, err := e.callLLM(context.Background(), "prompt"); err == nil {
			t.Fatal("invalid LLM response accepted")
		}
	}
	status = 503
	if _, err := e.callLLM(context.Background(), "prompt"); err == nil {
		t.Fatal("service failure accepted")
	}
	nodes, err := e.Extract(context.Background(), doc, "wip")
	if err != nil || len(nodes) == 0 {
		t.Fatal("documented heuristic fallback failed", err)
	}
	cfg.BaseURL = ":bad-url"
	if _, err := e.callLLM(context.Background(), "prompt"); err == nil {
		t.Fatal("invalid LLM URL accepted")
	}
	cfg.BaseURL = server.URL
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := e.callLLM(ctx, "prompt"); err == nil {
		t.Fatal("cancelled request accepted")
	}
	cfg.Temperature = math.NaN()
	if _, err := e.callLLM(context.Background(), "prompt"); err == nil {
		t.Fatal("nonfinite request accepted")
	}
}
