package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"

	"cim-llm-wiki/internal/types"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
)

type contextProjectReader struct{}

func (contextProjectReader) GetProject(_ context.Context, id string) (*types.ProjectConfig, error) {
	switch id {
	case "demo":
		return &types.ProjectConfig{ID: id, Name: "Demo"}, nil
	case "other":
		return nil, pgx.ErrNoRows
	default:
		return nil, errors.New("private database error")
	}
}

func TestProjectContextInternalDiscovery(t *testing.T) {
	gin.SetMode(gin.TestMode)
	secret := strings.Repeat("s", 40)
	h := &DocumentQualityHandler{store: contextProjectReader{}, token: secret}
	r := gin.New()
	g := r.Group("/internal/v1/projects/:id/document-quality", h.InternalAuth())
	g.GET("/:resource", h.List)
	r.GET("/admin/projects/:id/document-quality/:resource", h.List)
	for _, tt := range []struct {
		path, token string
		status      int
	}{
		{"/internal/v1/projects/demo/document-quality/project", secret, 200},
		{"/internal/v1/projects/other/document-quality/project", secret, 404},
		{"/internal/v1/projects/broken/document-quality/project", secret, 503},
		{"/internal/v1/projects/demo/document-quality/project", "", 403},
		{"/admin/projects/demo/document-quality/project", secret, 404},
	} {
		req := httptest.NewRequest("GET", tt.path, nil)
		req.Header.Set("Authorization", "Bearer "+tt.token)
		res := httptest.NewRecorder()
		r.ServeHTTP(res, req)
		if res.Code != tt.status {
			t.Fatalf("%s: got %d: %s", tt.path, res.Code, res.Body.String())
		}
		if strings.Contains(res.Body.String(), "private database") {
			t.Fatal("database details leaked")
		}
		if tt.status == 200 {
			var v struct{ Data map[string]any }
			if err := json.Unmarshal(res.Body.Bytes(), &v); err != nil {
				t.Fatal(err)
			}
			for _, key := range []string{"docs", "repos", "modules"} {
				items, ok := v.Data[key].([]any)
				if !ok || len(items) != 0 {
					t.Fatalf("%s should be an empty collection", key)
				}
			}
		}
	}
}
