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
"syscall"
"time"

"github.com/gin-gonic/gin"

"cim-llm-wiki/internal/config"
"cim-llm-wiki/internal/handler"
"cim-llm-wiki/internal/hitl"
"cim-llm-wiki/internal/pipeline"
"cim-llm-wiki/internal/pipeline/compiler"
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

// ── Build pipeline ───────────────────────────────────────────────────────
slog.Info("initialising pipeline", "wiki_out", cfg.Wiki.OutputDir)
p, err := pipeline.New(cfg, hitlQ)
if err != nil {
slog.Error("pipeline.New failed", "err", err)
os.Exit(1)
}

// ── Build compiler (also needed by review handler) ────────────────────────
comp, err := compiler.New(cfg.Wiki.OutputDir)
if err != nil {
slog.Error("compiler.New failed", "err", err)
os.Exit(1)
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
// Ingest: upload raw doc → run pipeline
ingest := handler.NewIngestHandler(cfg, p)
v1.POST("/ingest", ingest.Handle)

// HITL review workflow
review := handler.NewReviewHandler(cfg, hitlQ, comp)
v1.GET("/review", review.List)
v1.GET("/review/:id", review.Get)
v1.POST("/review/:id/approve", review.Approve)
v1.POST("/review/:id/reject", review.Reject)

// Wiki content queries
wiki := handler.NewWikiHandler(cfg, comp)
v1.GET("/wiki/:id", wiki.GetNode)
v1.GET("/wiki/virtual/:module", wiki.GetVirtualDoc)

// Parser engine info
v1.GET("/parsers", handler.ListParsersHandler(cfg))
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
