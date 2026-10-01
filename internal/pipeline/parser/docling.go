package parser

import (
"bytes"
"context"
"encoding/json"
"fmt"
"io"
"mime/multipart"
"net/http"
"os"
"path/filepath"
"strings"

"github.com/cim-llm/cim-wiki/internal/config"
"github.com/cim-llm/cim-wiki/internal/types"
)

func init() {
Register(EngineInfo{
Name:           "docling",
Description:    "Docling service: DOCX / PPTX / XLSX / HTML → Markdown",
SupportedTypes: []string{"docx", "doc", "pptx", "ppt", "xlsx", "xls", "html", "htm", "epub"},
}, func(cfg *config.Config) DocParser {
return &doclingParser{
endpoint:   cfg.Parser.DoclingEndpoint,
httpClient: &http.Client{Timeout: cfg.Parser.DoclingTimeout},
}
})
}

type doclingParser struct {
endpoint   string
httpClient *http.Client
}

func (p *doclingParser) Name() string { return "docling" }
func (p *doclingParser) SupportedTypes() []string {
return []string{"docx", "doc", "pptx", "ppt", "xlsx", "xls", "html", "htm", "epub"}
}
func (p *doclingParser) Available() bool { return p.endpoint != "" }

// Parse uploads the file to the Docling HTTP service and returns Markdown.
// Docling API: POST /v1/convert/file   → { "document": { "md_content": "..." } }
func (p *doclingParser) Parse(ctx context.Context, filePath string) (*types.ParsedDocument, error) {
f, err := os.Open(filePath)
if err != nil {
return nil, fmt.Errorf("docling: open %q: %w", filePath, err)
}
defer f.Close()

var body bytes.Buffer
w := multipart.NewWriter(&body)
fw, err := w.CreateFormFile("file", filepath.Base(filePath))
if err != nil {
return nil, fmt.Errorf("docling: create form file: %w", err)
}
if _, err = io.Copy(fw, f); err != nil {
return nil, fmt.Errorf("docling: copy: %w", err)
}
w.Close()

req, err := http.NewRequestWithContext(ctx, http.MethodPost,
strings.TrimRight(p.endpoint, "/")+"/v1/convert/file", &body)
if err != nil {
return nil, fmt.Errorf("docling: build request: %w", err)
}
req.Header.Set("Content-Type", w.FormDataContentType())

resp, err := p.httpClient.Do(req)
if err != nil {
return nil, fmt.Errorf("docling: HTTP call: %w", err)
}
defer resp.Body.Close()
raw, _ := io.ReadAll(resp.Body)

if resp.StatusCode != http.StatusOK {
return nil, fmt.Errorf("docling: HTTP %d: %s", resp.StatusCode, raw)
}

var result struct {
Document struct {
MdContent string `json:"md_content"`
} `json:"document"`
}
if err := json.Unmarshal(raw, &result); err != nil {
return nil, fmt.Errorf("docling: decode response: %w", err)
}

ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(filePath), "."))
base := strings.TrimSuffix(filepath.Base(filePath), filepath.Ext(filePath))
return &types.ParsedDocument{
Source:   filePath,
FileType: ext,
Engine:   "docling",
Title:    base,
Content:  result.Document.MdContent,
Metadata: map[string]string{},
}, nil
}
