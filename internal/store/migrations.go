package store

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"github.com/jackc/pgx/v5"
)

// ApplyMigration serializes schema upgrades and rejects edits to applied migration files.
func (s *Store) ApplyMigration(ctx context.Context, name, sql string) error {
	tx, e := s.pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, e = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(44261726)"); e != nil {
		return e
	}
	if _, e = tx.Exec(ctx, "CREATE TABLE IF NOT EXISTS app_schema_migrations(name TEXT PRIMARY KEY,sha256 TEXT NOT NULL,applied_at TIMESTAMPTZ NOT NULL DEFAULT now())"); e != nil {
		return e
	}
	sum := sha256.Sum256([]byte(sql))
	digest := hex.EncodeToString(sum[:])
	var old string
	e = tx.QueryRow(ctx, "SELECT sha256 FROM app_schema_migrations WHERE name=$1", name).Scan(&old)
	if e == nil {
		if old != digest {
			return fmt.Errorf("applied migration checksum changed: %s", name)
		}
		return tx.Commit(ctx)
	}
	if e != pgx.ErrNoRows {
		return e
	}
	adopt := false
	if name == "001_init.sql" {
		if e = tx.QueryRow(ctx, "SELECT to_regclass('projects') IS NOT NULL AND to_regclass('project_docs') IS NOT NULL AND to_regclass('project_tokens') IS NOT NULL AND to_regclass('project_repos') IS NOT NULL AND to_regclass('doc_bundles') IS NOT NULL AND to_regclass('project_modules') IS NOT NULL AND to_regclass('repo_module_mappings') IS NOT NULL AND to_regclass('sync_logs') IS NOT NULL AND to_regclass('project_wiki_nodes') IS NOT NULL").Scan(&adopt); e != nil {
			return e
		}
	}
	if !adopt {
		if _, e = tx.Exec(ctx, sql); e != nil {
			return fmt.Errorf("migration %s failed: %w", name, e)
		}
	}
	if _, e = tx.Exec(ctx, "INSERT INTO app_schema_migrations(name,sha256) VALUES($1,$2)", name, digest); e != nil {
		return e
	}
	return tx.Commit(ctx)
}
