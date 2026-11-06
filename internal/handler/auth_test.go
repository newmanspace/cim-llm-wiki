package handler

import (
	"cim-llm-wiki/internal/config"
	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCredentialAndSessionFlow(t *testing.T) {
	gin.SetMode(gin.TestMode)
	hash, err := bcrypt.GenerateFromPassword([]byte("correct-password"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	h := NewAuthHandler(config.AuthConfig{Enabled: true, Username: "operator", PasswordHash: string(hash), Password: "ignored", SessionSecret: "unit-test-session-signing-key", CookieName: "session", SessionTTLHours: 1, Secure: true})
	for _, tt := range []struct {
		user, password string
		valid          bool
	}{{"operator", "correct-password", true}, {"wrong", "correct-password", false}, {"operator", "wrong", false}, {"operator", "ignored", false}} {
		if h.authenticate(tt.user, tt.password) != tt.valid {
			t.Fatalf("unexpected authentication for %q", tt.user)
		}
	}
	router := gin.New()
	router.POST("/login", h.Login)
	router.POST("/logout", h.Logout)
	router.GET("/verify", h.Verify)
	for _, body := range []string{"{", `{"username":"operator","password":"wrong"}`} {
		res := httptest.NewRecorder()
		router.ServeHTTP(res, httptest.NewRequest("POST", "/login", strings.NewReader(body)))
		if res.Code == http.StatusOK {
			t.Fatal("invalid login accepted")
		}
	}
	res := httptest.NewRecorder()
	router.ServeHTTP(res, httptest.NewRequest("POST", "/login", strings.NewReader(`{"username":"operator","password":"correct-password"}`)))
	if res.Code != 200 || len(res.Result().Cookies()) != 1 {
		t.Fatalf("login failed: %s", res.Body.String())
	}
	cookie := res.Result().Cookies()[0]
	if !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteLaxMode {
		t.Fatal("unsafe session cookie")
	}
	for _, token := range []string{"", "invalid", "a.", ".a", "!.a", "YWJj.bad", h.signSession("operator") + "tampered"} {
		request := httptest.NewRequest("GET", "/verify", nil)
		if token != "" {
			request.AddCookie(&http.Cookie{Name: "session", Value: token})
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != 401 {
			t.Fatal("invalid session accepted")
		}
	}
	request := httptest.NewRequest("GET", "/verify", nil)
	request.AddCookie(cookie)
	res = httptest.NewRecorder()
	router.ServeHTTP(res, request)
	if res.Code != 200 || res.Header().Get("X-Auth-User") != "operator" {
		t.Fatal("session did not verify")
	}
	res = httptest.NewRecorder()
	router.ServeHTTP(res, httptest.NewRequest("POST", "/logout", nil))
	if res.Result().Cookies()[0].MaxAge >= 0 {
		t.Fatal("logout did not expire cookie")
	}
	h.cfg.Enabled = false
	res = httptest.NewRecorder()
	router.ServeHTTP(res, httptest.NewRequest("GET", "/verify", nil))
	if res.Code != 200 {
		t.Fatal("disabled auth should permit anonymous access")
	}
	h.cfg.SessionTTLHours = -1
	if _, ok := h.parseSession(h.signSession("operator")); ok {
		t.Fatal("expired session accepted")
	}
	h.cfg.SessionTTLHours = 1
	if _, ok := h.parseSession(h.signSession("bad|name")); !ok {
		t.Fatal("signed username should preserve delimiter")
	}
}

func TestCredentialFallbackFailsClosed(t *testing.T) {
	h := NewAuthHandler(config.AuthConfig{Username: "operator"})
	if h.authenticate("operator", "") {
		t.Fatal("empty credential accepted")
	}
	h.cfg.Password = "dev-password"
	if !h.authenticate("operator", "dev-password") || h.authenticate("operator", "bad") {
		t.Fatal("dev credential mismatch")
	}
	h.cfg.PasswordHash = "invalid-hash"
	if h.authenticate("operator", "dev-password") {
		t.Fatal("invalid hash must not fall back")
	}
}
