package handler

import (
	"encoding/json"
	"net/http"
	"net/url"

	"cim-llm-wiki/internal/types"
	"github.com/gin-gonic/gin"
)

// Source registration owns this view; do not copy lifecycle records into project_docs.
func loadRegisteredProjectDocs(c *gin.Context, project *types.ProjectConfig) bool {
	proxy := NewDocumentDefaultsHandler(nil)
	if proxy.URL == "" || len(proxy.Token) < 32 {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Source document service is not configured"})
		return false
	}
	savedQuery := c.Request.URL.RawQuery
	c.Request.URL.RawQuery = url.Values{"project": {project.ID}}.Encode()
	defer func() { c.Request.URL.RawQuery = savedQuery }()
	data, status, err := proxy.requestTo(c, "/internal/source-documents", nil)
	if err != nil || status != http.StatusOK {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Source document service unavailable"})
		return false
	}
	var response struct {
		Documents []types.DocSource `json:"documents"`
	}
	if err := json.Unmarshal(data, &response); err != nil || response.Documents == nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Invalid source document response"})
		return false
	}
	project.Docs = response.Documents
	return true
}
