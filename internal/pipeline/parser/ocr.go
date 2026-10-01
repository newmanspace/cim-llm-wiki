package parser

import (
"context"
"fmt"
"path/filepath"
"strings"

"github.com/cim-llm/cim-wiki/internal/config"
"github.com/cim-llm/cim-wiki/internal/types"
)

func init() {
Register(EngineInfo{
Name:           "ocr",
Description:    "PaddleOCR: scanned images and historical paper documents",
SupportedTypes: []string{"jpg", "jpeg", "png", "tiff", "tif", "bmp", "gif", "webp"},
}, func(cfg *config.Config) DocParser {
return &ocrParser{langs: cfg.Parser.OCRLanguages}
})
}

type ocrParser struct {
langs []string
}

func (p *ocrParser) Name() string { return "ocr" }
func (p *ocrParser) SupportedTypes() []string {
return []string{"jpg", "jpeg", "png", "tiff", "tif", "bmp", "gif", "webp"}
}

// Available reports true if PaddleOCR Python bridge is reachable.
// For now this returns false until the bridge is wired up.
func (p *ocrParser) Available() bool {
// TODO: implement liveness check against PaddleOCR HTTP sidecar
return false
}

// Parse calls PaddleOCR via HTTP sidecar to extract text from the image.
func (p *ocrParser) Parse(_ context.Context, filePath string) (*types.ParsedDocument, error) {
// TODO: implement HTTP call to PaddleOCR sidecar (POST /ocr with image bytes)
ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(filePath), "."))
base := strings.TrimSuffix(filepath.Base(filePath), filepath.Ext(filePath))
return nil, fmt.Errorf("ocr: engine not yet implemented for %s (file: %s)", ext, base)
}
