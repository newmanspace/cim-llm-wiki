// Package pipeline orchestrates the 5-stage knowledge processing flow:
//
//	Stage 1  parser     raw file → ParsedDocument
//	Stage 2  extractor  ParsedDocument → []KnowledgeNode (LLM)
//	Stage 3  evaluator  []KnowledgeNode → scored + ReviewLevel
//	Stage 4  HITL gate  split: auto-publish vs. review queue vs. archive
//	Stage 5  compiler   auto-publish nodes → wiki/ Markdown files
//
// The caller (HTTP handler) triggers Run() and gets back a RunResult
// that reports how many nodes went to each outcome.
package pipeline

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"cim-llm-wiki/internal/config"
	"cim-llm-wiki/internal/hitl"
	"cim-llm-wiki/internal/pipeline/compiler"
	"cim-llm-wiki/internal/pipeline/evaluator"
	"cim-llm-wiki/internal/pipeline/extractor"
	"cim-llm-wiki/internal/pipeline/parser"
	"cim-llm-wiki/internal/types"
)

// Pipeline is the stateful orchestrator for one cim-wiki instance.
type Pipeline struct {
	cfg      *config.Config
	compiler *compiler.Compiler
	eval     *evaluator.Evaluator
	extract  *extractor.Extractor
	hitlQ    *hitl.Queue
}

// New builds a Pipeline from the application config.
func New(cfg *config.Config, hitlQ *hitl.Queue) (*Pipeline, error) {
	comp, err := compiler.New(cfg.Wiki.OutputDir)
	if err != nil {
		return nil, fmt.Errorf("pipeline: init compiler: %w", err)
	}
	return &Pipeline{
		cfg:      cfg,
		compiler: comp,
		eval:     evaluator.New(&cfg.Evaluator),
		extract:  extractor.New(&cfg.LLM),
		hitlQ:    hitlQ,
	}, nil
}

// RunResult summarises the outcome of one pipeline run.
type RunResult struct {
	SourceDoc     string        `json:"source_doc"`
	Module        string        `json:"module"`
	Engine        string        `json:"engine"`
	TotalNodes    int           `json:"total_nodes"`
	AutoPublished int           `json:"auto_published"`
	PendingReview int           `json:"pending_review"`
	Archived      int           `json:"archived"`
	WikiFiles     []string      `json:"wiki_files"`
	BundleID      string        `json:"bundle_id,omitempty"`
	Duration      time.Duration `json:"duration_ms"`
	Error         string        `json:"error,omitempty"`
}

// Run executes the full pipeline for one raw document.
//
//	filePath  – absolute path to the raw document (inside data/raw/)
//	module    – target module name (e.g. "wip-management")
//	engine    – parser engine override ("" = auto-select)
func (p *Pipeline) Run(ctx context.Context, filePath, module, engine string) (*RunResult, error) {
	start := time.Now()
	result := &RunResult{SourceDoc: filePath, Module: module}
	slog.Info("pipeline.Run started", "file", fmt.Sprintf("%q", filePath), "module", fmt.Sprintf("%q", module))

	// ── Stage 1: Parse ───────────────────────────────────────────────────────
	slog.Info("pipeline [1/5] parsing", "file", fmt.Sprintf("%q", filePath))
	doc, err := parser.MustParse(ctx, p.cfg, filePath)
	if err != nil {
		return result, fmt.Errorf("stage1 parse: %w", err)
	}
	result.Engine = doc.Engine
	slog.Info("pipeline [1/5] parsed", "engine", doc.Engine, "chars", len(doc.Content))

	// ── Stage 2: Extract ─────────────────────────────────────────────────────
	slog.Info("pipeline [2/5] extracting knowledge", "module", fmt.Sprintf("%q", module))
	nodes, err := p.extract.Extract(ctx, doc, module)
	if err != nil {
		return result, fmt.Errorf("stage2 extract: %w", err)
	}
	result.TotalNodes = len(nodes)
	slog.Info("pipeline [2/5] extracted", "nodes", len(nodes))

	// ── Stage 3: Evaluate ────────────────────────────────────────────────────
	slog.Info("pipeline [3/5] evaluating quality")
	nodes = p.eval.Evaluate(ctx, nodes)

	// Partition nodes by ReviewLevel
	var autoNodes, reviewNodes, archiveNodes []types.KnowledgeNode
	for _, n := range nodes {
		switch n.ReviewLevel {
		case types.ReviewL0Auto:
			autoNodes = append(autoNodes, n)
		case types.ReviewL1Expert, types.ReviewL2Arch:
			reviewNodes = append(reviewNodes, n)
		default:
			archiveNodes = append(archiveNodes, n)
		}
	}
	result.AutoPublished = len(autoNodes)
	result.PendingReview = len(reviewNodes)
	result.Archived = len(archiveNodes)
	slog.Info("pipeline [3/5] evaluated",
		"auto", len(autoNodes), "review", len(reviewNodes), "archive", len(archiveNodes))

	// ── Stage 4: HITL gate ───────────────────────────────────────────────────
	if len(reviewNodes) > 0 {
		slog.Info("pipeline [4/5] pushing to HITL queue", "count", len(reviewNodes))
		bundle, err := p.hitlQ.Push(ctx, filePath, module, reviewNodes)
		if err != nil {
			slog.Warn("pipeline: HITL push failed", "err", err)
		} else {
			result.BundleID = bundle.ID
		}
	} else {
		slog.Info("pipeline [4/5] no nodes require HITL review")
	}

	// ── Stage 5: Compile auto-approved nodes ─────────────────────────────────
	if len(autoNodes) > 0 {
		slog.Info("pipeline [5/5] compiling to wiki", "count", len(autoNodes))
		for i := range autoNodes {
			autoNodes[i].Status = types.StatusApproved
		}
		written, err := p.compiler.Compile(ctx, autoNodes)
		if err != nil {
			return result, fmt.Errorf("stage5 compile: %w", err)
		}
		result.WikiFiles = written
		slog.Info("pipeline [5/5] compiled", "files", len(written))
	} else {
		slog.Info("pipeline [5/5] no nodes for auto-compilation")
	}

	result.Duration = time.Since(start)
	slog.Info("pipeline.Run finished", "duration", result.Duration, "files", len(result.WikiFiles))
	return result, nil
}
