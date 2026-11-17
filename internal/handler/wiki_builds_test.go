package handler

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWikiBuildProxyScopesProjectAndDoesNotExposeCredential(t *testing.T) {
	token := strings.Repeat("s", 32)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+token {
			t.Error("missing internal authentication")
		}
		if r.URL.Path != "/internal/wiki-builds/preview" || r.URL.Query().Get("project") != "demo" {
			t.Errorf("unexpected scope: %s", r.URL.String())
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"site_build":{"state":"queued"}}`))
	}))
	defer upstream.Close()
	t.Setenv("CIM_WIKI_KNOWLEDGE_URL", upstream.URL)
	t.Setenv("CIM_WIKI_LEDGER_TOKEN", token)
	h := NewWikiBuildHandler()
	r := gin.New()
	r.POST("/projects/:id/wiki-builds/:action", h.Handle)
	w := httptest.NewRecorder()
	request := httptest.NewRequest("POST", "/projects/demo/wiki-builds/preview?project=other", strings.NewReader(`{"bundle_id":"CR-1"}`))
	r.ServeHTTP(w, request)
	if w.Code != 200 || strings.Contains(w.Body.String(), token) {
		t.Fatalf("unexpected reply: %d %s", w.Code, w.Body.String())
	}
}

func TestWikiPreviewAccessChecksEverySubresourceAndFailsClosed(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/internal/wiki-builds/access" || r.URL.Query().Get("preview") != "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" {
			t.Errorf("bad preview check: %s", r.URL.String())
		}
		_ = json.NewEncoder(w).Encode(map[string]bool{"allowed": r.Header.Get("X-Settings-Actor") == "active"})
	}))
	defer upstream.Close()
	t.Setenv("CIM_WIKI_KNOWLEDGE_URL", upstream.URL)
	t.Setenv("CIM_WIKI_LEDGER_TOKEN", strings.Repeat("s", 32))
	for _, entry := range []struct {
		uri, actor string
		status     int
	}{
		{"/wiki-preview/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/assets/search.js", "active", 200},
		{"/wiki-preview/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/", "revoked", 403},
		{"/wiki-preview/../secret", "active", 403},
	} {
		h := NewWikiBuildHandler()
		r := gin.New()
		r.GET("/access", func(c *gin.Context) { c.Set("quality_actor", entry.actor) }, h.PreviewAccess)
		w := httptest.NewRecorder()
		request := httptest.NewRequest("GET", "/access", nil)
		request.Header.Set("X-Original-URI", entry.uri)
		r.ServeHTTP(w, request)
		if w.Code != entry.status {
			t.Fatalf("%s: got %d", entry.uri, w.Code)
		}
	}
}
