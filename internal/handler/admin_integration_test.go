package handler

import (
	"cim-llm-wiki/internal/store"
	"context"
	"encoding/json"
	"fmt"
	"github.com/gin-gonic/gin"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"
)

func isolatedAdminStore(t *testing.T) *store.Store {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL for isolated PostgreSQL integration tests")
	}
	ctx := context.Background()
	base, err := store.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	schema := fmt.Sprintf("quality_%d", time.Now().UnixNano())
	if err := base.Migrate(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := base.Migrate(ctx, "DROP SCHEMA "+schema+" CASCADE"); err != nil {
			t.Error(err)
		}
		base.Close()
	})
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := parsed.Query()
	q.Set("search_path", schema)
	parsed.RawQuery = q.Encode()
	s, err := store.New(ctx, parsed.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	migration, err := os.ReadFile("../../deploy/postgres/001_init.sql")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Migrate(ctx, string(migration)); err != nil {
		t.Fatal(err)
	}
	codeSourceSQL, e := os.ReadFile("../../deploy/postgres/007_code_repository_sources.sql")
	if e != nil {
		t.Fatal(e)
	}
	if e = s.Migrate(ctx, string(codeSourceSQL)); e != nil {
		t.Fatal(e)
	}
	return s
}

func TestAdminRegistryAndTokenLifecycle(t *testing.T) {
	gin.SetMode(gin.TestMode)
	s := isolatedAdminStore(t)
	h := NewAdminHandler(s)
	router := gin.New()
	router.GET("/projects", h.ListProjects)
	router.POST("/projects", h.UpsertProject)
	router.GET("/projects/:id", h.GetProject)
	router.DELETE("/projects/:id", h.DeleteProject)
	router.POST("/projects/:id/token", h.IssueToken)
	router.DELETE("/projects/:id/token", h.RevokeToken)
	router.GET("/projects/:id/config", h.TokenAuth(), h.GetProjectConfig)
	router.POST("/projects/:id/sync-status", h.TokenAuth(), h.RecordSyncStatus)
	router.GET("/projects/:id/sync-logs", h.GetSyncLogs)
	router.POST("/projects/:id/wiki-nodes", h.UpsertWikiNodes)
	router.GET("/projects/:id/wiki-nodes", h.GetWikiNodes)
	call := func(method, path, body, token string, expected int) map[string]any {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		if res.Code != expected {
			t.Fatalf("%s %s: status %d, expected %d", method, path, res.Code, expected)
		}
		var data map[string]any
		if err := json.Unmarshal(res.Body.Bytes(), &data); err != nil {
			t.Fatal(err)
		}
		return data
	}
	call("GET", "/projects", "", "", 200)
	project := `{"id":"test","name":"Test MES","product":"MES","version":"v1","modules":["wip"],"docs":[{"doc_id":"IDD","path":"shared://test/source.xlsx","type":"IDD","ingested_at":"2026-11-05T00:00:00Z"}],"repos":[{"name":"service","url":"https://example.test/repo","branch":"main","synced_at":"2026-11-05T00:00:00Z","module_mapping":{"src/":"wip"}}]}`
	call("POST", "/projects", project, "", 200)
	call("POST", "/projects", project, "", 200)
	fetched := call("GET", "/projects/test", "", "", 200)
	if fetched["name"] != "Test MES" {
		t.Fatal("project did not round trip")
	}
	for _, body := range []string{"{", `{}`} {
		call("POST", "/projects", body, "", 400)
		call("POST", "/projects/test/wiki-nodes", body, "", 400)
		call("DELETE", "/projects/test/token", body, "", 400)
	}
	call("GET", "/projects/missing", "", "", 404)
	call("POST", "/projects/test/wiki-nodes", `{"nodes":[{"plane":"doc","path":"data/wiki/test/doc/a.md","node_id":"REQ-A","bundle_id":"CR-TEST"},{"plane":"code","path":"data/wiki/test/code/a.md","node_id":"API-A"}]}`, "", 200)
	if len(call("GET", "/projects/test/wiki-nodes", "", "", 200)["nodes"].([]any)) != 2 {
		t.Fatal("wiki index mismatch")
	}
	call("GET", "/projects/test", "", "", 200)
	token := call("POST", "/projects/test/token", `{"project_id":"test","scopes":["read_config","write_status"],"expires_in_hours":1}`, "", 201)["token"].(string)
	call("GET", "/projects/test/config", "", token, 200)
	call("GET", "/projects/other/config", "", token, 403)
	call("GET", "/projects/test/config", "", "", 401)
	call("GET", "/projects/test/config", "", "invalid", 401)
	call("POST", "/projects/other/sync-status", `{}`, token, 403)
	call("POST", "/projects/test/sync-status", `{`, token, 400)
	call("POST", "/projects/test/sync-status", `{"repo_name":"service","to_sha":"new-revision","changed_files":2,"affected_modules":["wip"],"duration_ms":10}`, token, 200)
	for _, suffix := range []string{"", "?limit=1", "?limit=0", "?limit=invalid", "?limit=101"} {
		call("GET", "/projects/test/sync-logs"+suffix, "", "", 200)
	}
	expired := time.Now().Add(-time.Hour)
	expiredToken, err := s.IssueToken(context.Background(), "test", []string{"read_config"}, &expired, "test")
	if err != nil {
		t.Fatal(err)
	}
	call("GET", "/projects/test/config", "", expiredToken, 401)
	call("DELETE", "/projects/test/token", `{"token":"`+token+`"}`, "", 200)
	call("GET", "/projects/test/config", "", token, 401)
	call("POST", "/projects/test/token", `{}`, "", 201)
	call("DELETE", "/projects/test", "", "", 200)
	if nodes, _ := call("GET", "/projects/test/wiki-nodes", "", "", 200)["nodes"].([]any); len(nodes) != 0 {
		t.Fatal("deletion did not cascade")
	}
}
