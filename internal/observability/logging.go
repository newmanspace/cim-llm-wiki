// Package observability keeps service and request logging consistent without
// making business code depend on HTTP middleware.
package observability

import (
	"context"
	"io"
	"log/slog"
	"strings"
)

type loggerKey struct{}

func NewLogger(output io.Writer, service string) *slog.Logger {
	handler := slog.NewJSONHandler(output, &slog.HandlerOptions{
		Level: slog.LevelInfo,
		ReplaceAttr: func(groups []string, attr slog.Attr) slog.Attr {
			if len(groups) == 0 && attr.Key == slog.TimeKey {
				attr.Key = "@timestamp"
			}
			if len(groups) == 0 && attr.Key == slog.LevelKey {
				return slog.String("log.level", strings.ToLower(attr.Value.String()))
			}
			return attr
		},
	})
	return slog.New(handler).With("service.name", service, "ecs.version", "8.11.0")
}

func WithLogger(ctx context.Context, logger *slog.Logger) context.Context {
	return context.WithValue(ctx, loggerKey{}, logger)
}

func Logger(ctx context.Context) *slog.Logger {
	if logger, ok := ctx.Value(loggerKey{}).(*slog.Logger); ok {
		return logger
	}
	return slog.Default()
}

// ReportFailure belongs at the boundary that handles the error and returns a
// response. Lower layers return errors; they do not also log the same failure.
// Message and code must be controlled summaries, never raw downstream errors.
func ReportFailure(ctx context.Context, operation, code, message string) {
	Logger(ctx).LogAttrs(ctx, slog.LevelError, message,
		slog.String("event.action", "operation.failed"), slog.String("event.outcome", "failure"),
		slog.String("operation.name", operation), slog.String("error.code", code))
}

func HTTPLevel(status int) slog.Level {
	switch {
	case status >= 500:
		return slog.LevelError
	case status == 400 || status == 404 || status == 409 || status == 422:
		return slog.LevelInfo
	case status >= 400:
		return slog.LevelWarn
	default:
		return slog.LevelInfo
	}
}
