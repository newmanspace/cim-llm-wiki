package handler

import (
	"cim-llm-wiki/internal/documentquality"
	"context"
	"github.com/gin-gonic/gin"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

type previewRepository struct{}

func (previewRepository) WithProject(_ context.Context, project, _ string, fn func(documentquality.Tx) error) error {
	if project != "demo" {
		return &documentquality.Error{Status: 404, Message: "Project not found"}
	}
	return fn(previewTransaction{})
}

type previewTransaction struct{}

func (previewTransaction) Get(string, string) (documentquality.Record, error) { return nil, nil }
func (previewTransaction) List(kind string) ([]documentquality.Record, error) {
	if kind == "artifact_versions" {
		return []documentquality.Record{{"id": "7", "project": "demo", "workflow_state": "submitted"}}, nil
	}
	return nil, nil
}
func (previewTransaction) Insert(string, documentquality.Record) (documentquality.Record, error) {
	panic("read-only preview")
}
func (previewTransaction) Update(string, string, int, documentquality.Record) (documentquality.Record, error) {
	panic("read-only preview")
}

func TestDocumentPreviewUsesManagementSessionAndProjectScope(t *testing.T) {
	token := strings.Repeat("s", 40)
	requests := 0
	knowledge := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.URL.Path != "/internal/document-result-preview" || r.URL.Query().Get("project") != "demo" || r.URL.Query().Get("id") != "7" || r.Header.Get("Authorization") != "Bearer "+token {
			t.Errorf("incorrect proxy request: %s", r.URL)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"markdown":"# Submitted","parsed":"# Source"}}`))
	}))
	defer knowledge.Close()
	t.Setenv("CIM_WIKI_KNOWLEDGE_URL", knowledge.URL)
	t.Setenv("CIM_WIKI_LEDGER_TOKEN", token)
	handler := &DocumentQualityHandler{service: documentquality.Service{Repository: previewRepository{}}}
	router := gin.New()
	// Production attaches RequireSession to this route; no independent review token is required.
	router.GET("/api/v1/admin/projects/:id/document-quality/:resource", handler.List)
	for _, test := range []struct {
		path   string
		status int
	}{{"demo/document-quality/preview?id=7&project=other", 200}, {"demo/document-quality/preview?id=8", 404}, {"other/document-quality/preview?id=7", 404}} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest("GET", "/api/v1/admin/projects/"+test.path, nil))
		if response.Code != test.status {
			t.Fatalf("%s: %d %s", test.path, response.Code, response.Body.String())
		}
		if strings.Contains(response.Body.String(), token) {
			t.Fatal("service credential reached browser")
		}
	}
	if requests != 1 {
		t.Fatalf("out-of-scope preview reached knowledge: %d requests", requests)
	}
}

func TestDocumentAttachmentUsesManagementSessionAndProjectScope(t *testing.T) {
	token := strings.Repeat("s", 40)
	requests := 0
	knowledge := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.URL.Path != "/internal/document-result-resource" || r.URL.Query().Get("project") != "demo" || r.URL.Query().Get("path") != "assets/流程 图.png" || r.Header.Get("Authorization") != "Bearer "+token {
			t.Errorf("incorrect attachment request: %s", r.URL)
		}
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Content-Disposition", "attachment; filename=image.png")
		_, _ = w.Write([]byte("image bytes"))
	}))
	defer knowledge.Close()
	t.Setenv("CIM_WIKI_KNOWLEDGE_URL", knowledge.URL)
	t.Setenv("CIM_WIKI_LEDGER_TOKEN", token)
	h := &DocumentQualityHandler{service: documentquality.Service{Repository: previewRepository{}}}
	r := gin.New()
	r.GET("/api/v1/admin/projects/:id/document-quality/:resource", h.List)
	for _, entry := range []struct {
		project string
		status  int
	}{{"demo", 200}, {"other", 404}} {
		query := url.Values{"id": {"7"}, "scope": {"candidate"}, "path": {"assets/流程 图.png"}, "project": {"other"}}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/admin/projects/"+entry.project+"/document-quality/resource?"+query.Encode(), nil))
		if w.Code != entry.status {
			t.Fatalf("attachment: %d %s", w.Code, w.Body.String())
		}
		if entry.status == 200 && (w.Body.String() != "image bytes" || w.Header().Get("X-Content-Type-Options") != "nosniff") {
			t.Fatal("attachment response changed")
		}
	}
	if requests != 1 {
		t.Fatal("out-of-scope attachment reached service")
	}
}
