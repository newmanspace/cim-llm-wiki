package documentquality

import (
	"encoding/json"
	"fmt"
)

func supersedePending(tx Tx, artifactID string) error {
	tasks, e := tx.List("review_tasks")
	if e != nil {
		return e
	}
	for _, task := range tasks {
		if Text(task, "artifact_id") != artifactID || Text(task, "status") != "pending" {
			continue
		}
		next := copyRecord(task)
		next["status"] = "superseded"
		event := Record{
			"task_id":     id(task),
			"decision":    "supersede",
			"note":        "A newer document revision or assessment supersedes this pending task",
			"actor_id":    "system",
			"from_status": "pending",
			"to_status":   "superseded",
		}
		if _, e = tx.Insert("review_events", event); e != nil {
			return e
		}
		if _, e = tx.Update("review_tasks", id(task), revision(task), next); e != nil {
			return e
		}
	}
	return nil
}

func saveEvaluation(tx Tx, r Record) (Record, error) {
	artifact, e := documentArtifact(tx, Text(r, "artifact_id"))
	if e != nil {
		return nil, e
	}
	if Text(artifact, "content_sha256") != Text(r, "artifact_sha256") {
		return nil, problem(409, "Artifact hash changed")
	}
	p, e := effective(tx, folder(Text(artifact, "target_path")))
	if e != nil {
		return nil, e
	}
	if p.Digest != Text(r, "policy_digest") {
		return nil, problem(409, "Quality policy changed")
	}
	var dims map[string]Dimension
	var issues []Issue
	b, _ := json.Marshal(r["dimensions"])
	if e = json.Unmarshal(b, &dims); e != nil {
		return nil, problem(422, "Invalid dimension scores")
	}
	b, _ = json.Marshal(r["issues"])
	if e = json.Unmarshal(b, &issues); e != nil {
		return nil, problem(422, "Invalid issues")
	}
	assessment, e := Assess(p, dims, issues)
	if e != nil {
		return nil, e
	}
	if Text(r, "evaluator_version") == "" {
		return nil, problem(422, "Evaluator version is required")
	}
	evalRecord := Record{
		"artifact_id":       id(artifact),
		"artifact_sha256":   artifact["content_sha256"],
		"policy_snapshot":   p,
		"policy_digest":     p.Digest,
		"dimensions":        dims,
		"total":             assessment.Total,
		"needs_review":      assessment.NeedsReview,
		"blocking":          assessment.Blocking,
		"evaluator_version": r["evaluator_version"],
	}
	eval, e := tx.Insert("evaluations", evalRecord)
	if e != nil {
		return nil, e
	}
	for _, i := range issues {
		raw, _ := json.Marshal(i)
		var v Record
		_ = json.Unmarshal(raw, &v)
		v["evaluation_id"] = id(eval)
		if _, e = tx.Insert("quality_issues", v); e != nil {
			return nil, e
		}
	}
	if e = supersedePending(tx, id(artifact)); e != nil {
		return nil, e
	}
	task, e := createEvaluationReview(tx, artifact, eval, p, assessment)
	if e != nil {
		return nil, e
	}
	eval["review_task_id"] = id(task)
	return eval, nil
}

func createEvaluationReview(
	tx Tx, artifact, evaluation Record, policy Effective, assessment Assessment,
) (Record, error) {
	status, mode := "pending", "manual"
	if !assessment.NeedsReview {
		status, mode = "approved", "auto"
	}
	taskRecord := Record{
		"artifact_id":     id(artifact),
		"evaluation_id":   id(evaluation),
		"artifact_digest": artifact["content_sha256"],
		"policy_digest":   policy.Digest,
		"status":          status,
		"approval_mode":   mode,
	}
	task, err := tx.Insert("review_tasks", taskRecord)
	if err != nil || mode != "auto" {
		return task, err
	}
	note := fmt.Sprintf(
		"Automatically approved: score %.4f >= threshold %.4f, no blocking issues or mandatory human review",
		*assessment.Total, policy.Threshold,
	)
	eventRecord := Record{
		"task_id":          id(task),
		"decision":         "approve",
		"actor_id":         "system:quality-policy",
		"from_status":      "",
		"to_status":        "approved",
		"approval_mode":    "auto",
		"evaluation_id":    id(evaluation),
		"artifact_digest":  artifact["content_sha256"],
		"policy_digest":    policy.Digest,
		"total":            assessment.Total,
		"review_threshold": policy.Threshold,
		"note":             note,
	}
	_, err = tx.Insert("review_events", eventRecord)
	return task, err
}

func saveDecision(tx Tx, actor string, r Record) (Record, error) {
	if e := required(r, "task_id", "note", "decision"); e != nil {
		return nil, e
	}
	task, e := tx.Get("review_tasks", Text(r, "task_id"))
	if e != nil {
		return nil, e
	}
	if !currentReviewTask(task, r) {
		return nil, problem(409, "Review task is no longer current")
	}
	artifact, e := documentArtifact(tx, Text(task, "artifact_id"))
	if e != nil {
		return nil, e
	}
	p, e := effective(tx, folder(Text(artifact, "target_path")))
	if e != nil {
		return nil, e
	}
	if p.Digest != Text(task, "policy_digest") {
		return nil, problem(409, "Quality policy changed; reassessment is required")
	}
	if e := ensureLatestArtifact(tx, artifact, "Artifact version is superseded"); e != nil {
		return nil, e
	}
	if Text(task, "scope") == "document" {
		return decideDocument(tx, actor, r, task, artifact)
	}
	evaluation, e := tx.Get("evaluations", Text(task, "evaluation_id"))
	if e != nil {
		return nil, e
	}
	decision := Text(r, "decision")
	states := map[string]string{
		"approve":           "approved",
		"reject":            "rejected",
		"changes_requested": "changes_requested",
	}
	status, ok := states[decision]
	if !ok {
		return nil, problem(422, "Invalid review decision")
	}
	if decision == "approve" && evaluation["blocking"] == true {
		return nil, problem(409, "Blocking issues must be corrected and reassessed")
	}
	next := copyRecord(task)
	next["status"] = status
	event := Record{
		"task_id":     id(task),
		"decision":    decision,
		"note":        r["note"],
		"actor_id":    actor,
		"from_status": "pending",
		"to_status":   status,
	}
	eventRecord, e := tx.Insert("review_events", event)
	if e != nil {
		return nil, e
	}
	if _, e = tx.Update("review_tasks", id(task), revision(task), next); e != nil {
		return nil, e
	}
	return eventRecord, nil
}

func currentReviewTask(task, request Record) bool {
	return Text(task, "status") == "pending" && revision(task) == int(number(request, "expected_revision"))
}
