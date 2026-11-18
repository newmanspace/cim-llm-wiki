package handler

import (
	"context"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestDocumentNamingLiveBridge(t *testing.T) {
	s := isolatedAdminStore(t)
	for _, name := range []string{"002_document_quality.sql", "009_document_naming.sql"} {
		data, err := os.ReadFile("../../deploy/postgres/" + name)
		if err != nil {
			t.Fatal(err)
		}
		if err = s.Migrate(context.Background(), string(data)); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.Migrate(context.Background(), "INSERT INTO projects(id,name) VALUES('demo','Demo')"); err != nil {
		t.Fatal(err)
	}
	token := strings.Repeat("s", 40)
	t.Setenv("CIM_WIKI_LEDGER_TOKEN", token)
	h := NewDocumentQualityHandler(s)
	r := gin.New()
	g := r.Group("/internal/v1/projects/:id/document-quality", h.InternalAuth())
	g.GET("/:resource", h.List)
	g.POST("/:operation", h.Command)
	r.POST("/setup/projects/:id/:operation", h.Command)
	server := httptest.NewServer(r)
	defer server.Close()
	cmd := exec.Command("node", "--test", "../../packages/wiki-core/test/document-naming-live.mjs")
	cmd.Env = append(os.Environ(), "NAMING_TEST_LEDGER_URL="+server.URL, "NAMING_TEST_LEDGER_TOKEN="+token)
	output, err := cmd.CombinedOutput()
	t.Log(string(output))
	if err != nil {
		t.Fatal(err)
	}
	for _, sql := range []string{
		`INSERT INTO dq_document_identities(project_id,payload,created_by) SELECT project_id,payload || jsonb_build_object('sequence',777,'filename','other.md','node_id','OTHER-777'),created_by FROM dq_document_identities LIMIT 1`,
		`INSERT INTO dq_document_identities(project_id,payload,created_by) SELECT project_id,payload || jsonb_build_object('topic','another-topic','filename','another.md','node_id','OTHER-888'),created_by FROM dq_document_identities LIMIT 1`,
		`UPDATE dq_document_identities SET payload=payload || jsonb_build_object('topic','renamed')`,
	} {
		if err := s.Migrate(context.Background(), sql); err == nil {
			t.Fatal("Database accepted an invalid identity mutation")
		}
	}
}
