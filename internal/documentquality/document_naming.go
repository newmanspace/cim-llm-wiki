package documentquality

import (
	"fmt"
	"regexp"
	"strings"
)

var namingCode = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

func namingProblem(status int, code, message string, existing Record) error {
	return &Error{Status: status, Code: code, Message: message, Existing: existing}
}

// DocumentFilename never normalizes identifiers or assigns a sequence.
func DocumentFilename(project, docType, module, topic string, sequence int) (string, error) {
	for _, code := range []string{project, docType, module, topic} {
		if len(code) > 100 || !namingCode.MatchString(code) {
			return "", namingProblem(422, "DOCUMENT_IDENTITY_INVALID", "Canonical lowercase naming codes are required", nil)
		}
	}
	if sequence < 1 || sequence > 2147483647 {
		return "", namingProblem(422, "DOCUMENT_SEQUENCE_INVALID", "Document sequence is out of range", nil)
	}
	name := fmt.Sprintf("%s-%s-%s-%s-%03d.md", project, docType, module, topic, sequence)
	if len(name) > 255 {
		return "", namingProblem(422, "DOCUMENT_FILENAME_TOO_LONG", "Document filename exceeds 255 bytes", nil)
	}
	return name, nil
}

func namingFields(r Record, allowed ...string) error {
	set := map[string]bool{"project": true}
	for _, key := range allowed {
		set[key] = true
	}
	for key := range r {
		if !set[key] {
			return namingProblem(422, "DOCUMENT_NAMING_FIELD_UNKNOWN", "Unknown document naming field: "+key, nil)
		}
	}
	return nil
}

func saveNamingSettings(tx Tx, r Record) (Record, error) {
	if err := namingFields(r, "short_code", "expected_revision", "modules"); err != nil {
		return nil, err
	}
	code := Text(r, "short_code")
	if !namingCode.MatchString(code) || len(code) > 60 {
		return nil, namingProblem(422, "PROJECT_SHORT_CODE_INVALID", "Canonical project short code is required", nil)
	}
	if err := configureNamingModules(tx, r); err != nil {
		return nil, err
	}
	rows, err := tx.List("naming_settings")
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		if number(r, "expected_revision") != 0 {
			return nil, problem(409, "Naming settings revision changed")
		}
		return tx.Insert("naming_settings", Record{"short_code": code})
	}
	current := rows[0]
	if number(r, "expected_revision") != float64(revision(current)) {
		return nil, problem(409, "Naming settings revision changed")
	}
	if Text(current, "short_code") == code {
		if _, present := r["modules"]; present {
			return tx.Update("naming_settings", id(current), revision(current), Record{"short_code": code})
		}
		return current, nil
	}
	identities, err := tx.List("document_identities")
	if err != nil {
		return nil, err
	}
	if len(identities) > 0 {
		msg := "Project already has immutable document names; use an explicit migration"
		return nil, namingProblem(409, "DOCUMENT_RENAME_REQUIRES_MIGRATION", msg, nil)
	}
	return tx.Update("naming_settings", id(current), revision(current), Record{"short_code": code})
}

func configureNamingModules(tx Tx, r Record) error {
	raw, present := r["modules"]
	if !present {
		return nil
	}
	values, ok := raw.([]any)
	if !ok || len(values) == 0 {
		return namingProblem(422, "MODULES_INVALID", "Explicit module codes are required", nil)
	}
	modules := []string{}
	seen := map[string]bool{}
	for _, value := range values {
		code, ok := value.(string)
		if !ok || !namingCode.MatchString(code) || len(code) > 100 || seen[code] {
			return namingProblem(422, "MODULES_INVALID", "Canonical unique module codes are required", nil)
		}
		seen[code] = true
		modules = append(modules, code)
	}
	identities, err := tx.List("document_identities")
	if err != nil {
		return err
	}
	for _, identity := range identities {
		if !seen[Text(identity, "module")] {
			return problem(409, "Cannot remove modules with document identities")
		}
	}
	writer, ok := tx.(interface{ SetProjectModules([]string) error })
	if !ok {
		return problem(503, "Module registry is unavailable")
	}
	return writer.SetProjectModules(modules)
}

