package handler

import (
	"net/http/httptest"
	"testing"

	"cim-llm-wiki/internal/documentquality"
	"github.com/gin-gonic/gin"
)

func TestDirectoryCatalogParentFilter(t *testing.T) {
	rows := []documentquality.Record{
		{"path": "doc", "parent_path": "", "display_name": "Documents"},
		{"path": "code", "parent_path": "", "display_name": "Code"},
		{"path": "doc/planning", "parent_path": "doc", "display_name": "Planning"},
	}
	for _, tc := range []struct {
		name  string
		query string
		want  []string
	}{
		{"all directories", "", []string{"doc", "code", "doc/planning"}},
		{"root directories", "?parent=", []string{"doc", "code"}},
		{"child directories", "?parent=doc", []string{"doc/planning"}},
		{"search within root", "?parent=&q=CODE", []string{"code"}},
		{"search within children", "?parent=doc&q=Planning", []string{"doc/planning"}},
		{"missing parent", "?parent=missing", nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest("GET", "/directory-catalog"+tc.query, nil)
			got := filterDirectoryCatalogRows(rows, c.Request.URL.Query())
			if len(got) != len(tc.want) {
				t.Fatalf("expected %v, got %v", tc.want, got)
			}
			for i, path := range tc.want {
				if documentquality.Text(got[i], "path") != path {
					t.Fatalf("expected path %q, got %v", path, got[i])
				}
			}
		})
	}
}
