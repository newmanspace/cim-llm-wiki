package handler

import (
	"cim-llm-wiki/internal/types"
	"context"
	"encoding/json"
	"github.com/gin-gonic/gin"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCodeSourcesGitSVNAndMappingPreservation(t *testing.T) {
	s := isolatedAdminStore(t)
	ctx := context.Background()
	if e := s.UpsertProject(ctx, &types.ProjectConfig{ID: "code-test", Name: "Code test", Repos: []types.RepoBinding{{Name: "existing", URL: "https://example.test/old.git", Branch: "main", ModuleMapping: map[string]string{"src/": "wip"}, LastSyncSHA: strings.Repeat("a", 40)}}}); e != nil {
		t.Fatal(e)
	}
	h := NewAdminHandler(s)
	router := gin.New()
	router.POST("/projects/:id/code-sources", h.SaveCodeSource)
	send := func(project, body string) int {
		t.Helper()
		req := httptest.NewRequest("POST", "/projects/"+project+"/code-sources", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		out := httptest.NewRecorder()
		router.ServeHTTP(out, req)
		return out.Code
	}
	if status := send("code-test", `{"name":"svn-core","type":"svn","url":"https://example.test/svn/core","subpath":"trunk/src","revision_selector":"42","enabled":true}`); status != 200 {
		t.Fatalf("svn %d", status)
	}
	if status := send("code-test", `{"name":"git-core","type":"git","url":"git@example.test:team/core.git","revision_selector":"release/v1","enabled":true}`); status != 200 {
		t.Fatalf("git %d", status)
	}
	if status := send("code-test", `{"name":"existing","type":"git","url":"https://example.test/new.git","revision_selector":"main","expected_revision":1,"enabled":false}`); status != 200 {
		t.Fatalf("update %d", status)
	}
	p, e := s.GetProject(ctx, "code-test")
	if e != nil {
		t.Fatal(e)
	}
	for _, r := range p.Repos {
		switch r.Name {
		case "existing":
			if r.ConfigRevision != 2 || r.ModuleMapping["src/"] != "wip" || r.LastSyncSHA != "" || r.Enabled == nil || *r.Enabled {
				t.Fatalf("mapping or baseline: %+v", r)
			}
		case "git-core":
			if r.URL != "ssh://git@example.test/team/core.git" || r.Auth != "git_local" {
				t.Fatalf("git config %+v", r)
			}
		case "svn-core":
			if r.Type != "svn" || r.Subpath != "trunk/src" || r.RevisionSelector != "42" || r.Auth != "svn_cache" {
				t.Fatalf("svn config %+v", r)
			}
		}
	}
	for _, body := range []string{`{"name":"git-core","type":"git","url":"https://example.test/a","revision_selector":"main","expected_revision":2}`, `{"name":"existing","type":"svn","url":"https://example.test/svn","revision_selector":"HEAD","expected_revision":2}`} {
		if status := send("code-test", body); status != 409 {
			t.Fatalf("conflict %d", status)
		}
	}
	for _, body := range []string{`{"name":"bad","type":"git","url":"https://secret@example.test/a","revision_selector":"main"}`, `{"name":"bad","type":"svn","url":"https://example.test/a","revision_selector":"main"}`, `{"name":"bad","type":"git","url":"ssh://git@example.test/a","subpath":"../secret","revision_selector":"HEAD"}`} {
		if status := send("code-test", body); status != 422 {
			t.Fatalf("invalid %d", status)
		}
	}
	if status := send("missing", `{"name":"a","type":"git","url":"https://example.test/a","revision_selector":"HEAD"}`); status != 404 {
		t.Fatalf("project %d", status)
	}
	b, _ := json.Marshal(p)
	if strings.Contains(string(b), "password") {
		t.Fatal("credentials persisted")
	}
}
