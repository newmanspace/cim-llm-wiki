package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestLegacyWriteDisabled(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/ingest", LegacyWriteDisabled)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/ingest", nil))
	if response.Code != http.StatusGone {
		t.Fatalf("expected status 410, got %d", response.Code)
	}
}
