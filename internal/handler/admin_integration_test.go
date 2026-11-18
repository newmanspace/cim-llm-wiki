package handler

import (
	"cim-llm-wiki/internal/store"
	"context"
	"encoding/json"
	"fmt"
	"github.com/gin-gonic/gin"
	"net/http"
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
	templateService := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Modules []string `json:"modules"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil || request.Modules == nil {
			http.Error(w, `{"error":"Explicit modules are required"}`, http.StatusUnprocessableEntity)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"directories":[]}`))
	}))
	defer templateService.Close()
	t.Setenv("CIM_WIKI_KNOWLEDGE_URL", templateService.URL)
	t.Setenv("CIM_WIKI_LEDGER_TOKEN", strings.Repeat("s", 40))

	gin.SetMode(gin.TestMode)
	s := isolatedAdminStore(t)
	h := NewAdminHandler(s)
	router := gin.New()
	router.GET("/projects", h.ListProjects)
	router.POST("/projects", h.CreateProject)
	router.PATCH("/projects/:id", h.UpdateProject)
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
	// An edit is independent of template initialization and accepts only basics.
	call("POST", "/projects", `{"id":"no-modules","name":"No modules"}`, "", 200)
	t.Setenv("CIM_WIKI_KNOWLEDGE_URL", "http://127.0.0.1:1")
	call("PATCH", "/projects/no-modules", `{"name":"Updated empty project"}`, "", 200)
	if call("GET", "/projects/no-modules", "", "", 200)["name"] != "Updated empty project" {
		t.Fatal("empty project edit was not persisted")
	}
	call("DELETE", "/projects/no-modules", "", "", 200)
	t.Setenv("CIM_WIKI_KNOWLEDGE_URL", templateService.URL)
	project := `{"id":"test","name":"Test MES","product":"MES","version":"v1"}`
	for _, body := range []string{`{"id":"bad","name":"Bad","docs":[]}`, `{"id":"bad","name":"Bad","repos":[]}`, `{"id":"bad","name":"Bad","modules":[]}`, `{"id":"bad","name":"Bad","wiki_nodes":{}}`, `{"id":"bad","name":null}`, `{"id":"bad"}`, `{"id":"bad","name":"Bad"} {}`} {
		call("POST", "/projects", body, "", 400)
	}
	call("POST", "/projects", project, "", 200)
	call("POST", "/projects", project, "", 409)
	if err := s.Migrate(context.Background(), `INSERT INTO project_modules(project_id,module_id) VALUES('test','wip');
 INSERT INTO project_docs(project_id,doc_id,path,type) VALUES('test','IDD','shared://test/source.xlsx','IDD');
 INSERT INTO project_repos(project_id,name,url,branch) VALUES('test','service','https://example.test/repo','main')`); err != nil {
		t.Fatal(err)
	}
	before := call("GET", "/projects/test", "", "", 200)
	call("PATCH", "/projects/test", `{"name":"Changed name"}`, "", 200)
	after := call("GET", "/projects/test", "", "", 200)
	for _, key := range []string{"product", "version", "modules", "docs", "repos", "wiki_nodes", "sync_state", "created_at"} {
		left, _ := json.Marshal(before[key])
		right, _ := json.Marshal(after[key])
		if string(left) != string(right) {
			t.Fatalf("basic edit changed %s: %s -> %s", key, left, right)
		}
	}
	for _, body := range []string{`{}`, `null`, `{"name":null}`, `{"modules":[]}`, `{"docs":[]}`, `{"name":"x","repos":[]}`, `{"id":"other"}`, `{"version":3}`, `{"name":"x"} {}`} {
		call("PATCH", "/projects/test", body, "", 400)
	}
	if call("GET", "/projects/test", "", "", 200)["name"] != "Changed name" {
		t.Fatal("invalid patch partially changed the project")
	}
	call("PATCH", "/projects/missing", `{"name":"Missing"}`, "", 404)
	call("PATCH", "/projects/test", `{"product":""}`, "", 200)
	if call("GET", "/projects/test", "", "", 200)["product"] != "" {
		t.Fatal("explicit empty string did not clear the supplied basic field")
	}
	call("PATCH", "/projects/test", `{"name":"Test MES"}`, "", 200)
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
