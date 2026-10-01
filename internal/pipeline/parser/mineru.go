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
"time"

"cim-llm-wiki/internal/config"
"cim-llm-wiki/internal/types"
)

func init() {
Register(EngineInfo{
Name:           "mineru",
Description:    "Self-hosted MinerU ≥4.0: complex PDF with tables, formulas, dual-column layout (SDD/IDD)",
SupportedTypes: []string{"pdf"},
}, func(cfg *config.Config) DocParser {
return &mineruParser{
endpoint:    cfg.Parser.MinerUEndpoint,
apiKey:      cfg.Parser.MinerUAPIKey,
timeout:     cfg.Parser.MinerUTimeout,
httpClient:  &http.Client{Timeout: cfg.Parser.MinerUTimeout},
}
})
}

type mineruParser struct {
endpoint   string
apiKey     string
timeout    time.Duration
httpClient *http.Client
}

func (p *mineruParser) Name() string            { return "mineru" }
func (p *mineruParser) SupportedTypes() []string { return []string{"pdf"} }
func (p *mineruParser) Available() bool          { return p.endpoint != "" }

// Parse uploads the PDF to MinerU and returns the Markdown result.
// Supports MinerU V1 API (≥4.0): POST /v1/file-urls/batch
func (p *mineruParser) Parse(ctx context.Context, filePath string) (*types.ParsedDocument, error) {
f, err := os.Open(filePath)
if err != nil {
return nil, fmt.Errorf("mineru: open %q: %w", filePath, err)
}
defer f.Close()

var body bytes.Buffer
w := multipart.NewWriter(&body)
fw, err := w.CreateFormFile("file", filepath.Base(filePath))
if err != nil {
return nil, fmt.Errorf("mineru: create form file: %w", err)
}
if _, err = io.Copy(fw, f); err != nil {
return nil, fmt.Errorf("mineru: copy file: %w", err)
}
_ = w.WriteField("parse_method", "auto")
_ = w.WriteField("return_content_list", "true")
w.Close()

req, err := http.NewRequestWithContext(ctx, http.MethodPost,
strings.TrimRight(p.endpoint, "/")+"/v1/file-urls/batch", &body)
if err != nil {
return nil, fmt.Errorf("mineru: build request: %w", err)
}
req.Header.Set("Content-Type", w.FormDataContentType())
if p.apiKey != "" {
req.Header.Set("Authorization", "Bearer "+p.apiKey)
}

resp, err := p.httpClient.Do(req)
if err != nil {
return nil, fmt.Errorf("mineru: HTTP call: %w", err)
}
defer resp.Body.Close()
raw, _ := io.ReadAll(resp.Body)

if resp.StatusCode != http.StatusOK {
return nil, fmt.Errorf("mineru: HTTP %d: %s", resp.StatusCode, raw)
}

// MinerU V1 response schema
var result struct {
Code int    `json:"code"`
Msg  string `json:"msg"`
Data struct {
Markdown    string `json:"markdown"`
ContentList []struct {
Type    string `json:"type"`
Content string `json:"content"`
} `json:"content_list"`
} `json:"data"`
}
if err := json.Unmarshal(raw, &result); err != nil {
return nil, fmt.Errorf("mineru: decode response: %w", err)
}
if result.Code != 0 {
return nil, fmt.Errorf("mineru: API error %d: %s", result.Code, result.Msg)
}

markdown := result.Data.Markdown
if markdown == "" {
// Fallback: join content_list entries
var parts []string
for _, c := range result.Data.ContentList {
if c.Content != "" {
parts = append(parts, c.Content)
}
}
markdown = strings.Join(parts, "\n\n")
}

base := strings.TrimSuffix(filepath.Base(filePath), filepath.Ext(filePath))
return &types.ParsedDocument{
Source:   filePath,
FileType: "pdf",
Engine:   "mineru",
Title:    base,
Content:  markdown,
Metadata: map[string]string{"mineru_code": fmt.Sprintf("%d", result.Code)},
}, nil
}
