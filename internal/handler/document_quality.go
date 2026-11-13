package handler

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strconv"
	"strings"

	"cim-llm-wiki/internal/documentquality"
	"cim-llm-wiki/internal/store"
	"github.com/gin-gonic/gin"
)

type DocumentQualityHandler struct {
	service   documentquality.Service
	token     string
	reviewers map[string]string
}

func NewDocumentQualityHandler(s *store.Store) *DocumentQualityHandler {
	h := &DocumentQualityHandler{service: documentquality.Service{Repository: s}, token: os.Getenv("CIM_WIKI_LEDGER_TOKEN"), reviewers: map[string]string{}}
	_ = json.Unmarshal([]byte(os.Getenv("CIM_WIKI_REVIEW_TOKENS")), &h.reviewers)
	return h
}
func (h *DocumentQualityHandler) Ready() bool { return len(h.token) >= 32 }
func (h *DocumentQualityHandler) InternalAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		got := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
		if !h.Ready() || subtle.ConstantTimeCompare([]byte(got), []byte(h.token)) != 1 {
			c.AbortWithStatusJSON(403, gin.H{"error": "Service authentication required"})
			return
		}
		c.Set("quality_actor", "skill-service")
		c.Next()
	}
}
func qualityReply(c *gin.Context, v any, err error) {
	if err == nil {
		c.JSON(200, gin.H{"data": v})
		return
	}
	var typed *documentquality.Error
	if errors.As(err, &typed) {
		c.JSON(typed.Status, gin.H{"error": typed.Message})
		return
	}
	c.JSON(503, gin.H{"error": "Document ledger unavailable"})
}
func (h *DocumentQualityHandler) Command(c *gin.Context) {
	op := c.Param("operation")
	actor := c.GetString("quality_actor")
	if actor == "" {
		actor = "project-administrator"
	}
	internal := strings.HasPrefix(c.FullPath(), "/internal/")
	if !internal && op != "data-sources" && op != "quality-policies" && op != "document-directories" && op != "quality-policy-preview" {
		qualityReply(c, nil, &documentquality.Error{Status: 403, Message: "Administrative sessions may only edit configuration; use the verified knowledge workflow for document mutations"})
		return
	}

	if internal && (op == "data-sources" || op == "quality-policies" || op == "document-directories" || op == "quality-policy-preview") {
		qualityReply(c, nil, &documentquality.Error{Status: 403, Message: "Configuration requires a human administrator session"})
		return
	}
	if op == "document-review-decisions" {
		actor = ""
		provided := c.GetHeader("X-Document-Review-Token")
		for name, secret := range h.reviewers {
			if len(secret) >= 32 && secret != h.token && subtle.ConstantTimeCompare([]byte(provided), []byte(secret)) == 1 {
				actor = name
			}
		}
		if actor == "" {
			qualityReply(c, nil, &documentquality.Error{Status: 403, Message: "Independent human reviewer authentication required"})
			return
		}
	}
	var r documentquality.Record
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4<<20)
	if err := c.ShouldBindJSON(&r); err != nil || r == nil {
		c.JSON(422, gin.H{"error": "JSON object required"})
		return
	}
	if op == "quality-policy-preview" {
		v, e := h.service.PreviewPolicy(c.Request.Context(), c.Param("id"), r)
		qualityReply(c, v, e)
		return
	}
	v, e := h.service.Execute(c.Request.Context(), c.Param("id"), actor, op, c.GetHeader("Idempotency-Key"), r)
	qualityReply(c, v, e)
}

var qualityResources = map[string]string{"directory-events": "directory_events", "document-directories": "directories", "ingest-source-links": "ingest_sources", "ingest-artifact-links": "ingest_artifacts", "data-sources": "data_sources", "source-revisions": "source_revisions", "ingest-runs": "ingest_runs", "source-observations": "source_versions", "document-results": "artifact_versions", "quality-policies": "quality_policies", "document-evaluations": "evaluations", "quality-issues": "quality_issues", "document-review-tasks": "review_tasks", "document-review-events": "review_events", "publications": "publications"}

