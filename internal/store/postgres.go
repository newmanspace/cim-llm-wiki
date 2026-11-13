// Package store provides PostgreSQL-backed persistence for the Admin system.
package store

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"cim-llm-wiki/internal/types"
)

// Store wraps a pgxpool connection pool for Admin CRUD operations.
type Store struct {
	pool *pgxpool.Pool
}

// New creates a Store from a PostgreSQL connection string.
func New(ctx context.Context, dsn string) (*Store, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("store: connect: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("store: ping: %w", err)
	}
	return &Store{pool: pool}, nil
}

// Close releases the connection pool.
func (s *Store) Close() { s.pool.Close() }

// Migrate runs the schema migration SQL file.
func (s *Store) Migrate(ctx context.Context, sql string) error {
	_, err := s.pool.Exec(ctx, sql)
	return err
}

// ─── Project CRUD ────────────────────────────────────────────────────────────

func (s *Store) ListProjects(ctx context.Context) ([]types.ProjectConfig, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, name, product, version, status, created_at, updated_at FROM projects ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []types.ProjectConfig
	for rows.Next() {
		var p types.ProjectConfig
		var status string
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&p.ID, &p.Name, &p.Product, &p.Version, &status, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		p.CreatedAt = createdAt.Format(time.RFC3339)
		p.UpdatedAt = updatedAt.Format(time.RFC3339)
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Store) GetProject(ctx context.Context, id string) (*types.ProjectConfig, error) {
	var p types.ProjectConfig
	var status string
	var createdAt, updatedAt time.Time
	err := s.pool.QueryRow(ctx,
		`SELECT id, name, product, version, status, created_at, updated_at FROM projects WHERE id = $1`, id).
		Scan(&p.ID, &p.Name, &p.Product, &p.Version, &status, &createdAt, &updatedAt)
	if err != nil {
		return nil, err
	}
	p.CreatedAt = createdAt.Format(time.RFC3339)
	p.UpdatedAt = updatedAt.Format(time.RFC3339)

	for _, load := range []func(context.Context, *types.ProjectConfig) error{s.loadProjectDocs, s.loadProjectRepos, s.loadProjectModules, s.loadProjectWikiNodes} {
		if err := load(ctx, &p); err != nil {
			return nil, err
		}
	}

	return &p, nil
}

func (s *Store) loadProjectDocs(ctx context.Context, p *types.ProjectConfig) error {
	// Load docs
	docRows, err := s.pool.Query(ctx,
		`SELECT doc_id, path, type, COALESCE(submodule,''), COALESCE(sha256,''), ingested_at
		 FROM project_docs WHERE project_id = $1 ORDER BY doc_id`, p.ID)
	if err != nil {
		return err
	}
	defer docRows.Close()
	for docRows.Next() {
		var d types.DocSource
		var ingested *time.Time
		if err := docRows.Scan(&d.DocID, &d.Path, &d.Type, &d.Submodule, &d.SHA256, &ingested); err != nil {
			return err
		}
		if ingested != nil {
			d.IngestedAt = ingested.Format(time.RFC3339)
		}
		p.Docs = append(p.Docs, d)
	}

	return docRows.Err()
}

func (s *Store) loadProjectRepos(ctx context.Context, p *types.ProjectConfig) error {
	// Load repos with module mappings
	repoRows, err := s.pool.Query(ctx,
		`SELECT id, name, url, branch, COALESCE(submodule,''), COALESCE(last_sync_sha,''), synced_at,source_type,source_subpath,revision_selector,enabled,config_revision
		 FROM project_repos WHERE project_id = $1 ORDER BY name`, p.ID)
	if err != nil {
		return err
	}
	defer repoRows.Close()
	for repoRows.Next() {
		var r types.RepoBinding
		var repoDBID int
		var synced *time.Time
		if err := repoRows.Scan(&repoDBID, &r.Name, &r.URL, &r.Branch, &r.Submodule, &r.LastSyncSHA, &synced, &r.Type, &r.Subpath, &r.RevisionSelector, &r.Enabled, &r.ConfigRevision); err != nil {
			return err
		}
		if synced != nil {
			r.SyncedAt = synced.Format(time.RFC3339)
		}
		r.Auth = "git_local"
		if r.Type == "svn" {
			r.Auth = "svn_cache"
		}
		// Load module mappings for this repo
		mapRows, err := s.pool.Query(ctx,
			`SELECT path_prefix, module_id FROM repo_module_mappings WHERE repo_id = $1 ORDER BY path_prefix`, repoDBID)
		if err != nil {
			return err
		}
		r.ModuleMapping = make(map[string]string)
		for mapRows.Next() {
			var prefix, modID string
			if err := mapRows.Scan(&prefix, &modID); err != nil {
				mapRows.Close()
				return err
			}
			r.ModuleMapping[prefix] = modID
		}
		mapRows.Close()
		p.Repos = append(p.Repos, r)
	}

	return repoRows.Err()
}

func (s *Store) loadProjectModules(ctx context.Context, p *types.ProjectConfig) error {
	// Load modules
	modRows, err := s.pool.Query(ctx,
		`SELECT module_id FROM project_modules WHERE project_id = $1 ORDER BY module_id`, p.ID)
	if err != nil {
		return err
	}
	defer modRows.Close()
	for modRows.Next() {
		var m string
		if err := modRows.Scan(&m); err != nil {
			return err
		}
		p.Modules = append(p.Modules, m)
	}

	return modRows.Err()
}

func (s *Store) loadProjectWikiNodes(ctx context.Context, p *types.ProjectConfig) error {
	// Load wiki node index (paths grouped by plane) so callers get an accurate
	// doc/code count without a second round-trip to /wiki-nodes.
	p.WikiNodes = types.ProjectWikiIndex{Doc: []string{}, Code: []string{}}
	wnRows, err := s.pool.Query(ctx,
		`SELECT plane, path FROM project_wiki_nodes WHERE project_id = $1 ORDER BY plane, path`, p.ID)
	if err != nil {
		return err
	}
	defer wnRows.Close()
	for wnRows.Next() {
		var plane, path string
		if err := wnRows.Scan(&plane, &path); err != nil {
			return err
		}
		switch plane {
		case "doc":
			p.WikiNodes.Doc = append(p.WikiNodes.Doc, path)
		case "code":
			p.WikiNodes.Code = append(p.WikiNodes.Code, path)
		}
	}

	return wnRows.Err()
}

func (s *Store) UpsertProject(ctx context.Context, p *types.ProjectConfig, directories ...[]map[string]string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	_, err = tx.Exec(ctx,
		`INSERT INTO projects (id, name, product, version)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (id) DO UPDATE SET name=$2, product=$3, version=$4`,
		p.ID, p.Name, p.Product, p.Version)
	if err != nil {
		return fmt.Errorf("upsert project: %w", err)
	}

	// Upsert modules
	_, _ = tx.Exec(ctx, `DELETE FROM project_modules WHERE project_id = $1`, p.ID)
	for _, m := range p.Modules {
		_, err = tx.Exec(ctx,
			`INSERT INTO project_modules (project_id, module_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
			p.ID, m)
		if err != nil {
			return fmt.Errorf("insert module %s: %w", m, err)
		}
	}

	// Upsert docs
	for _, d := range p.Docs {
		var ingested *time.Time
		if d.IngestedAt != "" {
			t, _ := time.Parse(time.RFC3339, d.IngestedAt)
			ingested = &t
		}
		_, err = tx.Exec(ctx,
			`INSERT INTO project_docs (project_id, doc_id, path, type, submodule, sha256, ingested_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7)
			 ON CONFLICT (project_id, doc_id) DO UPDATE SET
			   path=$3, type=$4, submodule=$5, sha256=$6, ingested_at=$7`,
			p.ID, d.DocID, d.Path, d.Type, d.Submodule, d.SHA256, ingested)
		if err != nil {
			return fmt.Errorf("upsert doc %s: %w", d.DocID, err)
		}
	}

	// Upsert repos
	for _, r := range p.Repos {
		if err = NormalizeCodeRepository(&r); err != nil {
			return err
		}
		var synced *time.Time
		if r.SyncedAt != "" {
			t, _ := time.Parse(time.RFC3339, r.SyncedAt)
			synced = &t
		}
		var repoID int
		err = tx.QueryRow(ctx,
			`INSERT INTO project_repos (project_id, name, url, branch, submodule, last_sync_sha, synced_at,source_type,source_subpath,revision_selector,enabled)
			 VALUES ($1, $2, $3, $4, $5, $6, $7,$8,$9,$10,$11)
			 ON CONFLICT (project_id, name) DO UPDATE SET
			   url=$3, branch=$4, submodule=$5,
               last_sync_sha=CASE WHEN project_repos.url<>$3 OR project_repos.source_subpath<>$9 OR project_repos.revision_selector<>$10 THEN NULL ELSE $6 END,
               synced_at=CASE WHEN project_repos.url<>$3 OR project_repos.source_subpath<>$9 OR project_repos.revision_selector<>$10 THEN NULL ELSE $7 END,
               source_subpath=$9,revision_selector=$10,enabled=$11,config_revision=project_repos.config_revision+1
             WHERE project_repos.source_type=$8
			 RETURNING id`,
			p.ID, r.Name, r.URL, r.Branch, r.Submodule, r.LastSyncSHA, synced, r.Type, r.Subpath, r.RevisionSelector, r.Enabled).Scan(&repoID)
		if err != nil {
			return fmt.Errorf("upsert repo %s: %w", r.Name, err)
		}
		// Replace module mappings
		_, _ = tx.Exec(ctx, `DELETE FROM repo_module_mappings WHERE repo_id = $1`, repoID)
		for prefix, modID := range r.ModuleMapping {
			_, err = tx.Exec(ctx,
				`INSERT INTO repo_module_mappings (repo_id, path_prefix, module_id) VALUES ($1, $2, $3)`,
				repoID, prefix, modID)
			if err != nil {
				return fmt.Errorf("insert mapping %s→%s: %w", prefix, modID, err)
			}
		}
	}

	for _, entries := range directories {
		if err := insertDocumentDirectories(ctx, tx, p.ID, entries); err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}

func (s *Store) DeleteProject(ctx context.Context, id string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM projects WHERE id = $1`, id)
	return err
}

// ─── Token Management ────────────────────────────────────────────────────────

// IssueToken creates a new project token and returns the plaintext token (shown once).
func (s *Store) IssueToken(ctx context.Context, projectID string, scopes []string, expiresAt *time.Time, createdBy string) (string, error) {
	// Generate random token
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("generate token: %w", err)
	}
	token := "cimwt_" + hex.EncodeToString(raw)
	hash := sha256.Sum256([]byte(token))
	tokenHash := hex.EncodeToString(hash[:])

	_, err := s.pool.Exec(ctx,
		`INSERT INTO project_tokens (project_id, token_hash, scopes, expires_at, created_by)
		 VALUES ($1, $2, $3, $4, $5)`,
		projectID, tokenHash, scopes, expiresAt, createdBy)
	if err != nil {
		return "", fmt.Errorf("store token: %w", err)
	}
	return token, nil
}

// ValidateToken checks a token and returns the project ID + scopes if valid.
func (s *Store) ValidateToken(ctx context.Context, token string) (string, []string, error) {
	hash := sha256.Sum256([]byte(token))
	tokenHash := hex.EncodeToString(hash[:])

	var projectID string
	var scopes []string
	var expiresAt *time.Time
	var revokedAt *time.Time
	err := s.pool.QueryRow(ctx,
		`SELECT project_id, scopes, expires_at, revoked_at FROM project_tokens WHERE token_hash = $1`,
		tokenHash).Scan(&projectID, &scopes, &expiresAt, &revokedAt)
	if err != nil {
		return "", nil, fmt.Errorf("token not found")
	}
	if revokedAt != nil {
		return "", nil, fmt.Errorf("token revoked")
	}
	if expiresAt != nil && time.Now().After(*expiresAt) {
		return "", nil, fmt.Errorf("token expired")
	}
	return projectID, scopes, nil
}

// RevokeToken marks a token as revoked.
func (s *Store) RevokeToken(ctx context.Context, tokenHash string) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE project_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
		tokenHash)
	return err
}

