package parser

import (
"context"
"fmt"
"os"
"path/filepath"
"strings"

"cim-llm-wiki/internal/config"
"cim-llm-wiki/internal/types"
)

func init() {
Register(EngineInfo{
Name:           "simple",
Description:    "Go-native reader for Markdown, plain text, JSON, YAML, CSV",
SupportedTypes: []string{"md", "markdown", "txt", "json", "yaml", "yml", "csv"},
}, func(_ *config.Config) DocParser { return &simpleParser{} })
}

type simpleParser struct{}

func (p *simpleParser) Name() string            { return "simple" }
func (p *simpleParser) SupportedTypes() []string { return []string{"md", "txt", "json", "yaml", "csv"} }
func (p *simpleParser) Available() bool          { return true } // always available

func (p *simpleParser) Parse(_ context.Context, filePath string) (*types.ParsedDocument, error) {
data, err := os.ReadFile(filePath)
if err != nil {
return nil, fmt.Errorf("simple parser: %w", err)
}
// Normalise line endings (same as weknora-core chunker.NormalizeLineEndings)
content := strings.ReplaceAll(string(data), "\r\n", "\n")
content = strings.ReplaceAll(content, "\r", "\n")

ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(filePath), "."))
base := strings.TrimSuffix(filepath.Base(filePath), filepath.Ext(filePath))

return &types.ParsedDocument{
Source:   filePath,
FileType: ext,
Engine:   "simple",
Title:    base,
Content:  content,
Metadata: map[string]string{"size_bytes": fmt.Sprintf("%d", len(data))},
}, nil
}
