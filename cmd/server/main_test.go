package main

import (
	"bytes"
	"cim-llm-wiki/internal/config"
	"cim-llm-wiki/internal/observability"
	"cim-llm-wiki/internal/store"
	"context"
	"encoding/json"
	"fmt"
	"github.com/gin-gonic/gin"
	"log/slog"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func testConfig(t *testing.T) *config.Config {
	root := t.TempDir()
	return &config.Config{Wiki: config.WikiConfig{OutputDir: filepath.Join(root, "wiki"), RawDir: filepath.Join(root, "raw")}, Storage: config.StorageConfig{DSN: filepath.Join(root, "queue.json")}}
}

func TestServerRoutesPreserveWriteGateAndQueries(t *testing.T) {
	cfg := testConfig(t)
	router, cleanup, err := buildHandler(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	for _, tt := range []struct {
		method, path string
		status       int
	}{{"GET", "/healthz", 200}, {"POST", "/api/v1/ingest", 410}, {"POST", "/api/v1/review/CR-TEST/approve", 410}, {"POST", "/api/v1/review/CR-TEST/reject", 410}, {"GET", "/api/v1/review", 200}, {"GET", "/api/v1/review/missing", 404}, {"GET", "/api/v1/wiki/missing", 404}, {"GET", "/api/v1/wiki/virtual/wip?type=sdd", 200}, {"GET", "/api/v1/parsers", 200}, {"GET", "/api/v1/auth/verify", 200}} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(tt.method, tt.path, nil))
		if response.Code != tt.status {
			t.Fatalf("%s %s: status %d", tt.method, tt.path, response.Code)
		}
	}
	path := filepath.Join(cfg.Wiki.OutputDir, "requirements", "req-test.md")
	if err := os.WriteFile(path, []byte("# Requirement\nSource trace"), 0600); err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest("GET", "/api/v1/wiki/REQ-TEST", nil))
	if response.Code != 200 || !strings.Contains(response.Body.String(), "Source trace") {
		t.Fatal("wiki content not readable")
	}
}

func TestStartupErrorsAndMigrations(t *testing.T) {
	unsafe := testConfig(t)
	unsafe.Auth.Enabled = true
	if _, _, err := buildHandler(unsafe); err == nil {
		t.Fatal("authentication must reject an unset session-signing secret at startup")
	}
	cfg := testConfig(t)
	if err := os.WriteFile(cfg.Wiki.OutputDir, []byte("file"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := buildHandler(cfg); err == nil {
		t.Fatal("invalid output directory accepted")
	}
	cfg = testConfig(t)
	if err := os.WriteFile(cfg.Storage.DSN, []byte("invalid JSON"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := buildHandler(cfg); err == nil {
		t.Fatal("invalid queue accepted")
	}
	cfg = testConfig(t)
	cfg.Admin.Enabled = true
	if _, _, err := buildHandler(cfg); err == nil {
		t.Fatal("admin without database configuration accepted")
	}
	cfg.Admin.PostgresDSN = ":invalid:"
	if _, err := openAdminStore(cfg); err == nil {
		t.Fatal("invalid database configuration accepted")
	}
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "002.sql"), []byte("SELECT 2;"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "001.sql"), []byte("SELECT 1;"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "note.txt"), []byte("ignored"), 0600); err != nil {
		t.Fatal(err)
	}
	text, err := loadMigrations(dir)
	if err != nil || text != "SELECT 1;\nSELECT 2;\n" {
		t.Fatal("migration order changed", err)
	}
	if text, err := loadMigrations(filepath.Join(dir, "missing")); err != nil || text != "" {
		t.Fatal("missing optional migrations directory failed")
	}
}

func TestAdminServerInitializesRoutesInIsolatedSchema(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL required")
	}
	ctx := context.Background()
	base, err := store.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	schema := fmt.Sprintf("quality_server_%d", time.Now().UnixNano())
	if err := base.Migrate(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer base.Close()
	defer func() {
		if err := base.Migrate(ctx, "DROP SCHEMA "+schema+" CASCADE"); err != nil {
			t.Error(err)
		}
	}()
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	params := parsed.Query()
	params.Set("search_path", schema)
	parsed.RawQuery = params.Encode()
	cfg := testConfig(t)
	cfg.Auth.Enabled = true
	cfg.Auth.SessionSecret = strings.Repeat("test", 16)
	cfg.Admin = config.AdminConfig{Enabled: true, PostgresDSN: parsed.String(), MigrationDir: "../../deploy/postgres"}
	router, cleanup, err := buildHandler(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest("GET", "/api/v1/admin/projects", nil))
	if response.Code != 200 {
		t.Fatal("admin routes missing")
	}
	response = httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest("GET", "/api/v1/auth/verify", nil))
	if response.Code != 401 {
		t.Fatal("enabled auth allowed anonymous access")
	}
}

func TestRequestLogsCannotCarryInjectedLineBreaks(t *testing.T) {
	var output bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&output, nil)))
	defer slog.SetDefault(previous)
	router := gin.New()
	router.Use(requestLogger())
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest("GET", "/unknown%0AFORGED%0Dentry", nil))
	var entry map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(output.Bytes()), &entry); err != nil {
		t.Fatal("forged log record", err)
	}
	if path, ok := entry["url.path"].(string); !ok || strings.ContainsAny(path, "\r\n") {
		t.Fatal("decoded log field contains injected line breaks")
	}
}

