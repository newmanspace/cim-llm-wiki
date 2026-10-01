// Package handler contains the HTTP route handlers.
package handler

import (
"fmt"
"io"
"net/http"
"os"
"path/filepath"

"github.com/gin-gonic/gin"

"cim-llm-wiki/internal/config"
"cim-llm-wiki/internal/pipeline"
)

// IngestHandler handles POST /api/v1/ingest
// Accepts a multipart file upload + module name, runs the full pipeline.
type IngestHandler struct {
cfg      *config.Config
pipeline *pipeline.Pipeline
}

func NewIngestHandler(cfg *config.Config, p *pipeline.Pipeline) *IngestHandler {
return &IngestHandler{cfg: cfg, pipeline: p}
}

// Handle processes the ingest request.
//
//POST /api/v1/ingest
//Form fields:
//  file   – raw document (required)
//  module – target module name, e.g. "wip-management" (required)
//  engine – parser engine override, e.g. "mineru" (optional, default: auto)
func (h *IngestHandler) Handle(c *gin.Context) {
module := c.PostForm("module")
if module == "" {
c.JSON(http.StatusBadRequest, gin.H{"error": "module is required"})
return
}
engine := c.PostForm("engine") // optional

// Save the uploaded file to data/raw/
fh, err := c.FormFile("file")
if err != nil {
c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("file upload: %v", err)})
return
}

rawDir := h.cfg.Wiki.RawDir
if err := os.MkdirAll(rawDir, 0755); err != nil {
c.JSON(http.StatusInternalServerError, gin.H{"error": "cannot create raw dir"})
return
}
destPath := filepath.Join(rawDir, filepath.Base(fh.Filename))

src, err := fh.Open()
if err != nil {
c.JSON(http.StatusInternalServerError, gin.H{"error": "open upload"})
return
}
defer src.Close()

dst, err := os.Create(destPath)
if err != nil {
c.JSON(http.StatusInternalServerError, gin.H{"error": "save file"})
return
}
defer dst.Close()
if _, err = io.Copy(dst, src); err != nil {
c.JSON(http.StatusInternalServerError, gin.H{"error": "write file"})
return
}
dst.Close()

// Run the pipeline (blocking – for async use a job queue)
result, err := h.pipeline.Run(c.Request.Context(), destPath, module, engine)
if err != nil {
c.JSON(http.StatusInternalServerError, gin.H{
"error":  err.Error(),
"result": result,
})
return
}
c.JSON(http.StatusOK, result)
}
