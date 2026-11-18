package observability

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"testing"
)

func TestCommonFieldsAndContextLogger(t *testing.T) {
	var output bytes.Buffer
	logger := NewLogger(&output, "test-service")
	logger.Info("Service started")
	ctx := WithLogger(context.Background(), logger.With("http.request.id", "request-001"))
	ReportFailure(ctx, "project.sources", "SOURCE_SERVICE_UNAVAILABLE", "Source service unavailable")
	decoder := json.NewDecoder(&output)
	for i := 0; i < 2; i++ {
		var entry map[string]any
		if err := decoder.Decode(&entry); err != nil {
			t.Fatal(err)
		}
		if entry["service.name"] != "test-service" || entry["@timestamp"] == nil || entry["ecs.version"] != "8.11.0" {
			t.Fatal("missing common fields", entry)
		}
		if i == 1 && (entry["http.request.id"] != "request-001" || entry["error.code"] != "SOURCE_SERVICE_UNAVAILABLE" || entry["log.level"] != "error") {
			t.Fatal("missing contextual failure", entry)
		}
	}
	if Logger(context.Background()) != slog.Default() {
		t.Fatal("missing fallback logger")
	}
}

func TestHTTPLevelPolicy(t *testing.T) {
	for _, status := range []int{200, 204, 400, 404, 409, 422} {
		if HTTPLevel(status) != slog.LevelInfo {
			t.Fatalf("status %d should be info", status)
		}
	}
	for _, status := range []int{401, 403, 429} {
		if HTTPLevel(status) != slog.LevelWarn {
			t.Fatalf("status %d should be warn", status)
		}
	}
	if HTTPLevel(503) != slog.LevelError {
		t.Fatal("5xx should be error")
	}
}

func TestContextLoggersStaySeparate(t *testing.T) {
	var output bytes.Buffer
	logger := NewLogger(&output, "test-service")
	for _, id := range []string{"request-a", "request-b"} {
		ctx := WithLogger(context.Background(), logger.With("http.request.id", id))
		Logger(ctx).InfoContext(ctx, "Operation")
	}
	lines := strings.Split(strings.TrimSpace(output.String()), "\n")
	if len(lines) != 2 || strings.Contains(lines[0], "request-b") || strings.Contains(lines[1], "request-a") {
		t.Fatal("request context leaked")
	}
}
