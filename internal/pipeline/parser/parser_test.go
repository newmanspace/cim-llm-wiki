package parser

import (
	"cim-llm-wiki/internal/config"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestParserRoutingAndPlainText(t *testing.T) {
	ctx := context.Background()
	cfg := &config.Config{}
	path := filepath.Join(t.TempDir(), "source.md")
	if err := os.WriteFile(path, []byte("# Source\r\nOriginal\rNext"), 0600); err != nil {
		t.Fatal(err)
	}
	parsed, err := MustParse(ctx, cfg, path)
	if err != nil || parsed.Content != "# Source\nOriginal\nNext" || parsed.Source != path {
		t.Fatal("plain text normalization or provenance failed", err)
	}
	for _, name := range []string{"missing", "ocr", "docling", "mineru"} {
		if _, err := For(ctx, cfg, path, name); err == nil {
			t.Fatalf("unavailable engine %s accepted", name)
		}
	}
	for _, suffix := range []string{"pdf", "docx", "png"} {
		if _, err := For(ctx, cfg, "document."+suffix, ""); err == nil {
			t.Fatalf("unavailable conversion silently fell back for %s", suffix)
		}
	}
	if _, err := For(ctx, cfg, "no-extension", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := (&simpleParser{}).Parse(ctx, path+".missing"); err == nil {
		t.Fatal("missing source accepted")
	}
	ocr := &ocrParser{}
	if ocr.Available() || ocr.Name() != "ocr" || len(ocr.SupportedTypes()) == 0 {
		t.Fatal("OCR availability incorrect")
	}
	if _, err := ocr.Parse(ctx, path); err == nil {
		t.Fatal("unimplemented OCR accepted")
	}
	if len(ListEngines(cfg)) != 4 {
		t.Fatal("registry lost an engine")
	}
}

func TestRemoteParserContractsAndFailures(t *testing.T) {
	path := filepath.Join(t.TempDir(), "source.xlsx")
	if err := os.WriteFile(path, []byte("original bytes"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, engine := range []string{"docling", "mineru"} {
		t.Run(engine, func(t *testing.T) {
			status := 200
			payload := `{"document":{"md_content":"# Converted"}}`
			if engine == "mineru" {
				payload = `{"code":0,"data":{"markdown":"# Converted"}}`
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				file, _, err := r.FormFile("file")
				if err != nil {
					t.Error(err)
					w.WriteHeader(400)
					return
				}
				defer file.Close()
				raw, _ := io.ReadAll(file)
				if string(raw) != "original bytes" {
					t.Error("original upload changed")
				}
				w.WriteHeader(status)
				_, _ = w.Write([]byte(payload))
			}))
			defer server.Close()
			cfg := &config.Config{Parser: config.ParserConfig{DoclingEndpoint: server.URL, DoclingTimeout: time.Second, MinerUEndpoint: server.URL, MinerUTimeout: time.Second, MinerUAPIKey: "unit-key"}}
			parser, err := For(context.Background(), cfg, path, engine)
			if err != nil {
				t.Fatal(err)
			}
			if parser.Name() != engine || len(parser.SupportedTypes()) == 0 || !parser.Available() {
				t.Fatal("remote engine metadata mismatch")
			}
			document, err := parser.Parse(context.Background(), path)
			if err != nil || document.Content != "# Converted" || document.Source != path {
				t.Fatal("conversion contract or provenance failed", err)
			}
			if engine == "mineru" {
				payload = `{"code":0,"data":{"content_list":[{"content":"Part 1"},{"content":""},{"content":"Part 2"}]}}`
				doc, err := parser.Parse(context.Background(), path)
				if err != nil || doc.Content != "Part 1\n\nPart 2" {
					t.Fatal("MinerU content list fallback failed", err)
				}
				payload = `{"code":1,"msg":"rejected"}`
				if _, err := parser.Parse(context.Background(), path); err == nil {
					t.Fatal("MinerU error accepted")
				}
			}
			payload = "invalid-json"
			if _, err := parser.Parse(context.Background(), path); err == nil {
				t.Fatal("malformed response accepted")
			}
			status = 503
			if _, err := parser.Parse(context.Background(), path); err == nil {
				t.Fatal("service failure accepted")
			}
			if _, err := parser.Parse(context.Background(), path+".missing"); err == nil {
				t.Fatal("missing input accepted")
			}
			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			if _, err := parser.Parse(ctx, path); err == nil {
				t.Fatal("cancelled conversion accepted")
			}
			if strings.Contains(engine, "docling") {
				bad := &doclingParser{endpoint: ":bad-url", httpClient: server.Client()}
				if _, err := bad.Parse(context.Background(), path); err == nil {
					t.Fatal("invalid endpoint accepted")
				}
			} else {
				bad := &mineruParser{endpoint: ":bad-url", httpClient: server.Client()}
				if _, err := bad.Parse(context.Background(), path); err == nil {
					t.Fatal("invalid endpoint accepted")
				}
			}
		})
	}
}
