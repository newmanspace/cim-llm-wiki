package handler

import (
	"context"
	"errors"

	"cim-llm-wiki/internal/types"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
)

type projectContextReader interface {
	GetProject(context.Context, string) (*types.ProjectConfig, error)
}

// projectContext is reachable only through the authenticated internal ledger route.
func (h *DocumentQualityHandler) projectContext(c *gin.Context) {
	p, err := h.store.GetProject(c.Request.Context(), c.Param("id"))
	if errors.Is(err, pgx.ErrNoRows) {
		c.JSON(404, gin.H{"error": "Project not found"})
		return
	}
	if err != nil {
		c.JSON(503, gin.H{"error": "Project registry unavailable"})
		return
	}
	if p.Docs == nil {
		p.Docs = []types.DocSource{}
	}
	if p.Repos == nil {
		p.Repos = []types.RepoBinding{}
	}
	if p.Modules == nil {
		p.Modules = []string{}
	}
	c.JSON(200, gin.H{
		"data": gin.H{
			"id":      p.ID,
			"name":    p.Name,
			"product": p.Product,
			"version": p.Version,
			"docs":    p.Docs,
			"repos":   p.Repos,
			"modules": p.Modules,
		},
	})
}