// ─── Sync Status ─────────────────────────────────────────────────────────────

func (s *Store) RecordSync(ctx context.Context, projectID, repoName, fromSHA, toSHA string,
	changedFiles int, affectedModules []string, status, errMsg string, durationMs int) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO sync_logs (project_id, repo_name, from_sha, to_sha, changed_files,
		 affected_modules, status, error_message, duration_ms)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		projectID, repoName, fromSHA, toSHA, changedFiles, affectedModules, status, errMsg, durationMs)
	if err != nil {
		return err
	}
	// Update repo last_sync_sha
	if toSHA != "" {
		_, _ = s.pool.Exec(ctx,
			`UPDATE project_repos SET last_sync_sha = $1, synced_at = now() WHERE project_id = $2 AND name = $3`,
			toSHA, projectID, repoName)
	}
	return nil
}

func (s *Store) GetSyncLogs(ctx context.Context, projectID string, limit int) ([]SyncLog, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, project_id, COALESCE(repo_name,''), COALESCE(from_sha,''), COALESCE(to_sha,''),
		 changed_files, affected_modules, status, COALESCE(error_message,''), COALESCE(duration_ms,0), synced_at
		 FROM sync_logs WHERE project_id = $1 ORDER BY synced_at DESC LIMIT $2`,
		projectID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []SyncLog
	for rows.Next() {
		var l SyncLog
		if err := rows.Scan(&l.ID, &l.ProjectID, &l.RepoName, &l.FromSHA, &l.ToSHA,
			&l.ChangedFiles, &l.AffectedModules, &l.Status, &l.ErrorMessage, &l.DurationMs, &l.SyncedAt); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

type SyncLog struct {
	ID              int       `json:"id"`
	ProjectID       string    `json:"project_id"`
	RepoName        string    `json:"repo_name"`
	FromSHA         string    `json:"from_sha"`
	ToSHA           string    `json:"to_sha"`
	ChangedFiles    int       `json:"changed_files"`
	AffectedModules []string  `json:"affected_modules"`
	Status          string    `json:"status"`
	ErrorMessage    string    `json:"error_message"`
	DurationMs      int       `json:"duration_ms"`
	SyncedAt        time.Time `json:"synced_at"`
}

// ─── Wiki Nodes Index ────────────────────────────────────────────────────────

func (s *Store) UpsertWikiNodes(ctx context.Context, projectID string, nodes []WikiNodeEntry) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	for _, n := range nodes {
		_, err = tx.Exec(ctx,
			`INSERT INTO project_wiki_nodes (project_id, plane, path, node_id, bundle_id)
			 VALUES ($1, $2, $3, $4, $5)
			 ON CONFLICT (project_id, path) DO UPDATE SET node_id=$4, bundle_id=$5`,
			projectID, n.Plane, n.Path, n.NodeID, n.BundleID)
		if err != nil {
			return fmt.Errorf("upsert wiki node %s: %w", n.Path, err)
		}
	}
	return tx.Commit(ctx)
}

type WikiNodeEntry struct {
	Plane    string `json:"plane"`
	Path     string `json:"path"`
	NodeID   string `json:"node_id"`
	BundleID string `json:"bundle_id"`
}

func (s *Store) GetWikiNodes(ctx context.Context, projectID string) ([]WikiNodeEntry, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT plane, path, COALESCE(node_id,''), COALESCE(bundle_id,'')
		 FROM project_wiki_nodes WHERE project_id = $1 ORDER BY plane, path`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []WikiNodeEntry
	for rows.Next() {
		var n WikiNodeEntry
		if err := rows.Scan(&n.Plane, &n.Path, &n.NodeID, &n.BundleID); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

func insertDocumentDirectories(ctx context.Context, tx pgx.Tx, project string, entries []map[string]string) error {
	for _, directory := range entries {
		payload, err := json.Marshal(map[string]string{"path": directory["path"], "display_name": directory["title"]})
		if err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `INSERT INTO dq_directories(project_id,payload,created_by) VALUES($1,$2,'system:document-template') ON CONFLICT DO NOTHING`, project, payload); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) EnsureDocumentDirectories(ctx context.Context, project string, entries []map[string]string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err = insertDocumentDirectories(ctx, tx, project, entries); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
