// Package hitl implements the Human-In-The-Loop review queue (§5.1).
//
// When the evaluator assigns ReviewLevel L1 or L2 to a set of nodes,
// the pipeline bundles them into a ChangeBundle and pushes it here.
// Reviewers interact with the bundle via the /api/v1/review endpoints.
//
// Storage: Thread-safe JSON file store with WAL-like atomic persistence,
// ensuring zero external CGO/driver dependencies for maximum portability.
package hitl

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"cim-llm-wiki/internal/types"
)

// Queue manages ChangeBundle lifecycle with thread-safe JSON file persistence.
type Queue struct {
	filePath string
	mu       sync.RWMutex
	bundles  map[string]*types.ChangeBundle
	seq      int
}

// Open opens (or creates) the HITL queue store.
// If storagePath ends in .db, it creates a corresponding .json persistence file in the same directory.
func Open(storagePath string) (*Queue, error) {
	if storagePath == "" {
		storagePath = "data/hitl_bundles.json"
	}
	if filepath.Ext(storagePath) == ".db" {
		storagePath = storagePath[:len(storagePath)-3] + ".json"
	}

	if err := os.MkdirAll(filepath.Dir(storagePath), 0755); err != nil {
		return nil, fmt.Errorf("hitl: create store dir: %w", err)
	}

	q := &Queue{
		filePath: storagePath,
		bundles:  make(map[string]*types.ChangeBundle),
	}

	if err := q.load(); err != nil {
		return nil, fmt.Errorf("hitl: load bundles: %w", err)
	}

	return q, nil
}

func (q *Queue) load() error {
	data, err := os.ReadFile(q.filePath)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if len(data) == 0 {
		return nil
	}

	var list []*types.ChangeBundle
	if err := json.Unmarshal(data, &list); err != nil {
		return err
	}

	for _, b := range list {
		if b != nil && b.ID != "" {
			q.bundles[b.ID] = b
		}
	}
	return nil
}

func (q *Queue) save() error {
	list := make([]*types.ChangeBundle, 0, len(q.bundles))
	for _, b := range q.bundles {
		list = append(list, b)
	}

	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}

	tmpPath := q.filePath + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0644); err != nil {
		return err
	}
	return os.Rename(tmpPath, q.filePath)
}

// Push creates a ChangeBundle from the given nodes and stores it as pending.
func (q *Queue) Push(ctx context.Context, sourceDoc, module string, nodes []types.KnowledgeNode) (*types.ChangeBundle, error) {
	q.mu.Lock()
	defer q.mu.Unlock()

	q.seq++
	seq := q.seq

	// Determine the highest-risk review level in the batch
	level := types.ReviewL1Expert
	for _, n := range nodes {
		if n.ReviewLevel == types.ReviewL2Arch {
			level = types.ReviewL2Arch
			break
		}
	}

	bundle := &types.ChangeBundle{
		ID:          fmt.Sprintf("CR-%s-%04d", time.Now().UTC().Format("20060102"), seq),
		SourceDoc:   sourceDoc,
		Module:      module,
		Nodes:       nodes,
		ReviewLevel: level,
		Status:      types.BundlePending,
		CreatedAt:   time.Now().UTC(),
	}

	q.bundles[bundle.ID] = bundle
	if err := q.save(); err != nil {
		return nil, fmt.Errorf("hitl: save bundle: %w", err)
	}

	return bundle, nil
}

// List returns all bundles matching the given status filter (empty = all).
func (q *Queue) List(ctx context.Context, status types.BundleStatus) ([]types.ChangeBundle, error) {
	q.mu.RLock()
	defer q.mu.RUnlock()

	var result []types.ChangeBundle
	for _, b := range q.bundles {
		if status == "" || b.Status == status {
			result = append(result, *b)
		}
	}

	sort.Slice(result, func(i, j int) bool {
		return result[i].CreatedAt.After(result[j].CreatedAt)
	})

	return result, nil
}

// Get returns a single bundle by ID.
func (q *Queue) Get(ctx context.Context, bundleID string) (*types.ChangeBundle, error) {
	q.mu.RLock()
	defer q.mu.RUnlock()

	b, exists := q.bundles[bundleID]
	if !exists {
		return nil, fmt.Errorf("hitl: bundle %q not found", bundleID)
	}

	// return a copy
	res := *b
	return &res, nil
}

// Approve marks a bundle as approved, records the reviewer, and
// persists the updated payload. The caller (handler) is responsible
// for triggering compilation + git commit afterward.
func (q *Queue) Approve(ctx context.Context, bundleID, reviewer, note string) (*types.ChangeBundle, error) {
	return q.transition(ctx, bundleID, types.BundleApproved, reviewer, note)
}

// Reject marks a bundle as rejected.
func (q *Queue) Reject(ctx context.Context, bundleID, reviewer, note string) (*types.ChangeBundle, error) {
	return q.transition(ctx, bundleID, types.BundleRejected, reviewer, note)
}

func (q *Queue) transition(ctx context.Context, bundleID string, status types.BundleStatus, reviewer, note string) (*types.ChangeBundle, error) {
	q.mu.Lock()
	defer q.mu.Unlock()

	bundle, exists := q.bundles[bundleID]
	if !exists {
		return nil, fmt.Errorf("hitl: bundle %q not found", bundleID)
	}
	if bundle.Status != types.BundlePending {
		return nil, fmt.Errorf("hitl: bundle %q already %s", bundleID, bundle.Status)
	}

	now := time.Now().UTC()
	bundle.Status = status
	bundle.Reviewer = reviewer
	bundle.ReviewNote = note
	bundle.ReviewedAt = &now

	if err := q.save(); err != nil {
		return nil, fmt.Errorf("hitl: update bundle: %w", err)
	}

	res := *bundle
	return &res, nil
}

// SetGitCommit records the commit hash after successful compilation.
func (q *Queue) SetGitCommit(ctx context.Context, bundleID, commitHash string) error {
	q.mu.Lock()
	defer q.mu.Unlock()

	bundle, exists := q.bundles[bundleID]
	if !exists {
		return fmt.Errorf("hitl: bundle %q not found", bundleID)
	}
	bundle.GitCommit = commitHash
	return q.save()
}
