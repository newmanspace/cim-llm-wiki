// Package extractor implements Stage 2 of the knowledge pipeline:
// ParsedDocument → []KnowledgeNode via LLM decomposition (OpenAI-compatible)
// with heuristic rule-based fallback when LLM is unavailable.
//
// The LLM prompt encodes the domain taxonomy (§3.1) and enforces
// strict JSON output matching the KnowledgeNode schema.
package extractor

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"

	"cim-llm-wiki/internal/config"
	"cim-llm-wiki/internal/types"
)

// Extractor calls an OpenAI-compatible LLM to decompose a ParsedDocument
// into atomic KnowledgeNodes.
type Extractor struct {
	cfg        *config.LLMConfig
	httpClient *http.Client
}

// New creates a new Extractor from config.
func New(cfg *config.LLMConfig) *Extractor {
	return &Extractor{
		cfg:        cfg,
		httpClient: &http.Client{Timeout: 15 * time.Second},
	}
}

// Extract decomposes doc into KnowledgeNodes for the given module.
// Each call to the LLM is bounded to ~8k chars of content to stay within
// context limits; large documents are split into chunks internally.
func (e *Extractor) Extract(ctx context.Context, doc *types.ParsedDocument, module string) ([]types.KnowledgeNode, error) {
	if doc.Content == "" {
		return nil, fmt.Errorf("extractor: document %q has no content", doc.Source)
	}

	chunks := chunkContent(doc.Content, 6000, 500)
	var allNodes []types.KnowledgeNode

	for i, chunk := range chunks {
		var nodes []types.KnowledgeNode
		var err error

		// Check if LLM is explicitly configured
		if e.cfg != nil && e.cfg.APIKey != "" && !strings.Contains(e.cfg.BaseURL, "api.openai.com") {
			prompt := buildPrompt(doc, module, chunk)
			nodes, err = e.callLLM(ctx, prompt)
		} else {
			err = fmt.Errorf("LLM API key not configured, falling back to heuristic extractor")
		}

		if err != nil {
			slog.Warn("extractor falling back to rule-based parser", "reason", err.Error(), "chunk", i+1)
			nodes = fallbackExtract(doc, module, chunk)
		}

		// Stamp provenance on every extracted node
		now := time.Now().UTC()
		for j := range nodes {
			nodes[j].Source = doc.Source
			nodes[j].Module = module
			nodes[j].Status = types.StatusDraft
			nodes[j].CreatedAt = now
			nodes[j].UpdatedAt = now
			if nodes[j].Product == "" {
				nodes[j].Product = "Semiconductor-MES"
			}
			if nodes[j].Version == "" {
				nodes[j].Version = "v1.0"
			}
		}
		allNodes = append(allNodes, nodes...)
	}
	return allNodes, nil
}

// ─── Rule-Based Heuristic Fallback ──────────────────────────────────────────

var headingRegex = regexp.MustCompile(`(?m)^(#{1,3})\s+(.+)$`)
var idRegex = regexp.MustCompile(`\b([A-Z]{2,4}-[A-Z0-9]+-\d{2,4})\b`)

func fallbackExtract(doc *types.ParsedDocument, module, content string) []types.KnowledgeNode {
	var nodes []types.KnowledgeNode
	lines := strings.Split(content, "\n")

	var currentTitle string
	var currentBody []string
	var nodeType types.ObjectType = types.ObjDesign
	var nodeID string

	flush := func() {
		if strings.TrimSpace(currentTitle) == "" && len(currentBody) == 0 {
			return
		}
		bodyText := strings.TrimSpace(strings.Join(currentBody, "\n"))
		if bodyText == "" {
			bodyText = currentTitle
		}

		if nodeID == "" {
			prefix := "DES"
			switch nodeType {
			case types.ObjBusinessRule:
				prefix = "BR"
			case types.ObjAPI:
				prefix = "API"
			case types.ObjRequirement:
				prefix = "REQ"
			case types.ObjScenario:
				prefix = "SC"
			}
			nodeID = fmt.Sprintf("%s-%s-%03d", prefix, strings.ToUpper(module), len(nodes)+1)
		}

		nodes = append(nodes, types.KnowledgeNode{
			ID:      nodeID,
			Type:    nodeType,
			Title:   currentTitle,
			Content: bodyText,
			Domain:  "manufacturing-execution",
			Module:  module,
		})

		currentTitle = ""
		currentBody = nil
		nodeType = types.ObjDesign
		nodeID = ""
	}

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "#") {
			flush()
			currentTitle = strings.TrimLeft(trimmed, "# ")

			// Determine node type based on title keywords
			lower := strings.ToLower(currentTitle)
			if strings.Contains(lower, "rule") || strings.Contains(lower, "规则") || strings.Contains(currentTitle, "BR-") {
				nodeType = types.ObjBusinessRule
			} else if strings.Contains(lower, "api") || strings.Contains(lower, "接口") {
				nodeType = types.ObjAPI
			} else if strings.Contains(lower, "scenario") || strings.Contains(lower, "流程") || strings.Contains(lower, "场景") {
				nodeType = types.ObjScenario
			} else if strings.Contains(lower, "requirement") || strings.Contains(lower, "需求") {
				nodeType = types.ObjRequirement
			}

			if matches := idRegex.FindStringSubmatch(currentTitle); len(matches) > 1 {
				nodeID = matches[1]
			}
		} else {
			currentBody = append(currentBody, line)
		}
	}
	flush()

	// If no headings found, package entire content as a single document node
	if len(nodes) == 0 && strings.TrimSpace(content) != "" {
		nodes = append(nodes, types.KnowledgeNode{
			ID:      fmt.Sprintf("DOC-%s-001", strings.ToUpper(module)),
			Type:    types.ObjDesign,
			Title:   "Document Section",
			Content: strings.TrimSpace(content),
			Domain:  "manufacturing-execution",
			Module:  module,
		})
	}

	return nodes
}

