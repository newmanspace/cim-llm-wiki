package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"cim-llm-wiki/internal/documentquality"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var qualityTables = map[string]bool{
	"naming_settings":     true,
	"document_counters":   true,
	"document_identities": true,
	"directory_events":    true,
	"directories":         true,
	"ingest_sources":      true,
	"ingest_artifacts":    true,
	"data_sources":        true,
	"source_revisions":    true,
	"ingest_runs":         true,
	"source_versions":     true,
	"artifact_versions":   true,
	"document_states":     true,
	"quality_policies":    true,
	"evaluations":         true,
	"quality_issues":      true,
	"review_tasks":        true,
	"review_events":       true,
	"publications":        true,
	"command_receipts":    true,
}

type qualityTx struct {
	ctx            context.Context
	tx             pgx.Tx
	project, actor string
}

func (q *qualityTx) ProjectModules() ([]string, error) {
	query := "SELECT module_id FROM project_modules WHERE project_id=$1 ORDER BY module_id"
	rows, err := q.tx.Query(q.ctx, query, q.project)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	modules := []string{}
	for rows.Next() {
		var module string
		if err = rows.Scan(&module); err != nil {
			return nil, err
		}
		modules = append(modules, module)
	}
	return modules, rows.Err()
}

func (q *qualityTx) SetProjectModules(modules []string) error {
	if _, err := q.tx.Exec(q.ctx, "DELETE FROM project_modules WHERE project_id=$1", q.project); err != nil {
		return err
	}
	for _, module := range modules {
		query := "INSERT INTO project_modules(project_id,module_id) VALUES($1,$2)"
		if _, err := q.tx.Exec(q.ctx, query, q.project, module); err != nil {
			return err
		}
	}
	return nil
}

func qualityError(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return &documentquality.Error{Status: 404, Message: "Project or record not found"}
	}
	var pg *pgconn.PgError
	if errors.As(err, &pg) {
		if pg.Code == "23505" && strings.Contains(pg.ConstraintName, "dq_document_identities") {
			return &documentquality.Error{
				Status:  409,
				Code:    "DOCUMENT_NAME_CONFLICT",
				Message: "Document business key, module sequence or filename is already reserved",
			}
		}
		switch pg.Code {
		case "23505", "40001", "40P01":
			return &documentquality.Error{Status: 409, Message: "Concurrent change or duplicate document record"}
		case "23503", "23514", "22P02":
			return &documentquality.Error{Status: 422, Message: "Document record violates a data constraint"}
		default:
			return err
		}
	}
	return err
}

// WithProject locks the project row before running a ledger command, serializing
// mutations for that project. The command and its receipt commit together; errors
// roll back database changes, but cannot roll back external side effects.
func (s *Store) WithProject(ctx context.Context, project, actor string, fn func(documentquality.Tx) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var key string
	if err = tx.QueryRow(ctx, "SELECT id FROM projects WHERE id=$1 FOR UPDATE", project).Scan(&key); err != nil {
		return qualityError(err)
	}
	if err = fn(&qualityTx{ctx, tx, project, actor}); err != nil {
		return qualityError(err)
	}
	return qualityError(tx.Commit(ctx))
}

func (q *qualityTx) table(kind string) (string, error) {
	if !qualityTables[kind] {
		return "", &documentquality.Error{Status: 404, Message: "Unknown document resource"}
	}
	return "dq_" + kind, nil
}

const qualityJSON = "payload || jsonb_build_object(" +
	"'id',sys_id::text,'project',project_id,'revision',revision," +
	"'created_by',created_by,'created_at',created_at,'updated_at',updated_at)"

func (q *qualityTx) Get(kind, id string) (documentquality.Record, error) {
	table, e := q.table(kind)
	if e != nil {
		return nil, e
	}
	var b []byte
	query := "SELECT " + qualityJSON + " FROM " + table + " WHERE project_id=$1 AND sys_id::text=$2"
	e = q.tx.QueryRow(q.ctx, query, q.project, id).Scan(&b)
	if e != nil {
		return nil, qualityError(e)
	}
	var r documentquality.Record
	e = json.Unmarshal(b, &r)
	return r, e
}

func (q *qualityTx) List(kind string) ([]documentquality.Record, error) {
	table, e := q.table(kind)
	if e != nil {
		return nil, e
	}
	query := "SELECT " + qualityJSON + " FROM " + table + " WHERE project_id=$1 ORDER BY created_at,sys_id LIMIT 10001"
	rows, e := q.tx.Query(q.ctx, query, q.project)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []documentquality.Record{}
	for rows.Next() {
		var b []byte
		if e = rows.Scan(&b); e != nil {
			return nil, e
		}
		var r documentquality.Record
		if e = json.Unmarshal(b, &r); e != nil {
			return nil, e
		}
		out = append(out, r)
	}
	if len(out) > 10000 {
		return nil, &documentquality.Error{
			Status:  409,
			Message: "Project ledger exceeds the bounded query limit; archive or partition before continuing",
		}
	}
	return out, rows.Err()
}

func payload(r documentquality.Record) ([]byte, error) {
	out := map[string]any{}
	for k, v := range r {
		switch k {
		case "id", "project", "revision", "created_by", "created_at":
			continue
		default:
			out[k] = v
		}
	}
	return json.Marshal(out)
}

func (q *qualityTx) Insert(kind string, r documentquality.Record) (documentquality.Record, error) {
	table, e := q.table(kind)
	if e != nil {
		return nil, e
	}
	b, e := payload(r)
	if e != nil {
		return nil, e
	}
	var id string
	query := "INSERT INTO " + table + " (project_id,payload,created_by) VALUES($1,$2,$3) RETURNING sys_id::text"
	e = q.tx.QueryRow(q.ctx, query, q.project, b, q.actor).Scan(&id)
	if e != nil {
		return nil, qualityError(e)
	}
	return q.Get(kind, id)
}

var updatableTables = map[string]bool{
	"document_counters": true,
	"naming_settings":   true,
	"directories":       true,
	"data_sources":      true,
	"ingest_runs":       true,
	"review_tasks":      true,
	"publications":      true,
}

// Update allows mutable ledger resources only and uses the expected revision to
// reject stale writes. Historical artifacts, assessments and events stay append-only.
func (q *qualityTx) Update(kind, id string, revision int, r documentquality.Record) (documentquality.Record, error) {
	if !updatableTables[kind] {
		return nil, fmt.Errorf("history cannot be updated")
	}
	table, _ := q.table(kind)
	b, e := payload(r)
	if e != nil {
		return nil, e
	}
	query := "UPDATE " + table + " SET payload=$1,revision=revision+1,updated_at=now() " +
		"WHERE project_id=$2 AND sys_id::text=$3 AND revision=$4"
	tag, e := q.tx.Exec(q.ctx, query, b, q.project, id, revision)
	if e != nil {
		return nil, qualityError(e)
	}
	if tag.RowsAffected() != 1 {
		return nil, &documentquality.Error{Status: 409, Message: "Document record revision changed"}
	}
	return q.Get(kind, id)
}
