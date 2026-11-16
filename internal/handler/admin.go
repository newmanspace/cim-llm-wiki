package handler

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"cim-llm-wiki/internal/store"
	"cim-llm-wiki/internal/types"
)

// AdminHandler serves the /api/v1/admin/* endpoints for Project Registry management.
type AdminHandler struct {
	store *store.Store
}

func NewAdminHandler(s *store.Store) *AdminHandler {
	return &AdminHandler{store: s}
}

// ─── Auth Middleware ─────────────────────────────────────────────────────────

// TokenAuth validates the Bearer token and injects project_id into context.
func (h *AdminHandler) TokenAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		auth := c.GetHeader("Authorization")
		if !strings.HasPrefix(auth, "Bearer ") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing or invalid Authorization header"})
			return
		}
		token := strings.TrimPrefix(auth, "Bearer ")
		projectID, scopes, err := h.store.ValidateToken(c.Request.Context(), token)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
			return
		}
		c.Set("project_id", projectID)
		c.Set("token_scopes", scopes)
		c.Next()
	}
}

// ─── Project CRUD ────────────────────────────────────────────────────────────

// ListProjects GET /api/v1/admin/projects
func (h *AdminHandler) ListProjects(c *gin.Context) {
	projects, err := h.store.ListProjects(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"projects": projects, "count": len(projects)})
}

// GetProject GET /api/v1/admin/projects/:id
func (h *AdminHandler) GetProject(c *gin.Context) {
	id := c.Param("id")
	p, err := h.store.GetProject(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found", "id": id})
		return
	}
	c.JSON(http.StatusOK, p)
}

// GetProjectConfig GET /api/v1/admin/projects/:id/config
// This is the endpoint skill calls with a project-token to pull config.
func (h *AdminHandler) GetProjectConfig(c *gin.Context) {
	id := c.Param("id")
	if tokenProjectID, exists := c.Get("project_id"); exists {
		if pid, ok := tokenProjectID.(string); ok && pid != id {
			c.JSON(http.StatusForbidden, gin.H{"error": "token does not match requested project"})
			return
		}
	}
	p, err := h.store.GetProject(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}
	c.JSON(http.StatusOK, p)
}

// CreateProject POST /api/v1/admin/projects; existing projects use PATCH.
func (h *AdminHandler) CreateProject(c *gin.Context) {
	fields, ok := readProjectFields(c, true)
	if !ok {
		return
	}
	p := types.NewProject{ID: fields["id"], Name: fields["name"], Product: fields["product"], Version: fields["version"]}
	if strings.TrimSpace(p.ID) == "" || strings.TrimSpace(p.Name) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Project id and name are required"})
		return
	}
	if _, err := h.store.GetProject(c.Request.Context(), p.ID); err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "Project already exists; use PATCH to update basic information"})
		return
	} else if !errors.Is(err, pgx.ErrNoRows) {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Project lookup failed"})
		return
	}
	directories, err := NewDocumentDefaultsHandler(h.store).InitializeProject(c, p.ID, p.Name, p.Version)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "Project document initialization failed", "detail": err.Error()})
		return
	}
	if err := h.store.CreateProject(c.Request.Context(), &p, directories); err != nil {
		var databaseError *pgconn.PgError
		if errors.As(err, &databaseError) && databaseError.Code == "23505" {
			c.JSON(http.StatusConflict, gin.H{"error": "Project already exists"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Project creation failed"})
		}
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok", "id": p.ID})
}

// UpdateProject PATCH /api/v1/admin/projects/:id changes basic information only.
func (h *AdminHandler) UpdateProject(c *gin.Context) {
	patch, ok := readProjectFields(c, false)
	if !ok {
		return
	}
	if err := h.store.UpdateProjectBasics(c.Request.Context(), c.Param("id"), patch); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Project not found"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Project basic information update failed"})
		}
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok", "id": c.Param("id")})
}

func readProjectFields(c *gin.Context, creating bool) (map[string]string, bool) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16*1024)
	decoder := json.NewDecoder(c.Request.Body)
	var input map[string]*string
	if err := decoder.Decode(&input); err != nil || len(input) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "A non-empty project object is required"})
		return nil, false
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		c.JSON(http.StatusBadRequest, gin.H{"error": "A single JSON object is required"})
		return nil, false
	}
	patch := map[string]string{}
	for field, value := range input {
		if (field != "name" && field != "product" && field != "version" && !(creating && field == "id")) || value == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Only allowed project string fields may be supplied"})
			return nil, false
		}
		patch[field] = *value
	}
	return patch, true
}

// DeleteProject DELETE /api/v1/admin/projects/:id
func (h *AdminHandler) DeleteProject(c *gin.Context) {
	id := c.Param("id")
	if err := h.store.DeleteProject(c.Request.Context(), id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "deleted", "id": id})
}

// ─── Token Management ────────────────────────────────────────────────────────

type issueTokenReq struct {
	ProjectID string   `json:"project_id" binding:"required"`
	Scopes    []string `json:"scopes"`
	ExpiresIn int      `json:"expires_in_hours"` // 0 = never expires
	CreatedBy string   `json:"created_by"`
}