// ─── LLM communication ───────────────────────────────────────────────────────

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatRequest struct {
	Model       string        `json:"model"`
	Messages    []chatMessage `json:"messages"`
	Temperature float64       `json:"temperature"`
	MaxTokens   int           `json:"max_tokens"`
}

type chatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

func (e *Extractor) callLLM(ctx context.Context, prompt string) ([]types.KnowledgeNode, error) {
	reqBody := chatRequest{
		Model: e.cfg.Model,
		Messages: []chatMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: prompt},
		},
		Temperature: e.cfg.Temperature,
		MaxTokens:   e.cfg.MaxTokens,
	}
	raw, err := json.Marshal(reqBody)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		strings.TrimRight(e.cfg.BaseURL, "/")+"/chat/completions",
		bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if e.cfg.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+e.cfg.APIKey)
	}

	resp, err := e.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("LLM HTTP: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("LLM HTTP %d: %s", resp.StatusCode, body)
	}

	var chatResp chatResponse
	if err := json.Unmarshal(body, &chatResp); err != nil {
		return nil, fmt.Errorf("parse LLM response: %w", err)
	}
	if chatResp.Error != nil {
		return nil, fmt.Errorf("LLM API error: %s", chatResp.Error.Message)
	}
	if len(chatResp.Choices) == 0 {
		return nil, fmt.Errorf("LLM returned 0 choices")
	}

	content := strings.TrimSpace(chatResp.Choices[0].Message.Content)
	if strings.HasPrefix(content, "```") {
		lines := strings.Split(content, "\n")
		if len(lines) >= 2 {
			content = strings.Join(lines[1:len(lines)-1], "\n")
		}
	}

	var nodes []types.KnowledgeNode
	if err := json.Unmarshal([]byte(content), &nodes); err == nil {
		return nodes, nil
	}
	var wrapper struct {
		Nodes []types.KnowledgeNode `json:"nodes"`
	}
	if err := json.Unmarshal([]byte(content), &wrapper); err == nil {
		return wrapper.Nodes, nil
	}
	return nil, fmt.Errorf("extractor: cannot parse LLM output as KnowledgeNode array:\n%s", content[:min(200, len(content))])
}

// ─── Prompt construction ─────────────────────────────────────────────────────

const systemPrompt = `你是一个专业的半导体MES软件知识工程师，擅长解构SDD/IDD设计文档。
请从用户提供的文档片段中提取所有知识节点，严格输出JSON数组，不要包含任何其他文字。`

func buildPrompt(doc *types.ParsedDocument, module, content string) string {
	return fmt.Sprintf(`文档来源: %s
目标模块: %s
文档类型: %s

请提取所有知识节点，输出JSON数组，每个节点格式如下：
{
  "id": "TYPE-DOMAIN-SEQ，如BR-WIP-001",
  "type": "business_rule|business_object|workflow|api|design|module|requirement|test_case|incident|faq",
  "title": "简洁标题",
  "content": "完整Markdown内容",
  "product": "产品名称，如Semiconductor-MES",
  "version": "版本号，如V5.2",
  "domain": "业务域，如manufacturing-execution",
  "module": "模块名",
  "confidence": 0.0到1.0
}

文档内容：
%s`, doc.Source, module, doc.FileType, content)
}

// ─── helpers ─────────────────────────────────────────────────────────────────

func chunkContent(content string, size, overlap int) []string {
	if len(content) <= size {
		return []string{content}
	}
	var chunks []string
	for start := 0; start < len(content); start += size - overlap {
		end := start + size
		if end > len(content) {
			end = len(content)
		}
		chunks = append(chunks, content[start:end])
		if end == len(content) {
			break
		}
	}
	return chunks
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
