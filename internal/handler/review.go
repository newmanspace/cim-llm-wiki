package handler

import (
"net/http"

"github.com/gin-gonic/gin"

"cim-llm-wiki/internal/config"
"cim-llm-wiki/internal/hitl"
"cim-llm-wiki/internal/pipeline/compiler"
"cim-llm-wiki/internal/types"
)

// ReviewHandler handles the HITL review workflow.
type ReviewHandler struct {
cfg      *config.Config
queue    *hitl.Queue
compiler *compiler.Compiler
}

func NewReviewHandler(cfg *config.Config, q *hitl.Queue, comp *compiler.Compiler) *ReviewHandler {
return &ReviewHandler{cfg: cfg, queue: q, compiler: comp}
}

// List handles GET /api/v1/review?status=pending
func (h *ReviewHandler) List(c *gin.Context) {
status := types.BundleStatus(c.Query("status"))
bundles, err := h.queue.List(c.Request.Context(), status)
if err != nil {
c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
return
}
c.JSON(http.StatusOK, gin.H{"bundles": bundles, "total": len(bundles)})
}

// Get handles GET /api/v1/review/:id
func (h *ReviewHandler) Get(c *gin.Context) {
bundle, err := h.queue.Get(c.Request.Context(), c.Param("id"))
if err != nil {
c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
return
}
c.JSON(http.StatusOK, bundle)
}

// Approve handles POST /api/v1/review/:id/approve
// Body: { "reviewer": "alice", "note": "LGTM" }
func (h *ReviewHandler) Approve(c *gin.Context) {
var req struct {
Reviewer string `json:"reviewer"`
Note     string `json:"note"`
}
_ = c.ShouldBindJSON(&req)

bundle, err := h.queue.Approve(c.Request.Context(), c.Param("id"), req.Reviewer, req.Note)
if err != nil {
c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
return
}

// Compile approved nodes → wiki/
for i := range bundle.Nodes {
bundle.Nodes[i].Status = types.StatusApproved
}
written, err := h.compiler.Compile(c.Request.Context(), bundle.Nodes)
if err != nil {
c.JSON(http.StatusInternalServerError, gin.H{
"error":  "compile failed: " + err.Error(),
"bundle": bundle,
})
return
}
c.JSON(http.StatusOK, gin.H{
"bundle":      bundle,
"wiki_files":  written,
"files_count": len(written),
})
}

// Reject handles POST /api/v1/review/:id/reject
func (h *ReviewHandler) Reject(c *gin.Context) {
var req struct {
Reviewer string `json:"reviewer"`
Note     string `json:"note"`
}
_ = c.ShouldBindJSON(&req)

bundle, err := h.queue.Reject(c.Request.Context(), c.Param("id"), req.Reviewer, req.Note)
if err != nil {
c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
return
}
c.JSON(http.StatusOK, bundle)
}
