// Package main is the entry point for the cim-llm-wiki HTTP server.
//
// Start: go run ./cmd/server
// Env:   see internal/config/config.go for all supported environment variables.
package main

import (
	"context"
	"crypto/rand"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"

	"cim-llm-wiki/internal/config"
	"cim-llm-wiki/internal/handler"
	"cim-llm-wiki/internal/hitl"
	"cim-llm-wiki/internal/observability"
	"cim-llm-wiki/internal/pipeline/compiler"
	"cim-llm-wiki/internal/store"
)

func main() {
	slog.SetDefault(observability.NewLogger(os.Stdout, "cim-wiki-server"))

	cfg := config.Load()

	router, cleanup, err := buildHandler(cfg)
	if err != nil {
		slog.Error("server initialization failed", "err", err)
		os.Exit(1)
	}
	defer cleanup()

	// ── HTTP server with graceful shutdown ────────────────────────────────────
	addr := fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port)
	srv := &http.Server{Addr: addr, Handler: router}

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

// buildHandler initializes isolated application resources and returns their cleanup.
func buildHandler(cfg *config.Config) (http.Handler, func(), error) {
	if err := cfg.Auth.Validate(); err != nil {
		return nil, nil, err
	}
	// ── Ensure data directories exist ───────────────────────────────────────
	for _, dir := range []string{cfg.Wiki.OutputDir, cfg.Wiki.RawDir} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return nil, nil, fmt.Errorf("create directory %s: %w", dir, err)
		}
	}

	// ── Open HITL queue (SQLite) ─────────────────────────────────────────────
	slog.Info("opening HITL queue")
	hitlQ, err := hitl.Open(cfg.Storage.DSN)
	if err != nil {
		return nil, nil, fmt.Errorf("open review queue: %w", err)
	}

	// Build the legacy compiler for read-only queries.
	comp, err := compiler.New(cfg.Wiki.OutputDir)
	if err != nil {
		return nil, nil, fmt.Errorf("open compiler: %w", err)
	}

	adminStore, err := openAdminStore(cfg)
	if err != nil {
		return nil, nil, err
	}
	cleanup := func() {
		if adminStore != nil {
			adminStore.Close()
		}
	}
	// ── HTTP router ───────────────────────────────────────────────────────────
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(requestLogger(), requestRecovery())

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

		wikiBuilds := handler.NewWikiBuildHandler()
		buildManagement := v1.Group("/admin/projects/:id/wiki-builds", auth.RequireSession())
		buildManagement.GET("", wikiBuilds.Handle)
		buildManagement.POST("/:action", wikiBuilds.Handle)
		v1.GET("/admin/wiki-preview-access", auth.RequireSession(), wikiBuilds.PreviewAccess)

		// Admin API (Project Registry management, requires PostgreSQL)
		if adminStore != nil {
			admin := handler.NewAdminHandler(adminStore)
			projectWiki := v1.Group("/admin/projects/:id/wiki", auth.RequireSession())
			projectWiki.Use(func(c *gin.Context) {
				if _, err := adminStore.GetProject(c.Request.Context(), c.Param("id")); err != nil {
					c.AbortWithStatusJSON(404, gin.H{"error": "Project not found"})
					return
				}
				c.Next()
			})
			projectWiki.GET("", wikiBuilds.ProjectWiki)
			projectWiki.GET("/:action", wikiBuilds.ProjectWiki)
			projectWiki.POST("/:action", wikiBuilds.ProjectWiki)
			documentDefaults := handler.NewDocumentDefaultsHandler(adminStore)
			settings := v1.Group("/admin/system/document-templates", auth.RequireSession())
			settings.GET("", documentDefaults.Handle)
			settings.POST("/:action", documentDefaults.Handle)
			settings.GET("/:action", documentDefaults.Handle)
			quality := handler.NewDocumentQualityHandler(adminStore)
			if quality.Ready() {
				internal := r.Group("/internal/v1/projects/:id/document-quality", quality.InternalAuth())
				internal.GET("/:resource", quality.List)
				internal.POST("/:operation", quality.Command)
				management := v1.Group("/admin/projects/:id/document-quality", auth.RequireSession())
				management.GET("/:resource", quality.List)
				management.POST("/:operation", quality.Command)
			}

			adminGroup := v1.Group("/admin")
			{
				// Public endpoints (no token required)
				adminGroup.GET("/projects", admin.ListProjects)
				adminGroup.POST("/projects", auth.RequireSession(), admin.CreateProject)
				adminGroup.PATCH("/projects/:id", auth.RequireSession(), admin.UpdateProject)
				adminGroup.POST("/projects/:id/code-sources", auth.RequireSession(), admin.SaveCodeSource)
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

	return r, cleanup, nil
}

func openAdminStore(cfg *config.Config) (*store.Store, error) {
	if !cfg.Admin.Enabled {
		return nil, nil
	}
	if cfg.Admin.PostgresDSN == "" {
		return nil, fmt.Errorf("ADMIN_ENABLED=true but ADMIN_DATABASE_URL is empty")
	}
	slog.Info("connecting to Admin PostgreSQL")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	adminStore, err := store.New(ctx, cfg.Admin.PostgresDSN)
	if err != nil {
		return nil, err
	}
	if err := applyAdminMigrations(ctx, adminStore, cfg.Admin.MigrationDir); err != nil {
		adminStore.Close()
		return nil, err
	}

	return adminStore, nil
}

// Keep panic output structured and avoid Gin's default request/stack dump.
func requestRecovery() gin.HandlerFunc {
	return gin.CustomRecoveryWithWriter(nil, func(c *gin.Context, _ any) {
		observability.ReportFailure(c.Request.Context(), "request.recover", "INTERNAL_PANIC", "Request panic recovered")
		c.AbortWithStatus(http.StatusInternalServerError)
	})
}

var requestIDPattern = regexp.MustCompile(`^[a-zA-Z0-9._-]{1,128}$`)

const headerRequestID = "X-Request-ID"

func requestLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		id := c.GetHeader(headerRequestID)
		if !requestIDPattern.MatchString(id) {
			var bytes [16]byte
			if _, err := rand.Read(bytes[:]); err != nil {
				observability.ReportFailure(
					c.Request.Context(), "request.identify",
					"REQUEST_ID_GENERATION_FAILED", "Request ID generation failed",
				)
				c.AbortWithStatus(http.StatusInternalServerError)
				return
			}
			id = fmt.Sprintf("%x", bytes)
		}
		c.Request.Header.Set(headerRequestID, id)
		c.Header(headerRequestID, id)
		logger := slog.Default().With(
			"http.request.id", id,
			"http.request.method", c.Request.Method,
			"url.path", c.Request.URL.EscapedPath(),
		)
		c.Request = c.Request.WithContext(observability.WithLogger(c.Request.Context(), logger))
		c.Next()
		status := c.Writer.Status()
		outcome := "success"
		if status >= 400 {
			outcome = "failure"
		}
		observability.Logger(c.Request.Context()).LogAttrs(
			c.Request.Context(), observability.HTTPLevel(status), "HTTP request completed",
			slog.String("event.action", "request.completed"), slog.String("event.outcome", outcome),
			slog.Int64("event.duration", time.Since(start).Nanoseconds()), slog.Int("http.response.status_code", status),
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

func applyAdminMigrations(ctx context.Context, db *store.Store, dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("read migration directory: %w", err)
	}
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".sql" {
			continue
		}
		content, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			return err
		}
		if err = db.ApplyMigration(ctx, entry.Name(), string(content)); err != nil {
			return err
		}
	}
	return nil
}
