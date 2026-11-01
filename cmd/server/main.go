// Package main is the entry point for the cim-llm-wiki HTTP server.
//
// Start: go run ./cmd/server
// Env:   see internal/config/config.go for all supported environment variables.
package main

import (
"context"
"fmt"
"log/slog"
"net/http"
"os"
"os/signal"
"path/filepath"
"syscall"
"time"

"github.com/gin-gonic/gin"

"cim-llm-wiki/internal/config"
"cim-llm-wiki/internal/handler"
"cim-llm-wiki/internal/hitl"
"cim-llm-wiki/internal/pipeline/compiler"
"cim-llm-wiki/internal/store"
)

func main() {
slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})))

cfg := config.Load()

// ── Ensure data directories exist ───────────────────────────────────────
for _, dir := range []string{cfg.Wiki.OutputDir, cfg.Wiki.RawDir} {
if err := os.MkdirAll(dir, 0755); err != nil {
slog.Error("cannot create directory", "dir", dir, "err", err)
os.Exit(1)
}
}

// ── Open HITL queue (SQLite) ─────────────────────────────────────────────
slog.Info("opening HITL queue", "dsn", cfg.Storage.DSN)
hitlQ, err := hitl.Open(cfg.Storage.DSN)
if err != nil {
slog.Error("hitl.Open failed", "err", err)
os.Exit(1)
}

// Build the legacy compiler for read-only queries.
comp, err := compiler.New(cfg.Wiki.OutputDir)
if err != nil {
slog.Error("compiler.New failed", "err", err)
os.Exit(1)
}

// ── Admin store (PostgreSQL, optional) ─────────────────────────────────────
var adminStore *store.Store
if cfg.Admin.Enabled {
if cfg.Admin.PostgresDSN == "" {
slog.Error("ADMIN_ENABLED=true but ADMIN_DATABASE_URL is empty")
os.Exit(1)
}
slog.Info("connecting to Admin PostgreSQL", "dsn", cfg.Admin.PostgresDSN)
ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
defer cancel()
adminStore, err = store.New(ctx, cfg.Admin.PostgresDSN)
if err != nil {
slog.Error("admin store connect failed", "err", err)
os.Exit(1)
}
defer adminStore.Close()
// Run migrations
if migSQL, err := loadMigrations(cfg.Admin.MigrationDir); err == nil && migSQL != "" {
if err := adminStore.Migrate(context.Background(), migSQL); err != nil {
slog.Warn("migration failed (may already be applied)", "err", err)
} else {
slog.Info("migrations applied")
}
}
slog.Info("Admin API enabled")
}

// ── HTTP router ───────────────────────────────────────────────────────────
gin.SetMode(gin.ReleaseMode)
r := gin.New()
r.Use(gin.Recovery())
r.Use(requestLogger())

// Health check
r.GET("/healthz", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"status": "ok"}) })

// API v1
v1 := r.Group("/api/v1")
{
// Legacy writes are disabled to enforce the shared wiki contract.
v1.POST("/ingest", handler.LegacyWriteDisabled)

// HITL review workflow
review := handler.NewReviewHandler(cfg, hitlQ, comp)
v1.GET("/review", review.List)
v1.GET("/review/:id", review.Get)
v1.POST("/review/:id/approve", handler.LegacyWriteDisabled)
v1.POST("/review/:id/reject", handler.LegacyWriteDisabled)

// Wiki content queries
wiki := handler.NewWikiHandler(cfg, comp)
v1.GET("/wiki/:id", wiki.GetNode)
v1.GET("/wiki/virtual/:module", wiki.GetVirtualDoc)

// Parser engine info
v1.GET("/parsers", handler.ListParsersHandler(cfg))

// Auth: gateway session login protecting wiki + admin surfaces.
// Registered unconditionally so nginx auth_request always has a target;
// when AUTH_ENABLED=false Verify returns 200 (transparent gate, no lockout).
auth := handler.NewAuthHandler(cfg.Auth)
v1.POST("/auth/login", auth.Login)
v1.POST("/auth/logout", auth.Logout)
v1.GET("/auth/verify", auth.Verify)
if cfg.Auth.Enabled {
slog.Info("Auth session login enabled", "cookie", cfg.Auth.CookieName, "ttl_hours", cfg.Auth.SessionTTLHours)
} else {
slog.Warn("Auth disabled: /wiki/ and /admin/ gate is transparent (open)")
}

// Admin API (Project Registry management, requires PostgreSQL)
if adminStore != nil {
admin := handler.NewAdminHandler(adminStore)
adminGroup := v1.Group("/admin")
{
// Public endpoints (no token required)
adminGroup.GET("/projects", admin.ListProjects)
adminGroup.POST("/projects", admin.UpsertProject)
adminGroup.GET("/projects/:id", admin.GetProject)
adminGroup.DELETE("/projects/:id", admin.DeleteProject)
adminGroup.POST("/projects/:id/token", admin.IssueToken)
adminGroup.DELETE("/projects/:id/token", admin.RevokeToken)
adminGroup.GET("/projects/:id/sync-logs", admin.GetSyncLogs)
adminGroup.GET("/projects/:id/wiki-nodes", admin.GetWikiNodes)
adminGroup.POST("/projects/:id/wiki-nodes", admin.UpsertWikiNodes)

// Token-protected endpoints (skill uses project-token)
adminGroup.GET("/projects/:id/config", admin.TokenAuth(), admin.GetProjectConfig)
adminGroup.POST("/projects/:id/sync-status", admin.TokenAuth(), admin.RecordSyncStatus)
}
slog.Info("Admin API routes registered", "prefix", "/api/v1/admin")
}
}

// ── HTTP server with graceful shutdown ────────────────────────────────────
addr := fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port)
srv := &http.Server{Addr: addr, Handler: r}

go func() {
slog.Info("server listening", "addr", addr)
if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
slog.Error("server error", "err", err)
os.Exit(1)
}
}()

quit := make(chan os.Signal, 1)
signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
<-quit

slog.Info("shutting down…")
ctx, cancel := context.WithTimeout(context.Background(), cfg.Server.ShutdownTimeout)
defer cancel()
_ = srv.Shutdown(ctx)
slog.Info("server stopped")
}

func requestLogger() gin.HandlerFunc {
return func(c *gin.Context) {
start := time.Now()
c.Next()
slog.Info("http",
"method", c.Request.Method,
"path", c.Request.URL.Path,
"status", c.Writer.Status(),
"latency_ms", time.Since(start).Milliseconds(),
)
}
}

// loadMigrations reads all .sql files from dir in sorted order and concatenates them.
func loadMigrations(dir string) (string, error) {
entries, err := os.ReadDir(dir)
if err != nil {
if os.IsNotExist(err) {
return "", nil
}
return "", err
}
var sql string
for _, e := range entries {
if e.IsDir() || filepath.Ext(e.Name()) != ".sql" {
continue
}
data, err := os.ReadFile(filepath.Join(dir, e.Name()))
if err != nil {
return "", fmt.Errorf("read migration %s: %w", e.Name(), err)
}
sql += string(data) + "\n"
}
return sql, nil
}
