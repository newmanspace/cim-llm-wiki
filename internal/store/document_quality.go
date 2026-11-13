package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"cim-llm-wiki/internal/documentquality"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var qualityTables = map[string]bool{"directory_events": true, "directories": true, "ingest_sources": true, "ingest_artifacts": true, "data_sources": true, "source_revisions": true, "ingest_runs": true, "source_versions": true, "artifact_versions": true, "quality_policies": true, "evaluations": true, "quality_issues": true, "review_tasks": true, "review_events": true, "publications": true, "command_receipts": true}

type qualityTx struct {
	ctx            context.Context
	tx             pgx.Tx
	project, actor string
}

func qualityError(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return &documentquality.Error{Status: 404, Message: "Project or record not found"}
	}
	var pg *pgconn.PgError
	if errors.As(err, &pg) {
		switch pg.Code {
		case "23505", "40001", "40P01":
			return &documentquality.Error{Status: 409, Message: "Concurrent change or duplicate document record"}
		case "23503", "23514", "22P02":
			return &documentquality.Error{Status: 422, Message: "Document record violates a data constraint"}
		}
	}
	return err
}
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

const qualityJSON = "payload || jsonb_build_object('id',sys_id::text,'project',project_id,'revision',revision,'created_by',created_by,'created_at',created_at,'updated_at',updated_at)"

func (q *qualityTx) Get(kind, id string) (documentquality.Record, error) {
	table, e := q.table(kind)
	if e != nil {
		return nil, e
	}
	var b []byte
	e = q.tx.QueryRow(q.ctx, "SELECT "+qualityJSON+" FROM "+table+" WHERE project_id=$1 AND sys_id::text=$2", q.project, id).Scan(&b)
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
	rows, e := q.tx.Query(q.ctx, "SELECT "+qualityJSON+" FROM "+table+" WHERE project_id=$1 ORDER BY created_at,sys_id LIMIT 10001", q.project)
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
		return nil, &documentquality.Error{Status: 409, Message: "Project ledger exceeds the bounded query limit; archive or partition before continuing"}
	}
	return out, rows.Err()
}
func payload(r documentquality.Record) ([]byte, error) {
	copy := map[string]any{}
	for k, v := range r {
		switch k {
		case "id", "project", "revision", "created_by", "created_at":
			continue
		}
		copy[k] = v
	}
	return json.Marshal(copy)
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
	e = q.tx.QueryRow(q.ctx, "INSERT INTO "+table+" (project_id,payload,created_by) VALUES($1,$2,$3) RETURNING sys_id::text", q.project, b, q.actor).Scan(&id)
	if e != nil {
		return nil, qualityError(e)
	}
	return q.Get(kind, id)
}
func (q *qualityTx) Update(kind, id string, revision int, r documentquality.Record) (documentquality.Record, error) {
	if kind != "directories" && kind != "data_sources" && kind != "ingest_runs" && kind != "review_tasks" && kind != "publications" {
		return nil, fmt.Errorf("history cannot be updated")
	}
	table, _ := q.table(kind)
	b, e := payload(r)
	if e != nil {
		return nil, e
	}
	tag, e := q.tx.Exec(q.ctx, "UPDATE "+table+" SET payload=$1,revision=revision+1,updated_at=now() WHERE project_id=$2 AND sys_id::text=$3 AND revision=$4", b, q.project, id, revision)
	if e != nil {
		return nil, qualityError(e)
	}
	if tag.RowsAffected() != 1 {
		return nil, &documentquality.Error{Status: 409, Message: "Document record revision changed"}
	}
	return q.Get(kind, id)
}
