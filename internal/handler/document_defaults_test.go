package handler

import (
	"cim-llm-wiki/internal/config"
	"github.com/gin-gonic/gin"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDocumentDefaultsRequiresSessionAndForwardsIdentity(t *testing.T) {
	gin.SetMode(gin.TestMode)
	token := strings.Repeat("s", 40)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+token || r.Header.Get("X-Settings-Actor") != "operator" {
			t.Error("missing trusted service identity")
		}
		if r.URL.Path != "/internal/document-defaults/check" {
			t.Error("unexpected target")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"errors":[]}`))
	}))
	defer upstream.Close()
	auth := NewAuthHandler(config.AuthConfig{Enabled: true, Username: "operator", SessionSecret: strings.Repeat("x", 40), CookieName: "test_session", SessionTTLHours: 1})
	h := &DocumentDefaultsHandler{URL: upstream.URL, Token: token, Client: upstream.Client()}
	router := gin.New()
	router.POST("/settings/:action", auth.RequireSession(), h.Handle)
	req := httptest.NewRequest("POST", "/settings/check", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer project-token")
	denied := httptest.NewRecorder()
	router.ServeHTTP(denied, req)
	if denied.Code != 401 {
		t.Fatalf("anonymous write: %d", denied.Code)
	}
	req = httptest.NewRequest("POST", "/settings/check", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "test_session", Value: auth.signSession("operator")})
	result := httptest.NewRecorder()
	router.ServeHTTP(result, req)
	if result.Code != 200 {
		t.Fatalf("authenticated write: %d %s", result.Code, result.Body.String())
	}
}
