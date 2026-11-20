package handler

import (
	"net/http"
	"net/url"

	"cim-llm-wiki/internal/documentquality"
	"github.com/gin-gonic/gin"
)

// Preview is available through the authenticated management session, without
// exposing knowledge-service credentials or requiring a human review token.
func (h *DocumentQualityHandler) Preview(c *gin.Context) {
	project := c.Param("id")
	rows, err := h.service.Read(c.Request.Context(), project, "reader", "artifact_versions")
	if err != nil {
		qualityReply(c, nil, err)
		return
	}
	found := false
	for _, row := range rows {
		if documentquality.Text(row, "id") == c.Query("id") {
			found = true
		}
	}
	if !found {
		c.JSON(404, gin.H{"error": "Project document not found"})
		return
	}
	proxy := NewDocumentDefaultsHandler(nil)
	if proxy.URL == "" || len(proxy.Token) < 32 {
		c.JSON(503, gin.H{"error": "Document service is not configured"})
		return
	}
	query := url.Values{"project": {project}, "id": {c.Query("id")}}
	if c.Param("resource") == "resource" {
		h.previewResource(c, proxy, query)
		return
	}
	c.Request.URL.RawQuery = query.Encode()
	data, status, err := proxy.requestTo(c, "/internal/document-result-"+c.Param("resource"), nil)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Document preview is unavailable"})
		return
	}
	c.Data(status, "application/json", data)
}

// Resource streams only files associated with a document version in this project.
func (h *DocumentQualityHandler) previewResource(c *gin.Context, proxy *DocumentDefaultsHandler, query url.Values) {
	query.Set("scope", c.Query("scope"))
	query.Set("path", c.Query("path"))
	target := proxy.URL + "/internal/document-result-resource?" + query.Encode()
	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodGet, target, nil)
	if err != nil {
		c.Status(503)
		return
	}
	req.Header.Set("Authorization", "Bearer "+proxy.Token)
	response, err := proxy.Client.Do(req)
	if err != nil {
		c.JSON(503, gin.H{"error": "Attachment is unavailable"})
		return
	}
	defer response.Body.Close()
	c.Header("Cache-Control", "no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Content-Disposition", response.Header.Get("Content-Disposition"))
	c.DataFromReader(response.StatusCode, response.ContentLength, response.Header.Get("Content-Type"), response.Body, nil)
}
