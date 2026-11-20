package documentquality

// Document workflow uses the result ledger directly, independently of Wiki bundles.
func saveDocument(tx Tx, r Record, state string) (Record, error) {
	if Text(r, "artifact_id") != "" {
		return nil, problem(422, "Submit the complete candidate and local report as a new version")
	}
	r = copyRecord(r)
	r["workflow_version"] = "1.0"
	r["workflow_state"] = state
	if state == "draft" && Text(r, "logical_key") == "" {
		r["logical_key"] = "draft:" + Text(r, "target_path")
	}
	if state == "submitted" {
		if err := documentIdentity(tx, r); err != nil {
			return nil, err
		}
	}
	return saveArtifact(tx, r)
}

func documentIdentity(tx Tx, r Record) error {
	settings, err := tx.List("naming_settings")
	if err != nil {
		return err
	}
	if len(settings) == 0 && Text(r, "document_id") == "" {
		return nil
	}
	identity, err := tx.Get("document_identities", Text(r, "document_id"))
	if err != nil {
		return err
	}
	if Text(r, "logical_key") != id(identity) {
		return problem(422, "logical_key must be the document identity")
	}
	return nil
}

// freezeDocument appends a frozen state for the latest submitted version only
// when its revision, content hash and attachment package hash still match.
// The artifact bytes remain immutable; lifecycle changes are separate events.
func freezeDocument(tx Tx, r Record) (Record, error) {
	artifact, err := documentArtifact(tx, Text(r, "artifact_id"))
	if err != nil {
		return nil, err
	}
	if Text(artifact, "workflow_state") != "submitted" || revision(artifact) != int(number(r, "expected_revision")) {
		return nil, problem(409, "Freeze requires the current submitted version")
	}
	sameContent := Text(artifact, "content_sha256") == Text(r, "content_sha256")
	samePackage := Text(artifact, "package_sha256") == Text(r, "package_sha256")
	if !sameContent || !samePackage {
		return nil, problem(409, "Document hash changed")
	}
	if err := ensureLatestArtifact(tx, artifact, "Document version is superseded"); err != nil {
		return nil, err
	}
	stateRecord := Record{
		"artifact_id":     id(artifact),
		"artifact_digest": documentDigest(artifact),
		"state":           "frozen",
		"state_revision":  revision(artifact) + 1,
	}
	if _, err = tx.Insert("document_states", stateRecord); err != nil {
		return nil, err
	}
	return documentArtifact(tx, id(artifact))
}

// requestDocumentReview requires the latest frozen snapshot and reuses a pending
// task only if its policy digest is still current. Otherwise older pending tasks
// are superseded before a new manual review is requested.
func requestDocumentReview(tx Tx, r Record) (Record, error) {
	artifact, err := documentArtifact(tx, Text(r, "artifact_id"))
	if err != nil {
		return nil, err
	}
	if Text(artifact, "workflow_state") != "frozen" {
		return nil, problem(409, "Freeze the submitted document before requesting review")
	}
	if err := ensureLatestArtifact(tx, artifact, "Document version is superseded"); err != nil {
		return nil, err
	}
	policy, err := effective(tx, folder(Text(artifact, "target_path")))
	if err != nil {
		return nil, err
	}
	tasks, err := tx.List("review_tasks")
	if err != nil {
		return nil, err
	}
	for _, task := range tasks {
		matchArtifact := Text(task, "artifact_id") == id(artifact)
		matchScope := Text(task, "scope") == "document"
		matchPending := Text(task, "status") == "pending"
		matchPolicy := Text(task, "policy_digest") == policy.Digest
		if matchArtifact && matchScope && matchPending && matchPolicy {
			return task, nil
		}
	}
	if err = supersedePending(tx, id(artifact)); err != nil {
		return nil, err
	}
	taskRecord := Record{
		"scope":           "document",
		"artifact_id":     id(artifact),
		"artifact_digest": documentDigest(artifact),
		"policy_digest":   policy.Digest,
		"status":          "pending",
		"approval_mode":   "manual",
	}
	return tx.Insert("review_tasks", taskRecord)
}

// decideDocument applies a review decision to the exact frozen document digest.
// It records the authenticated actor and updates the task without altering content.
func decideDocument(tx Tx, actor string, r, task, artifact Record) (Record, error) {
	if Text(artifact, "workflow_state") != "frozen" || Text(task, "artifact_digest") != documentDigest(artifact) {
		return nil, problem(409, "Review requires the frozen document snapshot")
	}
	decisionMap := map[string]string{
		"approve":           "approved",
		"reject":            "rejected",
		"changes_requested": "changes_requested",
	}
	status := decisionMap[Text(r, "decision")]
	if status == "" {
		return nil, problem(422, "Invalid review decision")
	}
	next := copyRecord(task)
	next["status"] = status
	eventPayload := Record{
		"task_id":         id(task),
		"decision":        r["decision"],
		"note":            r["note"],
		"actor_id":        actor,
		"artifact_digest": documentDigest(artifact),
		"from_status":     "pending",
		"to_status":       status,
	}
	event, err := tx.Insert("review_events", eventPayload)
	if err != nil {
		return nil, err
	}
	if _, err = tx.Update("review_tasks", id(task), revision(task), next); err != nil {
		return nil, err
	}
	return event, nil
}

// Content versions never change. Read the lifecycle projection from immutable events.
func documentArtifact(tx Tx, artifactID string) (Record, error) {
	artifact, err := tx.Get("artifact_versions", artifactID)
	if err != nil {
		return nil, err
	}
	if Text(artifact, "workflow_version") == "" {
		return artifact, nil
	}
	states, err := tx.List("document_states")
	if err != nil {
		return nil, err
	}
	return projectDocumentState(artifact, states), nil
}

// projectDocumentState overlays the highest recorded lifecycle revision on a copy
// of the immutable artifact, leaving the stored content version unchanged.
func projectDocumentState(artifact Record, states []Record) Record {
	result := copyRecord(artifact)
	for _, state := range states {
		if Text(state, "artifact_id") == id(artifact) && number(state, "state_revision") >= number(result, "revision") {
			result["workflow_state"] = state["state"]
			result["revision"] = state["state_revision"]
		}
	}
	return result
}

func initializeDocumentState(tx Tx, artifact, input Record) (Record, error) {
	if Text(input, "workflow_version") == "" {
		return artifact, nil
	}
	stateRecord := Record{
		"artifact_id":     id(artifact),
		"artifact_digest": documentDigest(artifact),
		"state":           input["workflow_state"],
		"state_revision":  1,
	}
	_, err := tx.Insert("document_states", stateRecord)
	return artifact, err
}

func sameHashes(old, input Record) bool {
	return Text(old, "parsed_source_id") == Text(input, "parsed_source_id") &&
		Text(old, "package_sha256") == Text(input, "package_sha256") &&
		Text(old, "parsed_package_sha256") == Text(input, "parsed_package_sha256") &&
		Text(old, "parsed_sha256") == Text(input, "parsed_sha256")
}

func sameReports(old, input Record) bool {
	return Digest(old["local_report"]) == Digest(input["local_report"]) &&
		Digest(old["qscore"]) == Digest(input["qscore"])
}

func sameDocumentEvidence(old, input Record) bool {
	if Text(input, "workflow_version") == "" {
		return true
	}
	return sameHashes(old, input) && sameReports(old, input)
}

// Attachment changes must change the frozen and reviewed version as well.
func documentDigest(artifact Record) string {
	if value := Text(artifact, "package_sha256"); value != "" {
		return value
	}
	return Text(artifact, "content_sha256")
}
