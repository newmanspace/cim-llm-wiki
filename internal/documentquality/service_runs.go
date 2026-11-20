package documentquality

import (
	"strconv"
)

// beginPublication validates the latest artifact, assessment and review before
// reserving publication. It only records ledger state; external build and file
// operations run separately and must report their outcome through finishPublication.
func beginPublication(tx Tx, r Record) (Record, error) {
	artifact, e := documentArtifact(tx, Text(r, "artifact_id"))
	if e != nil {
		return nil, e
	}
	eval, e := tx.Get("evaluations", Text(r, "evaluation_id"))
	if e != nil {
		return nil, e
	}
	if Text(eval, "artifact_id") != id(artifact) {
		return nil, problem(409, "Evaluation does not match artifact")
	}
	p, e := effective(tx, folder(Text(artifact, "target_path")))
	if e != nil {
		return nil, e
	}
	if Text(eval, "policy_digest") != p.Digest || eval["blocking"] == true {
		return nil, problem(409, "Quality eligibility is stale or blocked")
	}
	if e := ensureLatestArtifact(tx, artifact, "Artifact version has been superseded"); e != nil {
		return nil, e
	}
	if e := verifyPublicationApproval(tx, artifact, eval, p); e != nil {
		return nil, e
	}
	pubs, e := tx.List("publications")
	if e != nil {
		return nil, e
	}
	for _, pub := range pubs {
		if Text(pub, "artifact_id") == id(artifact) &&
			Text(pub, "evaluation_id") == id(eval) &&
			Text(pub, "status") == "publishing" {
			return pub, nil
		}
	}
	return tx.Insert("publications", Record{
		"artifact_id":   id(artifact),
		"evaluation_id": id(eval),
		"digest":        artifact["content_sha256"],
		"target_path":   artifact["target_path"],
		"policy_digest": p.Digest,
		"status":        "publishing",
	})
}

// finishPublication records the outcome of an active publication reservation.
// It does not undo external file writes or rebuild previously published output.
func finishPublication(tx Tx, r Record) (Record, error) {
	pub, e := tx.Get("publications", Text(r, "id"))
	if e != nil {
		return nil, e
	}
	if Text(pub, "status") != "publishing" {
		return nil, problem(409, "Publication is not active")
	}
	status := Text(r, "status")
	if status != "published" && status != "failed" {
		return nil, problem(422, "Invalid publication status")
	}
	next := copyRecord(pub)
	next["status"] = status
	return tx.Update("publications", id(pub), revision(pub), next)
}

// saveRun dispatches run creation, collection failures and terminal updates.
// A new repository-backed run must use the current enabled source configuration
// and pin its Git commit or SVN revision before accepting observations.
func saveRun(tx Tx, r Record) (Record, error) {
	if Text(r, "source_type") == "local_file" && Text(r, "id") == "" {
		return saveLocalFileRun(tx, r)
	}
	if Text(r, "id") != "" {
		return finishRun(tx, r)
	}
	if failedCollection(r) {
		return saveCollectionFailure(tx, r)
	}
	if e := required(r, "source_id", "source_config_id", "recipe_version"); e != nil {
		return nil, e
	}
	source, e := tx.Get("data_sources", Text(r, "source_id"))
	if e != nil {
		return nil, e
	}
	cfg, e := tx.Get("source_revisions", Text(r, "source_config_id"))
	if e != nil {
		return nil, e
	}
	if source["enabled"] != true || Text(cfg, "source_id") != id(source) || Text(source, "config_id") != id(cfg) {
		return nil, problem(409, "Data source configuration is disabled or stale")
	}
	out := Record{
		"source_id":        id(source),
		"source_config_id": id(cfg),
		"source_type":      Text(source, "type"),
		"recipe_version":   r["recipe_version"],
		"status":           "running",
	}
	if e := pinCollectionRevision(out, source, cfg, r); e != nil {
		return nil, e
	}
	return tx.Insert("ingest_runs", out)
}

func linkRun(tx Tx, kind, field string, run, record Record) error {
	links, e := tx.List(kind)
	if e != nil {
		return e
	}
	for _, link := range links {
		if Text(link, "run_id") == id(run) && Text(link, field) == id(record) {
			return nil
		}
	}
	_, e = tx.Insert(kind, Record{"run_id": id(run), field: id(record)})
	return e
}

// saveObservation links source evidence to an active run. Re-observing the same
// repository version reuses its record, but conflicting content hashes are rejected.
func saveObservation(tx Tx, r Record) (Record, error) {
	if e := required(r, "run_id", "repository_path", "original_uri", "original_sha256"); e != nil {
		return nil, e
	}
	run, e := tx.Get("ingest_runs", Text(r, "run_id"))
	if e != nil {
		return nil, e
	}
	if e := validateObservationEvidence(run, r); e != nil {
		return nil, e
	}
	if Text(run, "status") != "running" {
		return nil, problem(409, "Run is not active")
	}
	if len(Text(r, "original_sha256")) != 64 {
		return nil, problem(422, "Invalid source hash")
	}
	rows, e := tx.List("source_versions")
	if e != nil {
		return nil, e
	}
	for _, old := range rows {
		if sameSourceVersion(old, run, r) {
			if Text(old, "original_sha256") != Text(r, "original_sha256") {
				return nil, problem(409, "Same repository source version has different content")
			}
			if e := linkRun(tx, "ingest_sources", "source_version_id", run, old); e != nil {
				return nil, e
			}
			return old, nil
		}
	}
	outPayload := sourceObservationPayload(run, r)
	out, e := tx.Insert("source_versions", outPayload)
	if e != nil {
		return nil, e
	}
	if e = linkRun(tx, "ingest_sources", "source_version_id", run, out); e != nil {
		return nil, e
	}
	return out, nil
}