// IssueToken POST /api/v1/admin/projects/:id/token
func (h *AdminHandler) IssueToken(c *gin.Context) {
	var req issueTokenReq
	if err := c.ShouldBindJSON(&req); err != nil {
		// Allow project_id from URL param
		req.ProjectID = c.Param("id")
	}
	if req.ProjectID == "" {
		req.ProjectID = c.Param("id")
	}
	if req.Scopes == nil {
		req.Scopes = []string{"read_config", "write_status"}
	}

	var expiresAt *time.Time
	if req.ExpiresIn > 0 {
		t := time.Now().Add(time.Duration(req.ExpiresIn) * time.Hour)
		expiresAt = &t
	}

	token, err := h.store.IssueToken(c.Request.Context(), req.ProjectID, req.Scopes, expiresAt, req.CreatedBy)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{
		"token":      token,
		"project_id": req.ProjectID,
		"scopes":     req.Scopes,
		"expires_at": expiresAt,
		"warning":    "store this token securely — it will not be shown again",
	})
}

type revokeTokenReq struct {
	Token string `json:"token" binding:"required"`
}

// RevokeToken DELETE /api/v1/admin/projects/:id/token
func (h *AdminHandler) RevokeToken(c *gin.Context) {
	var req revokeTokenReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// Hash the token to find it
	tokenHash := sha256Hex(req.Token)
	if err := h.store.RevokeToken(c.Request.Context(), tokenHash); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "revoked"})
}

func sha256Hex(s string) string {
	h := sha256.Sum256([]byte(s))
	return fmt.Sprintf("%x", h)
}

// ─── Sync Status ─────────────────────────────────────────────────────────────

type syncStatusReq struct {
	RepoName        string   `json:"repo_name"`
	FromSHA         string   `json:"from_sha"`
	ToSHA           string   `json:"to_sha"`
	ChangedFiles    int      `json:"changed_files"`
	AffectedModules []string `json:"affected_modules"`
	Status          string   `json:"status"`
	ErrorMessage    string   `json:"error_message"`
	DurationMs      int      `json:"duration_ms"`
	WikiNodesCount  struct {
		Doc  int `json:"doc"`
		Code int `json:"code"`
	} `json:"wiki_nodes_count"`
	Bundles []string `json:"bundles"`
}

// RecordSyncStatus POST /api/v1/admin/projects/:id/sync-status
func (h *AdminHandler) RecordSyncStatus(c *gin.Context) {
	id := c.Param("id")
	if tokenProjectID, exists := c.Get("project_id"); exists {
		if pid, ok := tokenProjectID.(string); ok && pid != id {
			c.JSON(http.StatusForbidden, gin.H{"error": "token does not match project"})
			return
		}
	}

	var req syncStatusReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Status == "" {
		req.Status = "success"
	}

	start := time.Now()
	err := h.store.RecordSync(c.Request.Context(), id, req.RepoName, req.FromSHA, req.ToSHA,
		req.ChangedFiles, req.AffectedModules, req.Status, req.ErrorMessage, req.DurationMs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	_ = start
	c.JSON(http.StatusOK, gin.H{"status": "recorded", "project_id": id})
}

// GetSyncLogs GET /api/v1/admin/projects/:id/sync-logs?limit=20
func (h *AdminHandler) GetSyncLogs(c *gin.Context) {
	id := c.Param("id")
	limit := 20
	if l := c.Query("limit"); l != "" {
		if n, err := parseInt(l); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}
	logs, err := h.store.GetSyncLogs(c.Request.Context(), id, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"project_id": id, "logs": logs, "count": len(logs)})
}

func parseInt(s string) (int, error) {
	var n int
	_, err := fmt.Sscanf(s, "%d", &n)
	return n, err
}

// ─── Wiki Nodes ──────────────────────────────────────────────────────────────

type upsertWikiNodesReq struct {
	Nodes []store.WikiNodeEntry `json:"nodes" binding:"required"`
}

// UpsertWikiNodes POST /api/v1/admin/projects/:id/wiki-nodes
func (h *AdminHandler) UpsertWikiNodes(c *gin.Context) {
	id := c.Param("id")
	var req upsertWikiNodesReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.store.UpsertWikiNodes(c.Request.Context(), id, req.Nodes); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok", "project_id": id, "count": len(req.Nodes)})
}

// GetWikiNodes GET /api/v1/admin/projects/:id/wiki-nodes
func (h *AdminHandler) GetWikiNodes(c *gin.Context) {
	id := c.Param("id")
	nodes, err := h.store.GetWikiNodes(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"project_id": id, "nodes": nodes, "count": len(nodes)})
}

// SaveCodeSource configures a code repository without replacing module mappings.
func (h *AdminHandler) SaveCodeSource(c *gin.Context) {
	var input struct {
		types.RepoBinding
		ExpectedRevision int `json:"expected_revision"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20)
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(422, gin.H{"error": "Code source JSON object required"})
		return
	}
	if err := h.store.SaveCodeSource(c.Request.Context(), c.Param("id"), input.RepoBinding, input.ExpectedRevision); err != nil {
		qualityReply(c, nil, err)
		return
	}
	c.JSON(200, gin.H{"status": "ok"})
}
