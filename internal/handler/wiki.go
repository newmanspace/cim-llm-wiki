package handler

import (
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"

	"cim-llm-wiki/internal/config"
	"cim-llm-wiki/internal/pipeline/compiler"
	"cim-llm-wiki/internal/pipeline/parser"
)

// WikiHandler serves wiki content queries.
type WikiHandler struct {
	cfg      *config.Config
	compiler *compiler.Compiler
}

func NewWikiHandler(cfg *config.Config, comp *compiler.Compiler) *WikiHandler {
	return &WikiHandler{cfg: cfg, compiler: comp}
}

// GetNode handles GET /api/v1/wiki/:id
// Returns the raw Markdown content of the wiki node.
func (h *WikiHandler) GetNode(c *gin.Context) {
	id := c.Param("id")
	// Search all subdirs for the file
	slug := strings.ToLower(strings.ReplaceAll(id, " ", "-"))
	wikiRoot := h.cfg.Wiki.OutputDir

	var found string
	_ = filepath.WalkDir(wikiRoot, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if strings.HasSuffix(path, slug+".md") {
			found = path
		}
		return nil
	})

	if found == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "node not found: " + id})
		return
	}
	content, err := os.ReadFile(found)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Data(http.StatusOK, "text/markdown; charset=utf-8", content)
}

// GetVirtualDoc handles GET /api/v1/wiki/virtual/:module?type=sdd|idd
// Returns a synthesised long-form document for a module (§5.2).
func (h *WikiHandler) GetVirtualDoc(c *gin.Context) {
	module := c.Param("module")
	docType := c.DefaultQuery("type", "sdd")

	content, err := h.compiler.CompileVirtualDocument(c.Request.Context(), module, docType)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.Data(http.StatusOK, "text/markdown; charset=utf-8", []byte(content))
}

// ListParsers handles GET /api/v1/parsers
// Returns registered parsing engines and their availability.
func (h *WikiHandler) ListParsers() gin.HandlerFunc {
	return ListParsersHandler(h.cfg)
}

// ListParsersHandler returns a Gin handler for listing parser engines.
func ListParsersHandler(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		engines := parser.ListEngines(cfg)
		c.JSON(http.StatusOK, gin.H{"parsers": engines})
	}
}
