package store

import (
	"cim-llm-wiki/internal/documentquality"
	"cim-llm-wiki/internal/types"
	"context"
	"fmt"
	"strings"
)

func NormalizeCodeRepository(r *types.RepoBinding) error {
	if r.Type == "" {
		r.Type = "git"
	}
	if r.RevisionSelector == "" {
		r.RevisionSelector = r.Branch
		if r.RevisionSelector == "" {
			r.RevisionSelector = "HEAD"
		}
	}
	if len(r.Name) > 100 || strings.ContainsAny(r.Name, "\r\n\t\x00") {
		return &documentquality.Error{Status: 422, Message: "Invalid code source name"}
	}
	cfg, e := documentquality.NormalizeSourceConfig(documentquality.Record{"name": r.Name, "type": r.Type, "url": r.URL, "subpath": r.Subpath, "revision_selector": r.RevisionSelector})
	if e != nil {
		return e
	}
	r.URL = documentquality.Text(cfg, "url")
	r.Auth = documentquality.Text(cfg, "auth")
	if r.Enabled == nil {
		value := true
		r.Enabled = &value
	}
	r.Branch = r.RevisionSelector
	return nil
}
func (s *Store) SaveCodeSource(ctx context.Context, project string, r types.RepoBinding, expected int) error {
	if expected < 0 {
		return &documentquality.Error{Status: 422, Message: "Invalid expected configuration revision"}
	}
	if e := NormalizeCodeRepository(&r); e != nil {
		return e
	}
	tx, e := s.pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	var key string
	if e = tx.QueryRow(ctx, "SELECT id FROM projects WHERE id=$1 FOR UPDATE", project).Scan(&key); e != nil {
		return qualityError(e)
	}
	if expected == 0 {
		_, e = tx.Exec(ctx, `INSERT INTO project_repos(project_id,name,url,branch,source_type,source_subpath,revision_selector,enabled) VALUES($1,$2,$3,$4,$5,$6,$4,$7)`, project, r.Name, r.URL, r.RevisionSelector, r.Type, r.Subpath, r.Enabled)
	} else {
		tag, err := tx.Exec(ctx, `UPDATE project_repos SET url=$3,branch=$4,source_subpath=$5,revision_selector=$4,enabled=$6,config_revision=config_revision+1,updated_at=now(),
 last_sync_sha=CASE WHEN url<>$3 OR source_subpath<>$5 OR revision_selector<>$4 THEN NULL ELSE last_sync_sha END,
 synced_at=CASE WHEN url<>$3 OR source_subpath<>$5 OR revision_selector<>$4 THEN NULL ELSE synced_at END
 WHERE project_id=$1 AND name=$2 AND config_revision=$7 AND source_type=$8`, project, r.Name, r.URL, r.RevisionSelector, r.Subpath, r.Enabled, expected, r.Type)
		e = err
		if e == nil && tag.RowsAffected() != 1 {
			return &documentquality.Error{Status: 409, Message: "Code source changed, or its type/name cannot be changed; reload or create a new source"}
		}
	}
	if e != nil {
		return qualityError(e)
	}
	if e = tx.Commit(ctx); e != nil {
		return fmt.Errorf("save code source: %w", e)
	}
	return nil
}