func (h *DocumentQualityHandler) List(c *gin.Context) {
	if c.Param("resource") == "directory-catalog" {
		rows, e := h.service.DirectoryCatalog(c.Request.Context(), c.Param("id"))
		if e != nil {
			qualityReply(c, nil, e)
			return
		}
		items := []documentquality.Record{}
		for _, row := range rows {
			if c.Request.URL.Query().Has("parent") && documentquality.Text(row, "parent_path") != c.Query("parent") {
				continue
			}
			if q := strings.ToLower(c.Query("q")); q != "" && !strings.Contains(strings.ToLower(documentquality.Text(row, "path")+documentquality.Text(row, "display_name")), q) {
				continue
			}
			items = append(items, row)
		}
		limit := 200
		if raw := c.Query("limit"); raw != "" {
			value, err := strconv.Atoi(raw)
			if err != nil || value < 1 || value > 200 {
				c.JSON(422, gin.H{"error": "Invalid page limit"})
				return
			}
			limit = value
		}
		page := []documentquality.Record{}
		cursor := c.Query("cursor")
		for _, row := range items {
			if documentquality.Text(row, "path") > cursor {
				page = append(page, row)
			}
		}
		next := ""
		if len(page) > limit {
			next = documentquality.Text(page[limit-1], "path")
			page = page[:limit]
		}
		qualityReply(c, gin.H{"items": page, "next_cursor": next}, nil)
		return
	}

	if c.Param("resource") == "quality-policy-effective" {
		v, e := h.service.Policy(c.Request.Context(), c.Param("id"), "reader", c.Query("path"))
		qualityReply(c, v, e)
		return
	}
	resource, ok := qualityResources[c.Param("resource")]
	if !ok {
		c.JSON(404, gin.H{"error": "Resource not found"})
		return
	}
	rows, e := h.service.Read(c.Request.Context(), c.Param("id"), "reader", resource)
	if e != nil {
		qualityReply(c, nil, e)
		return
	}
	limit := 50
	if c.Query("limit") != "" {
		n, err := strconv.Atoi(c.Query("limit"))
		if err != nil || n < 1 || n > 200 {
			c.JSON(422, gin.H{"error": "Invalid page limit"})
			return
		}
		limit = n
	}
	filters, e := h.resultFilters(c, resource)
	if e != nil {
		qualityReply(c, nil, e)
		return
	}
	filtered := []documentquality.Record{}
	cursor := c.Query("cursor")
	started := cursor == ""
	for _, r := range rows {
		if filters != nil && !filters(r) {
			continue
		}
		if run := c.Query("run_id"); run != "" && documentquality.Text(r, "run_id") != run {
			continue
		}
		if !started {
			if documentquality.Text(r, "id") == cursor {
				started = true
			}
			continue
		}
		if status := c.Query("status"); status != "" && documentquality.Text(r, "status") != status {
			continue
		}
		if folder := c.Query("folder"); folder != "" && !strings.HasPrefix(documentquality.Text(r, "target_path"), folder+"/") {
			continue
		}
		filtered = append(filtered, r)
	}
	next := ""
	if len(filtered) > limit {
		next = documentquality.Text(filtered[limit-1], "id")
		filtered = filtered[:limit]
	}
	qualityReply(c, gin.H{"items": filtered, "next_cursor": next}, nil)
}

func (h *DocumentQualityHandler) resultFilters(c *gin.Context, resource string) (func(documentquality.Record) bool, error) {
	sourceID, qualityStatus, reviewStatus := c.Query("source_id"), c.Query("quality_status"), c.Query("review_status")
	if resource != "artifact_versions" {
		return nil, nil
	}
	if sourceID == "" && qualityStatus == "" && reviewStatus == "" {
		return nil, nil
	}
	read := func(kind string) ([]documentquality.Record, error) {
		return h.service.Read(c.Request.Context(), c.Param("id"), "reader", kind)
	}
	evaluations, e := read("evaluations")
	if e != nil {
		return nil, e
	}
	tasks, e := read("review_tasks")
	if e != nil {
		return nil, e
	}
	sources, e := read("source_versions")
	if e != nil {
		return nil, e
	}
	latest := map[string]documentquality.Record{}
	for _, r := range evaluations {
		latest[documentquality.Text(r, "artifact_id")] = r
	}
	taskStatus := map[string]string{}
	for _, r := range tasks {
		taskStatus[documentquality.Text(r, "evaluation_id")] = documentquality.Text(r, "status")
	}
	sourceIDs := map[string]string{}
	for _, r := range sources {
		sourceIDs[documentquality.Text(r, "id")] = documentquality.Text(r, "source_id")
	}
	return func(r documentquality.Record) bool {
		if sourceID != "" {
			found := false
			links, _ := r["source_links"].([]any)
			for _, raw := range links {
				link, _ := raw.(map[string]any)
				if sourceIDs[documentquality.Text(documentquality.Record(link), "source_version_id")] == sourceID {
					found = true
				}
			}
			if !found {
				return false
			}
		}
		evaluation := latest[documentquality.Text(r, "id")]
		if reviewStatus != "" && taskStatus[documentquality.Text(evaluation, "id")] != reviewStatus {
			return false
		}
		status := "qualified"
		if evaluation == nil || evaluation["total"] == nil {
			status = "not_assessed"
		} else if evaluation["blocking"] == true {
			status = "blocked"
		} else if evaluation["needs_review"] == true {
			status = "needs_review"
		}
		return qualityStatus == "" || qualityStatus == status
	}, nil
}