func validateNamingModule(tx Tx, module string) error {
	reader, ok := tx.(interface{ ProjectModules() ([]string, error) })
	if !ok {
		return problem(503, "Project module registry is unavailable")
	}
	modules, err := reader.ProjectModules()
	if err != nil {
		return err
	}
	for _, code := range modules {
		if code == module {
			return nil
		}
	}
	return namingProblem(422, "MODULE_UNKNOWN", "Module must be explicitly registered in the project", nil)
}

func validateDocumentReservation(tx Tx, r Record) error {
	fields := []string{"doc_type", "module", "topic", "short_code", "settings_revision", "policy_digest"}
	if err := namingFields(r, fields...); err != nil {
		return err
	}
	if len(Text(r, "policy_digest")) != 64 {
		return namingProblem(409, "NAMING_POLICY_UNBOUND", "An effective naming policy is required", nil)
	}
	shortCode := Text(r, "short_code")
	docType := Text(r, "doc_type")
	module := Text(r, "module")
	topic := Text(r, "topic")
	if _, err := DocumentFilename(shortCode, docType, module, topic, 1); err != nil {
		return err
	}
	settings, err := tx.List("naming_settings")
	if err != nil {
		return err
	}
	if len(settings) == 0 {
		return namingProblem(409, "PROJECT_SHORT_CODE_MISSING", "Project short code is not configured", nil)
	}
	sameShortCode := Text(settings[0], "short_code") == Text(r, "short_code")
	sameRevision := float64(revision(settings[0])) == number(r, "settings_revision")
	if !sameShortCode || !sameRevision {
		return problem(409, "Project naming settings changed; read context again")
	}
	if err := validateNamingModule(tx, Text(r, "module")); err != nil {
		return err
	}
	return nil
}

func rejectExistingDocument(tx Tx, r Record) error {
	rows, err := tx.List("document_identities")
	if err != nil {
		return err
	}
	for _, existing := range rows {
		matchType := Text(existing, "doc_type") == Text(r, "doc_type")
		matchModule := Text(existing, "module") == Text(r, "module")
		matchTopic := Text(existing, "topic") == Text(r, "topic")
		if matchType && matchModule && matchTopic {
			msg := "The document already exists; explicitly revise the existing identity"
			return namingProblem(409, "DOCUMENT_IDENTITY_EXISTS", msg, existing)
		}
	}
	return nil
}

func reserveDocumentIdentity(tx Tx, r Record) (Record, error) {
	if err := validateDocumentReservation(tx, r); err != nil {
		return nil, err
	}
	if err := rejectExistingDocument(tx, r); err != nil {
		return nil, err
	}
	sequence, err := nextDocumentSequence(tx, Text(r, "module"))
	if err != nil {
		return nil, err
	}
	filename, err := DocumentFilename(
		Text(r, "short_code"), Text(r, "doc_type"), Text(r, "module"), Text(r, "topic"), sequence,
	)
	if err != nil {
		return nil, err
	}
	value := copyRecord(r)
	delete(value, "settings_revision")
	value["sequence"] = sequence
	value["filename"] = filename
	value["node_id"] = strings.ToUpper(strings.TrimSuffix(filename, ".md"))
	value["status"] = "reserved"
	return tx.Insert("document_identities", value)
}

func nextDocumentSequence(tx Tx, module string) (int, error) {
	rows, err := tx.List("document_counters")
	if err != nil {
		return 0, err
	}
	for _, row := range rows {
		if Text(row, "module") != module {
			continue
		}
		next := int(number(row, "last_sequence")) + 1
		if next > 2147483647 {
			return 0, problem(409, "Document sequence exhausted")
		}
		_, err = tx.Update("document_counters", id(row), revision(row), Record{"module": module, "last_sequence": next})
		return next, err
	}
	_, err = tx.Insert("document_counters", Record{"module": module, "last_sequence": 1})
	return 1, err
}
