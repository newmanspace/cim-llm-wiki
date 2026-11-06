package compiler

import (
	"cim-llm-wiki/internal/types"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCompilerConfinesWritesAndRenders(t *testing.T) {
	root := t.TempDir()
	c, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	node := types.KnowledgeNode{ID: "../REQ-TEST-001", Type: types.ObjRequirement, Title: "Requirement", Content: "Expected behavior", Module: "wip", Source: "shared://team/original.xlsx"}
	paths, err := c.Compile(context.Background(), []types.KnowledgeNode{node})
	if err != nil || len(paths) != 1 {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(paths[0])
	if err != nil || !strings.Contains(string(raw), node.Source) {
		t.Fatal("original source missing")
	}
	virtual, err := c.CompileVirtualDocument(context.Background(), "wip", "sdd")
	if err != nil || !strings.Contains(virtual, node.Content) {
		t.Fatal("virtual document missing node")
	}
	outside := t.TempDir()
	target := filepath.Join(outside, "protected.md")
	if err := os.WriteFile(target, []byte("protected"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, filepath.Join(root, "requirements", "escape.md")); err != nil {
		t.Fatal(err)
	}
	node.ID = "escape"
	if _, err := c.Compile(context.Background(), []types.KnowledgeNode{node}); err == nil {
		t.Fatal("symlink escaped compiler root")
	}
	raw, _ = os.ReadFile(target)
	if string(raw) != "protected" {
		t.Fatal("external file overwritten")
	}
	if err := os.RemoveAll(filepath.Join(root, "requirements")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "requirements")); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Compile(context.Background(), []types.KnowledgeNode{node}); err == nil {
		t.Fatal("parent symlink escaped compiler root")
	}
}
