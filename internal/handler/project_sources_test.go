package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"cim-llm-wiki/internal/types"
	"github.com/gin-gonic/gin"
)

func TestRegisteredProjectDocs(t *testing.T) {
	for _, tc := range []struct {
		name, body   string
		status, want int
	}{
		{"registered", `{"documents":[{"doc_id":"same-source","path":"shared://team/p/a.md","state":"draft"},{"doc_id":"same-source","path":"shared://team/p/b.md","state":"frozen"}]}`, 200, 200},
		{"empty", `{"documents":[]}`, 200, 200},
		{"malformed", `{}`, 200, 502},
		{"unavailable", `{}`, 503, 503},
	} {
		t.Run(tc.name, func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/internal/source-documents" || r.URL.Query().Get("project") != "demo" || r.URL.Query().Has("unexpected") {
					t.Error("incorrect project query", r.URL)
				}
				if r.Header.Get("X-Request-ID") != "source-query-001" {
					t.Error("missing correlation ID")
				}
				if r.Header.Get("Authorization") != "Bearer 12345678901234567890123456789012" {
					t.Error("missing service credential")
				}
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer upstream.Close()
			t.Setenv("CIM_WIKI_KNOWLEDGE_URL", upstream.URL)
			t.Setenv("CIM_WIKI_LEDGER_TOKEN", "12345678901234567890123456789012")
			response := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(response)
			c.Request = httptest.NewRequest("GET", "/projects/demo?unexpected=other", nil)
			c.Request.Header.Set("X-Request-ID", "source-query-001")
			project := &types.ProjectConfig{ID: "demo", Docs: []types.DocSource{{DocID: "stale"}}}
			ok := loadRegisteredProjectDocs(c, project)
			if response.Code != tc.want || ok != (tc.want == 200) {
				t.Fatalf("status=%d ok=%v", response.Code, ok)
			}
			if c.Request.URL.RawQuery != "unexpected=other" {
				t.Fatal("request query changed")
			}
			if ok && len(project.Docs) > 0 && (len(project.Docs) != 2 || project.Docs[1].State != "frozen") {
				t.Fatal("registered sources were not used", project.Docs)
			}
			if ok && tc.name == "empty" && len(project.Docs) != 0 {
				t.Fatal("stale sources retained")
			}
		})
	}
}
