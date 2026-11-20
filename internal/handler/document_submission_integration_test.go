package handler

import (
	"context"
	"github.com/gin-gonic/gin"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"testing"
)

func TestDocumentSubmissionLiveBridge(t *testing.T) {
	s := isolatedAdminStore(t)
	for _, name := range []string{"002_document_quality.sql", "003_git_document_sources.sql", "004_document_directories.sql", "005_default_document_directories.sql", "006_directory_workspace.sql", "008_document_template_defaults.sql", "009_document_naming.sql", "010_document_submission_workflow.sql", "011_local_document_sources.sql"} {
		sql, err := os.ReadFile("../../deploy/postgres/" + name)
		if err != nil {
			t.Fatal(err)
		}
		if err = s.Migrate(context.Background(), string(sql)); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.Migrate(context.Background(), "INSERT INTO projects(id,name) VALUES('demo','Demo'),('other','Other')"); err != nil {
		t.Fatal(err)
	}
	serviceToken := strings.Repeat("s", 40)
	humanToken := strings.Repeat("h", 40)
	t.Setenv("CIM_WIKI_LEDGER_TOKEN", serviceToken)
	t.Setenv("CIM_WIKI_REVIEW_TOKENS", `{"Reviewer":"`+humanToken+`"}`)
	h := NewDocumentQualityHandler(s)
	r := gin.New()
	g := r.Group("/internal/v1/projects/:id/document-quality", h.InternalAuth())
	g.GET("/:resource", h.List)
	g.POST("/:operation", h.Command)
	r.POST("/setup/projects/:id/:operation", h.Command)
	r.GET("/management/projects/:id/document-quality/:resource", h.List)
	server := httptest.NewServer(r)
	defer server.Close()
	command := exec.Command("node", "--test", "packages/wiki-core/test/document-submission-live.mjs", "packages/wiki-core/test/document-package-live.mjs")
	command.Dir = "../.."
	environment := []string{}
	for _, entry := range os.Environ() {
		if !strings.HasPrefix(entry, "NODE_TEST_CONTEXT=") {
			environment = append(environment, entry)
		}
	}
	command.Env = append(environment, "QUALITY_TEST_LEDGER_URL="+server.URL, "QUALITY_TEST_LEDGER_TOKEN="+serviceToken, "QUALITY_TEST_REVIEW_TOKEN="+humanToken)
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("%v\n%s", err, output)
	}
	// Immutable content and lifecycle history remain protected in PostgreSQL.
	for _, sql := range []string{
		"UPDATE dq_artifact_versions SET payload=payload || '{\"content_sha256\":\"tampered\"}'::jsonb",
		"UPDATE dq_document_states SET payload=payload || '{\"state\":\"submitted\"}'::jsonb",
		"INSERT INTO dq_document_states(project_id,payload,created_by) SELECT project_id,payload,created_by FROM dq_document_states LIMIT 1",
		"INSERT INTO dq_review_tasks(project_id,payload,created_by) SELECT project_id,jsonb_build_object('artifact_id',sys_id::text,'approval_mode','manual'),'test' FROM dq_artifact_versions LIMIT 1",
	} {
		if err := s.Migrate(context.Background(), sql); err == nil {
			t.Fatalf("database accepted invalid history or unbound review: %s", sql)
		}
	}
	t.Log(string(output))
}
