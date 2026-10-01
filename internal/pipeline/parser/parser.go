// Package parser implements Stage 1 of the knowledge pipeline:
// raw document → ParsedDocument (Markdown content + structured tables).
//
// Architecture pattern (mirrors weknora-core/internal/infrastructure/docparser):
//   - parser.go     – DocParser interface
//   - registry.go   – engine registration & auto-routing by file type
//   - simple.go     – Go-native: md / txt / json / yaml / csv
//   - mineru.go     – Self-hosted MinerU HTTP client (complex PDF / SDD / IDD)
//   - docling.go    – Docling HTTP client (DOCX / PPTX / HTML)
//   - ocr.go        – PaddleOCR stub (scanned images)
package parser

import (
"context"

"cim-llm-wiki/internal/types"
)

// DocParser is the interface every parsing engine must implement.
type DocParser interface {
// Name returns the engine identifier (e.g. "mineru", "docling", "simple").
Name() string
// SupportedTypes returns the lower-case file extensions this engine handles.
SupportedTypes() []string
// Available reports whether this engine is operational right now.
Available() bool
// Parse converts the file at filePath into a ParsedDocument.
Parse(ctx context.Context, filePath string) (*types.ParsedDocument, error)
}