func TestRequestLogCorrelationAndQueryRedaction(t *testing.T) {
	var output bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&output, nil)))
	defer slog.SetDefault(previous)
	router := gin.New()
	router.Use(requestLogger())
	router.GET("/failure", func(c *gin.Context) { c.Status(422) })
	for _, id := range []string{"test-correlation-001", "invalid id"} {
		output.Reset()
		req := httptest.NewRequest("GET", "/failure?token=private-query-marker", nil)
		req.Header.Set("X-Request-ID", id)
		req.Header.Set("Authorization", "Bearer private-token-marker")
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		returned := response.Header().Get("X-Request-ID")
		if !requestIDPattern.MatchString(returned) || (id == "test-correlation-001" && returned != id) {
			t.Fatal("invalid correlation ID")
		}
		var record struct {
			RequestID string `json:"http.request.id"`
			Status    int    `json:"http.response.status_code"`
			Outcome   string `json:"event.outcome"`
			Duration  int64  `json:"event.duration"`
		}
		if err := json.Unmarshal(output.Bytes(), &record); err != nil {
			t.Fatal(err)
		}
		if record.RequestID != returned || record.Status != 422 || record.Outcome != "failure" || record.Duration <= 0 {
			t.Fatal("invalid access log", output.String())
		}

		if strings.Contains(output.String(), "private-query-marker") || strings.Contains(output.String(), "private-token-marker") {
			t.Fatal("sensitive data logged")
		}
	}
}

func TestPanicRecoveryKeepsCorrelationWithoutDumpingPayload(t *testing.T) {
	var output bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(observability.NewLogger(&output, "test-server"))
	defer slog.SetDefault(previous)
	router := gin.New()
	router.Use(requestLogger(), requestRecovery())
	router.GET("/panic", func(c *gin.Context) { panic("private-panic-payload") })
	request := httptest.NewRequest("GET", "/panic?token=private-query", nil)
	request.Header.Set("X-Request-ID", "panic-request-001")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != 500 {
		t.Fatal("panic did not return 500")
	}
	decoder := json.NewDecoder(&output)
	for _, action := range []string{"operation.failed", "request.completed"} {
		var record map[string]any
		if err := decoder.Decode(&record); err != nil {
			t.Fatal(err)
		}
		if record["event.action"] != action || record["http.request.id"] != "panic-request-001" || record["service.name"] != "test-server" {
			t.Fatal("missing correlated event", record)
		}
	}
	if strings.Contains(output.String(), "private-panic-payload") || strings.Contains(output.String(), "private-query") {
		t.Fatal("panic log leaked content")
	}
}
