package evaluator_test

import (
	"context"
	"testing"
	"time"

	"cim-llm-wiki/internal/config"
	"cim-llm-wiki/internal/pipeline/evaluator"
	"cim-llm-wiki/internal/types"
)

func TestEvaluatorScoring(t *testing.T) {
	cfg := config.Load()
	ev := evaluator.New(&cfg.Evaluator)

	now := time.Now().UTC()
	nodes := []types.KnowledgeNode{
		{
			ID:        "BR-WIP-001",
			Type:      types.ObjBusinessRule,
			Title:     "晶圆投产批次规则",
			Content:   "当设备处于DOWN状态时禁止投料。\n\n## 验证逻辑\n校验设备心跳状态与腔体锁定标识。",
			Source:    "docs/SDD_v2.4.docx",
			Product:   "CIM-MES",
			Version:   "v2.4",
			Domain:    "manufacturing-execution",
			Module:    "WIP",
			CreatedAt: now,
			UpdatedAt: now,
		},
		{
			ID:        "UNKNOWN-002",
			Type:      types.ObjDesign,
			Title:     "draft note",
			Content:   "todo",
			Source:    "unknown.txt",
			CreatedAt: now.AddDate(-3, 0, 0), // 3 years ago
			UpdatedAt: now.AddDate(-3, 0, 0),
		},
	}

	evaluated := ev.Evaluate(context.Background(), nodes)
	if len(evaluated) != 2 {
		t.Fatalf("expected 2 evaluated nodes, got %d", len(evaluated))
	}

	n1 := evaluated[0]
	n2 := evaluated[1]

	t.Logf("Node 1 Score: Total=%.3f (Auth=%.2f, Comp=%.2f, Rel=%.2f, Fresh=%.2f, Struct=%.2f, Reuse=%.2f, Risk=%.2f), ReviewLevel=%s",
		n1.QScore.Total, n1.QScore.SAuth, n1.QScore.SComp, n1.QScore.SRel,
		n1.QScore.SFresh, n1.QScore.SStruct, n1.QScore.SReuse, n1.QScore.SRisk, n1.ReviewLevel)

	t.Logf("Node 2 Score: Total=%.3f, ReviewLevel=%s", n2.QScore.Total, n2.ReviewLevel)

	if n1.QScore.Total <= n2.QScore.Total {
		t.Errorf("Node 1 (complete rule) should score higher than Node 2 (stale draft): %f <= %f",
			n1.QScore.Total, n2.QScore.Total)
	}

	if n1.ReviewLevel == types.ReviewArchive {
		t.Errorf("Valid rule should not be archived: %s", n1.ReviewLevel)
	}
}
