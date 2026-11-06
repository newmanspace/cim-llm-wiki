package hitl

import (
	"cim-llm-wiki/internal/types"
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestReviewLifecycleSurvivesRestartWithoutReusingIDs(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "queue.db")
	queue, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	first, err := queue.Push(ctx, "shared://team/source.xlsx", "wip", []types.KnowledgeNode{{ID: "REQ-TEST", ReviewLevel: types.ReviewL2Arch}})
	if err != nil || first.ReviewLevel != types.ReviewL2Arch {
		t.Fatal("critical review level lost", err)
	}
	if _, err := queue.Get(ctx, "missing"); err == nil {
		t.Fatal("missing bundle accepted")
	}
	if _, err := queue.Approve(ctx, "missing", "reviewer", "note"); err == nil {
		t.Fatal("missing review accepted")
	}
	if err := queue.SetGitCommit(ctx, "missing", "revision"); err == nil {
		t.Fatal("missing bundle commit accepted")
	}
	approved, err := queue.Approve(ctx, first.ID, "reviewer", "checked")
	if err != nil || approved.Reviewer != "reviewer" || approved.ReviewedAt == nil {
		t.Fatal("review identity lost", err)
	}
	if _, err := queue.Reject(ctx, first.ID, "reviewer", "late"); err == nil {
		t.Fatal("approved review changed")
	}
	if err := queue.SetGitCommit(ctx, first.ID, "revision"); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	saved, err := reopened.Get(ctx, first.ID)
	if err != nil || saved.GitCommit != "revision" {
		t.Fatal("queue state did not persist")
	}
	second, err := reopened.Push(ctx, "source-v2.md", "wip", nil)
	if err != nil || second.ID == first.ID {
		t.Fatal("restart reused an existing bundle id", err)
	}
	rejected, err := reopened.Reject(ctx, second.ID, "architect", "needs changes")
	if err != nil || rejected.Status != types.BundleRejected {
		t.Fatal("rejection failed", err)
	}
	filtered, err := reopened.List(ctx, types.BundleApproved)
	if err != nil || len(filtered) != 1 || filtered[0].ID != first.ID {
		t.Fatal("review filtering failed")
	}
	all, err := reopened.List(ctx, "")
	if err != nil || len(all) != 2 || all[0].ID != second.ID {
		t.Fatal("review order lost")
	}
}

func TestQueueRefusesCorruptAndUnwritableStores(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "queue.json")
	if err := os.WriteFile(path, []byte("invalid"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(path); err == nil {
		t.Fatal("corrupt queue accepted")
	}
	if err := os.WriteFile(path, nil, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(path); err != nil {
		t.Fatal("empty queue rejected", err)
	}
	if err := os.WriteFile(path, []byte(`[null,{"id":""}]`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(path); err != nil {
		t.Fatal("empty entries should be ignored", err)
	}
	if _, err := Open(filepath.Join(path, "queue.json")); err == nil {
		t.Fatal("non-directory store parent accepted")
	}
	queue, err := Open(filepath.Join(root, "valid.json"))
	if err != nil {
		t.Fatal(err)
	}
	queue.filePath = filepath.Join(path, "blocked.json")
	if _, err := queue.Push(context.Background(), "source.md", "wip", nil); err == nil {
		t.Fatal("failed persistence accepted")
	}
	t.Chdir(t.TempDir())
	if _, err := Open(""); err != nil {
		t.Fatal("default isolated queue failed", err)
	}
}
