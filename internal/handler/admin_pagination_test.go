package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestSyncLogRejectsInvalidOffset(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/projects/:id/sync-logs", NewAdminHandler(nil).GetSyncLogs)
	for _, value := range []string{"-1", "invalid", "1.5", "999999999999999999999999"} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/projects/demo/sync-logs?offset="+value, nil))
		if w.Code != http.StatusBadRequest {
			t.Fatalf("offset %q: status %d", value, w.Code)
		}
	}
}

func TestSyncLogPaginationReadsPastFiftyAndKeepsProjectScope(t *testing.T) {
	s := isolatedAdminStore(t)
	// All records share a timestamp to exercise the id tie-breaker as well.
	err := s.Migrate(context.Background(), `
 INSERT INTO projects (id,name,product,version) VALUES ('pages','Pages','Test','1'), ('other','Other','Test','1');
 INSERT INTO sync_logs (project_id,repo_name,synced_at) SELECT 'pages', 'repo-' || n, '2026-01-01T00:00:00Z'::timestamptz FROM generate_series(1,101) n;
 INSERT INTO sync_logs (project_id,repo_name) VALUES ('other','hidden');`)
	if err != nil {
		t.Fatal(err)
	}
	r := gin.New()
	r.GET("/projects/:id/sync-logs", NewAdminHandler(s).GetSyncLogs)
	read := func(query string) (int, []struct {
		ID        int    `json:"id"`
		ProjectID string `json:"project_id"`
	}) { t.Helper(); w := httptest.NewRecorder(); r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/projects/pages/sync-logs?"+query, nil)); if w.Code != 200 {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}; var data struct {
		Total int `json:"total"`
		Logs  []struct {
			ID        int    `json:"id"`
			ProjectID string `json:"project_id"`
		} `json:"logs"`
	}; if err := json.Unmarshal(w.Body.Bytes(), &data); err != nil {
		t.Fatal(err)
	}; return data.Total, data.Logs }
	total, first := read("limit=50&offset=0")
	if total != 101 || len(first) != 50 {
		t.Fatalf("first page: total=%d count=%d", total, len(first))
	}
	_, second := read("limit=50&offset=50")
	_, last := read("limit=50&offset=100")
	seen := map[int]bool{}
	for _, row := range append(append(first, second...), last...) {
		if row.ProjectID != "pages" || seen[row.ID] {
			t.Fatal("cross-project or duplicate row")
		}
		seen[row.ID] = true
	}
	if len(seen) != 101 || len(last) != 1 {
		t.Fatalf("missing historical rows: %d", len(seen))
	}
	total, empty := read("limit=20&offset=200")
	if total != 101 || len(empty) != 0 {
		t.Fatal("empty page lost total")
	}
}
