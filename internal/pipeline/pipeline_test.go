package pipeline_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/cim-llm/cim-wiki/internal/config"
	"github.com/cim-llm/cim-wiki/internal/hitl"
	"github.com/cim-llm/cim-wiki/internal/pipeline"
	"github.com/cim-llm/cim-wiki/internal/types"
)

func TestPipelineE2E(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "cim-wiki-test-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	wikiDir := filepath.Join(tmpDir, "wiki")
	hitlPath := filepath.Join(tmpDir, "hitl.json")

	cfg := config.Load()
	cfg.Wiki.OutputDir = wikiDir
	cfg.Evaluator.ThreshL0Auto = 0.85
	cfg.Evaluator.ThreshL1Expert = 0.65
	cfg.Evaluator.ThreshL2Arch = 0.40

	queue, err := hitl.Open(hitlPath)
	if err != nil {
		t.Fatalf("hitl.Open error: %v", err)
	}

	p, err := pipeline.New(cfg, queue)
	if err != nil {
		t.Fatalf("pipeline.New error: %v", err)
	}

	// 准备测试用的 raw 文档
	testRawFile := filepath.Join(tmpDir, "sample_br.md")
	rawContent := `# 晶圆加工业务规则 SDD

## 业务规则 BR-WIP-001: 晶圆投产批次控制
- 模块: WIP
- 规则说明: 当设备状态为 DOWN 时，禁止向腔体投送批次（Lot）。若超时 15 分钟无心跳上报，自动转入 HOLD 状态。
- 相关对象: Lot, Equipment, Chamber
`
	if err := os.WriteFile(testRawFile, []byte(rawContent), 0644); err != nil {
		t.Fatal(err)
	}

	ctx := context.Background()
	resp, err := p.Run(ctx, testRawFile, "WIP", "")
	if err != nil {
		t.Fatalf("pipeline.Run error: %v", err)
	}

	t.Logf("Pipeline Run Success: TotalNodes=%d, AutoPublished=%d, PendingReview=%d, Engine=%s",
		resp.TotalNodes, resp.AutoPublished, resp.PendingReview, resp.Engine)

	if resp.TotalNodes == 0 {
		t.Fatalf("expected extracted nodes, got 0")
	}

	// 验证如果存在 pending review，HITL 队列有对应的 bundle
	if resp.PendingReview > 0 {
		if resp.BundleID == "" {
			t.Errorf("expected BundleID for pending review nodes")
		}
		bundles, err := queue.List(ctx, types.BundlePending)
		if err != nil || len(bundles) == 0 {
			t.Errorf("expected pending bundles in HITL, got %v", bundles)
		}
	}
}
