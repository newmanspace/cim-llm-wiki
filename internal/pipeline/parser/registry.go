package parser

import (
"context"
"fmt"
"strings"

"cim-llm-wiki/internal/config"
"cim-llm-wiki/internal/types"
)

// EngineInfo is the metadata shown in GET /api/v1/parsers.
type EngineInfo struct {
Name           string   `json:"name"`
Description    string   `json:"description"`
SupportedTypes []string `json:"supported_types"`
Available      bool     `json:"available"`
}

// registration is what every engine provides to the registry.
type registration struct {
info    EngineInfo
factory func(cfg *config.Config) DocParser
}

var registry []registration

// Register adds a parser engine to the global registry.
// Called from each engine's init().
func Register(info EngineInfo, factory func(cfg *config.Config) DocParser) {
registry = append(registry, registration{info: info, factory: factory})
}

// For returns the best DocParser for the given file extension, using cfg
// to build the engine. If engineName is non-empty, that engine is selected
// directly; otherwise auto-selection applies.
func For(ctx context.Context, cfg *config.Config, filePath, engineName string) (DocParser, error) {
ext := strings.ToLower(strings.TrimPrefix(filePath[strings.LastIndex(filePath, "."):], "."))

if engineName != "" {
// Explicit engine requested
for _, r := range registry {
if r.info.Name == engineName {
p := r.factory(cfg)
if !p.Available() {
return nil, fmt.Errorf("parser: engine %q is not available", engineName)
}
return p, nil
}
}
return nil, fmt.Errorf("parser: unknown engine %q", engineName)
}

// Auto-select: pick the first registered engine that supports this extension
preferred := autoSelect(ext)
for _, name := range preferred {
for _, r := range registry {
if r.info.Name == name {
p := r.factory(cfg)
if p.Available() {
return p, nil
}
}
}
}
return nil, fmt.Errorf("parser: no available engine for file type %q", ext)
}

// autoSelect returns engine names in preference order for the given extension.
// This is the single authoritative routing table; change here to affect the whole system.
func autoSelect(ext string) []string {
switch ext {
case "pdf":
return []string{"mineru", "simple"}
case "docx", "doc", "pptx", "ppt", "xlsx", "xls", "html", "htm", "epub":
return []string{"docling", "simple"}
case "jpg", "jpeg", "png", "tiff", "tif", "bmp", "gif", "webp":
return []string{"ocr"}
default: // md, txt, json, yaml, csv …
return []string{"simple"}
}
}

// ListEngines returns metadata for all registered engines (for API display).
func ListEngines(cfg *config.Config) []EngineInfo {
out := make([]EngineInfo, 0, len(registry))
for _, r := range registry {
info := r.info
p := r.factory(cfg)
info.Available = p.Available()
out = append(out, info)
}
return out
}

// MustParse is a convenience wrapper: selects engine, parses, returns result.
func MustParse(ctx context.Context, cfg *config.Config, filePath string) (*types.ParsedDocument, error) {
p, err := For(ctx, cfg, filePath, "")
if err != nil {
return nil, err
}
return p.Parse(ctx, filePath)
}