// saveLocalFileRun accepts local ingestion only when no project data sources are
// configured; it cannot bypass the evidence required for a bound Git or SVN source.
func saveLocalFileRun(tx Tx, r Record) (Record, error) {
	if err := required(r, "recipe_version"); err != nil {
		return nil, err
	}
	sources, err := tx.List("data_sources")
	if err != nil {
		return nil, err
	}
	if len(sources) != 0 {
		return nil, problem(409, "Configured project sources require Git/SVN evidence")
	}
	return tx.Insert("ingest_runs", Record{
		"source_type":    "local_file",
		"recipe_version": r["recipe_version"],
		"status":         "running",
	})
}

// finishRun permits a single transition from running to a terminal status.
// Repeated completion is handled by the command receipt, not by rewriting the run.
func finishRun(tx Tx, r Record) (Record, error) {
	old, e := tx.Get("ingest_runs", Text(r, "id"))
	if e != nil {
		return nil, e
	}
	status := Text(r, "status")
	if status != "completed" && status != "partial" && status != "failed" && status != "cancelled" {
		return nil, problem(422, "Invalid terminal run status")
	}
	if Text(old, "status") != "running" {
		return nil, problem(409, "Run is already finished")
	}
	next := copyRecord(old)
	next["status"] = status
	next["error_code"] = r["error_code"]
	return tx.Update("ingest_runs", id(old), revision(old), next)
}

func failedCollection(r Record) bool {
	return Text(r, "status") == "failed" &&
		Text(r, "error_code") != "" &&
		Text(r, "operative_revision") == "" &&
		Text(r, "commit_sha") == ""
}

func saveCollectionFailure(tx Tx, r Record) (Record, error) {
	source, e := tx.Get("data_sources", Text(r, "source_id"))
	if e != nil {
		return nil, e
	}
	cfg, e := tx.Get("source_revisions", Text(r, "source_config_id"))
	if e != nil {
		return nil, e
	}
	if Text(cfg, "source_id") != id(source) {
		return nil, problem(409, "Source configuration does not match")
	}
	return tx.Insert("ingest_runs", Record{
		"source_id":        id(source),
		"source_config_id": id(cfg),
		"recipe_version":   r["recipe_version"],
		"status":           "failed",
		"error_code":       r["error_code"],
		"source_type":      Text(source, "type"),
		"failure_phase":    Text(source, "type") + "_collection",
	})
}

func pinCollectionRevision(out, source, cfg, r Record) error {
	if Text(source, "type") == "git" {
		if !gitCommit.MatchString(Text(r, "commit_sha")) {
			return problem(422, "Git collection requires a full pinned commit SHA")
		}
		remote, e := normalizeGitURL(Text(r, "repository_url"))
		if e != nil {
			return e
		}
		if remote != Text(cfg, "url") {
			return problem(409, "Git repository does not match the bound source configuration")
		}
		out["repository_url"] = remote
		out["commit_sha"] = r["commit_sha"]
	} else {
		if e := required(r, "operative_revision", "repository_uuid"); e != nil {
			return e
		}
		if _, e := strconv.ParseUint(Text(r, "operative_revision"), 10, 64); e != nil {
			return problem(422, "SVN revision must be fixed")
		}
		out["operative_revision"] = r["operative_revision"]
		out["repository_uuid"] = r["repository_uuid"]
	}
	return nil
}

func validateObservationEvidence(run, r Record) error {
	if sourceType(run) == "local_file" {
		return nil
	}
	if sourceType(run) == "git" {
		if e := required(r, "git_info_uri", "git_blob_oid"); e != nil {
			return e
		}
		if !gitCommit.MatchString(Text(r, "git_blob_oid")) {
			return problem(422, "A full Git blob object ID is required")
		}
	} else {
		if e := required(r, "svn_info_uri"); e != nil {
			return e
		}
	}
	return nil
}

func sameSourceVersion(old, run, r Record) bool {
	if sourceType(run) == "local_file" {
		return Text(old, "run_id") == id(run) &&
			Text(old, "repository_path") == Text(r, "repository_path")
	}
	return Text(old, "source_id") == Text(run, "source_id") &&
		repositoryIdentity(old) == repositoryIdentity(run) &&
		Text(old, "repository_path") == Text(r, "repository_path") &&
		sourceRevision(old) == sourceRevision(run)
}

func sourceBelongsToRun(source, run Record) bool {
	if sourceType(run) == "local_file" {
		return sourceType(source) == "local_file" && Text(source, "run_id") == id(run)
	}
	return Text(source, "source_id") == Text(run, "source_id") &&
		sourceRevision(source) == sourceRevision(run)
}

func sourceObservationPayload(run, r Record) Record {
	outPayload := Record{
		"run_id":            id(run),
		"source_id":         run["source_id"],
		"source_type":       sourceType(run),
		"repository_path":   r["repository_path"],
		"original_uri":      r["original_uri"],
		"original_sha256":   r["original_sha256"],
		"snapshot_path":     r["snapshot_path"],
		"provenance_method": "skill_observed",
	}
	if sourceType(run) == "git" {
		for _, field := range []string{"git_info_uri", "git_info_sha256", "git_blob_oid"} {
			outPayload[field] = r[field]
		}
		outPayload["repository_url"] = run["repository_url"]
		outPayload["commit_sha"] = run["commit_sha"]
	} else if sourceType(run) == "svn" {
		outPayload["svn_info_uri"] = r["svn_info_uri"]
		outPayload["repository_uuid"] = run["repository_uuid"]
		outPayload["operative_revision"] = run["operative_revision"]
	} else {
		// Non-vcs local runs
	}
	return outPayload
}
