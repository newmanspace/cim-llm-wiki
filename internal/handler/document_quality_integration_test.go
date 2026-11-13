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

func TestDocumentQualityLiveBridge(t *testing.T) {
	s := isolatedAdminStore(t)
	sql, e := os.ReadFile("../../deploy/postgres/002_document_quality.sql")
	if e != nil {
		t.Fatal(e)
	}
	if e = s.Migrate(context.Background(), string(sql)); e != nil {
		t.Fatal(e)
	}
	if e = s.Migrate(context.Background(), "INSERT INTO projects(id,name) VALUES('demo','Demo')"); e != nil {
		t.Fatal(e)
	}
	token := strings.Repeat("s", 40)
	human := strings.Repeat("h", 40)
	t.Setenv("CIM_WIKI_LEDGER_TOKEN", token)
	t.Setenv("CIM_WIKI_REVIEW_TOKENS", `{"Reviewer":"`+human+`"}`)
	gitSQL, err := os.ReadFile("../../deploy/postgres/003_git_document_sources.sql")
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Migrate(context.Background(), string(gitSQL)); err != nil {
		t.Fatal(err)
	}
	directorySQL, err := os.ReadFile("../../deploy/postgres/004_document_directories.sql")
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Migrate(context.Background(), string(directorySQL)); err != nil {
		t.Fatal(err)
	}
	defaultsSQL, err := os.ReadFile("../../deploy/postgres/005_default_document_directories.sql")
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Migrate(context.Background(), string(defaultsSQL)); err != nil {
		t.Fatal(err)
	}
	workspaceSQL, err := os.ReadFile("../../deploy/postgres/006_directory_workspace.sql")
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Migrate(context.Background(), string(workspaceSQL)); err != nil {
		t.Fatal(err)
	}
	h := NewDocumentQualityHandler(s)
	r := gin.New()
	g := r.Group("/internal/v1/projects/:id/document-quality", h.InternalAuth())
	g.GET("/:resource", h.List)
	g.POST("/:operation", h.Command)
	// Fixture-only configuration path; production uses RequireSession middleware.
	r.POST("/setup/projects/:id/:operation", h.Command)
	server := httptest.NewServer(r)
	defer server.Close()
	command := exec.Command("node", "--test", "packages/wiki-core/test/document-quality-live.mjs")
	command.Dir = "../.."
	environment := []string{}
	for _, entry := range os.Environ() {
		if !strings.HasPrefix(entry, "NODE_TEST_CONTEXT=") {
			environment = append(environment, entry)
		}
	}
	command.Env = append(environment, "QUALITY_TEST_LEDGER_URL="+server.URL, "QUALITY_TEST_LEDGER_TOKEN="+token, "QUALITY_TEST_REVIEW_TOKEN="+human)
	out, e := command.CombinedOutput()
	if e != nil {
		t.Fatalf("Node/Go/PostgreSQL bridge: %v\n%s", e, out)
	}
	if !strings.Contains(string(out), "ok 1 - live Node/Go/PostgreSQL") {
		t.Fatalf("The live bridge test did not execute: %s", out)
	}
	t.Log(string(out))
}
