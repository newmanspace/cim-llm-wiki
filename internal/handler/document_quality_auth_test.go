package handler

import (
	"cim-llm-wiki/internal/config"
	"github.com/gin-gonic/gin"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDocumentQualityRequiresIndependentRoles(t *testing.T) {
	gin.SetMode(gin.TestMode)
	secret := strings.Repeat("s", 40)
	human := strings.Repeat("h", 40)
	h := &DocumentQualityHandler{token: secret, reviewers: map[string]string{"Reviewer": human}}
	r := gin.New()
	g := r.Group("/internal/v1/projects/:id/document-quality", h.InternalAuth())
	g.POST("/:operation", h.Command)
	for _, test := range []struct{ path, token string }{{"artifacts", ""}, {"data-sources", secret}, {"quality-policies", secret}, {"document-directories", secret}, {"quality-policy-preview", secret}, {"document-review-decisions", secret}} {
		req := httptest.NewRequest("POST", "/internal/v1/projects/demo/document-quality/"+test.path, strings.NewReader(`{}`))
		if test.token != "" {
			req.Header.Set("Authorization", "Bearer "+test.token)
		}
		res := httptest.NewRecorder()
		r.ServeHTTP(res, req)
		if res.Code != 403 {
			t.Fatalf("%s allowed without appropriate role: %d", test.path, res.Code)
		}
	}
	auth := NewAuthHandler(config.AuthConfig{})
	direct := gin.New()
	direct.POST("/admin", auth.RequireSession(), func(c *gin.Context) { c.Status(200) })
	res := httptest.NewRecorder()
	direct.ServeHTTP(res, httptest.NewRequest("POST", "/admin", nil))
	if res.Code != 403 {
		t.Fatal("disabled sessions opened configuration writes")
	}
}
