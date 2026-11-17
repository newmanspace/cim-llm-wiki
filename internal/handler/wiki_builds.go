package handler

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"regexp"

	"github.com/gin-gonic/gin"
)

var previewPath = regexp.MustCompile(`^/wiki-preview/([a-f0-9-]{36})(/|$)`)
var buildProject = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]*$`)

type WikiBuildHandler struct{ proxy *DocumentDefaultsHandler }

func NewWikiBuildHandler() *WikiBuildHandler {
	return &WikiBuildHandler{proxy: NewDocumentDefaultsHandler(nil)}
}

func (h *WikiBuildHandler) ready(c *gin.Context) bool {
	if h.proxy.URL == "" || len(h.proxy.Token) < 32 {
		c.JSON(503, gin.H{"error": "Wiki build service is not configured"})
		return false
	}
	return true
}

func (h *WikiBuildHandler) Handle(c *gin.Context) {
	if !h.ready(c) {
		return
	}
	project := c.Param("id")
	if !buildProject.MatchString(project) {
		c.JSON(422, gin.H{"error": "Invalid project"})
		return
	}
	action := c.Param("action")
	if !map[string]bool{"": true, "build": true, "preview": true, "retry": true, "revoke": true}[action] {
		c.JSON(404, gin.H{"error": "Unknown build operation"})
		return
	}
	var payload []byte
	if c.Request.Method == http.MethodPost {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16384)
		var err error
		payload, err = io.ReadAll(c.Request.Body)
		if err != nil {
			c.JSON(413, gin.H{"error": "Request body too large"})
			return
		}
	}
	saved := c.Request.URL.RawQuery
	c.Request.URL.RawQuery = url.Values{"project": {project}}.Encode()
	defer func() { c.Request.URL.RawQuery = saved }()
	path := "/internal/wiki-builds"
	if action != "" {
		path += "/" + action
	}
	data, status, err := h.proxy.requestTo(c, path, payload)
	if err != nil {
		c.JSON(503, gin.H{"error": "Wiki build service unavailable"})
		return
	}
	c.Header("Cache-Control", "no-store")
	c.Data(status, "application/json", data)
}

// PreviewAccess is only called after session authentication. Authorization covers
// every preview subresource, including script chunks and search indexes.
func (h *WikiBuildHandler) PreviewAccess(c *gin.Context) {
	if !h.ready(c) {
		return
	}
	uri, err := url.ParseRequestURI(c.GetHeader("X-Original-URI"))
	if err != nil {
		c.AbortWithStatus(403)
		return
	}
	match := previewPath.FindStringSubmatch(uri.Path)
	if match == nil {
		c.AbortWithStatus(403)
		return
	}
	saved := c.Request.URL.RawQuery
	c.Request.URL.RawQuery = url.Values{"preview": {match[1]}}.Encode()
	defer func() { c.Request.URL.RawQuery = saved }()
	data, status, err := h.proxy.requestTo(c, "/internal/wiki-builds/access", nil)
	var result struct {
		Allowed bool `json:"allowed"`
	}
	if err != nil || status != 200 || json.Unmarshal(data, &result) != nil || !result.Allowed {
		c.AbortWithStatus(403)
		return
	}
	c.Status(200)
}
