package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// LegacyWriteDisabled prevents the v1 pipeline from bypassing wiki contracts.
func LegacyWriteDisabled(c *gin.Context) {
	c.AbortWithStatusJSON(http.StatusGone, gin.H{
		"error": "legacy wiki writes are disabled; use the versioned wiki-core bundle compiler",
	})
}
