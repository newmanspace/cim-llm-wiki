// Package documentquality defines directory quality policies and evidence-based scoring.
package documentquality

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strings"
)

var Dimensions = []string{
	"fidelity", "completeness", "traceability",
	"consistency", "structure", "usability", "validity",
}

var segment = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]*$`)

type Policy struct {
	Path     string         `json:"path"`
	Revision int            `json:"revision"`
	Patch    map[string]any `json:"patch"`
}

type Effective struct {
	Threshold    float64                   `json:"review_threshold"`
	Dimensions   map[string]map[string]any `json:"dimensions"`
	RequireHuman bool                      `json:"require_human"`
	Origins      map[string]string         `json:"origins"`
	Digest       string                    `json:"digest"`
}

type Dimension struct {
	Score    *float64 `json:"score"`
	Evidence []any    `json:"evidence"`
	Reason   string   `json:"reason"`
}

type Issue struct {
	Origin      string         `json:"origin"`
	Code        string         `json:"code"`
	Severity    string         `json:"severity"`
	Description string         `json:"description"`
	Location    map[string]any `json:"location"`
}

type Assessment struct {
	Total       *float64 `json:"total"`
	NeedsReview bool     `json:"needs_review"`
	Blocking    bool     `json:"blocking"`
}

// ValidPath checks logical ledger paths under doc or code. It does not resolve
// filesystem paths or inspect symlinks; file callers must enforce those boundaries.
func ValidPath(path string, file bool) bool {
	if len(path) > 600 {
		return false
	}
	parts := strings.Split(path, "/")
	if len(parts) > 16 || (parts[0] != "doc" && parts[0] != "code") {
		return false
	}
	for _, p := range parts {
		if !segment.MatchString(p) || p == "." || p == ".." {
			return false
		}
	}
	if !file {
		return true
	}
	isMD := strings.HasSuffix(path, ".md") && !strings.EqualFold(parts[len(parts)-1], "README.md")
	return len(parts) >= 3 && isMD
}

func Digest(v any) string {
	b, _ := json.Marshal(v)
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

const (
	defaultOrigin    = "default@1"
	dimensionsPrefix = "dimensions."
)

var defaultRubric = "0 unavailable; 25 severe gaps; 50 partially usable; 75 minor gaps; 100 source-verified"

// Resolve applies policy patches from the root to the target directory and records
// field provenance. Callers provide the selected policy revisions. The resulting
// digest covers effective values, so equivalent policies share eligibility semantics.
func Resolve(policies []Policy, path string) (Effective, error) {
	e := Effective{Threshold: 80, Dimensions: map[string]map[string]any{}, Origins: map[string]string{}}
	if path != "" && !ValidPath(path, false) {
		return e, problem(422, "invalid target directory")
	}
	weights := []float64{.2, .2, .15, .15, .1, .1, .1}
	for i, id := range Dimensions {
		e.Dimensions[id] = map[string]any{"weight": weights[i], "rubric": defaultRubric}
		e.Origins[dimensionsPrefix+id+".weight"] = defaultOrigin
		e.Origins[dimensionsPrefix+id+".rubric"] = defaultOrigin
	}
	e.Origins["review_threshold"] = defaultOrigin
	e.Origins["require_human"] = defaultOrigin
	paths := []string{""}
	if path != "" {
		parts := strings.Split(path, "/")
		for i := range parts {
			paths = append(paths, strings.Join(parts[:i+1], "/"))
		}
	}
	for _, parent := range paths {
		for _, p := range policies {
			if p.Path != parent {
				continue
			}
			if err := apply(&e, p); err != nil {
				return e, err
			}
		}
	}
	sum := 0.0
	for _, id := range Dimensions {
		sum += e.Dimensions[id]["weight"].(float64)
	}
	if math.Abs(sum-1) > 1e-6 {
		return e, problem(422, fmt.Sprintf("effective weights must sum to one for %s", path))
	}
	// Only effective values affect eligibility; provenance is still captured in the snapshot.
	e.Digest = Digest(map[string]any{
		"review_threshold": e.Threshold,
		"dimensions":       e.Dimensions,
		"require_human":    e.RequireHuman,
	})
	return e, nil
}

func isValidPercentage(n float64) bool {
	return !math.IsNaN(n) && !math.IsInf(n, 0) && n >= 0 && n <= 100
}

func isValidWeight(n float64) bool {
	return !math.IsNaN(n) && !math.IsInf(n, 0) && n >= 0 && n <= 1
}

func applyThreshold(e *Effective, v any, origin string) error {
	n, ok := v.(float64)
	if !ok || !isValidPercentage(n) {
		return problem(422, "invalid review threshold")
	}
	e.Threshold = n
	e.Origins["review_threshold"] = origin
	return nil
}

func applyHumanReview(e *Effective, v any, origin string) error {
	b, ok := v.(bool)
	if !ok {
		return problem(422, "invalid human review rule")
	}
	e.RequireHuman = b
	e.Origins["require_human"] = origin
	return nil
}

func apply(e *Effective, p Policy) error {
	origin := fmt.Sprintf("%s@%d", p.Path, p.Revision)
	for k, v := range p.Patch {
		switch k {
		case "review_threshold":
			if err := applyThreshold(e, v, origin); err != nil {
				return err
			}
		case "require_human":
			if err := applyHumanReview(e, v, origin); err != nil {
				return err
			}
		case "dimensions":
			if err := applyDimensions(e, v, origin); err != nil {
				return err
			}
		default:
			return problem(422, "unknown policy field")
		}
	}
	return nil
}

// Assess computes a weighted total only when every dimension has a score and
// evidence. Missing evidence, blocking issues, a low score or an explicit policy
// requirement keeps the result on the review path.
func Assess(e Effective, dims map[string]Dimension, issues []Issue) (Assessment, error) {
	r := Assessment{NeedsReview: e.RequireHuman}
	total := 0.0
	complete := true
	for id := range dims {
		if _, ok := e.Dimensions[id]; !ok {
			return r, problem(422, "unknown score dimension")
		}
	}

	for _, id := range Dimensions {
		d, ok := dims[id]
		if err := validateDimensionScore(d); err != nil {
			return r, err
		}
		if !completeDimensionScore(d, ok) {
			complete = false
			continue
		}
		total += *d.Score * e.Dimensions[id]["weight"].(float64)
	}

	for _, issue := range issues {
		if err := validateQualityIssue(issue); err != nil {
			return r, err
		}
		switch issue.Code {
		case "missing_source", "source_hash_mismatch", "critical_fact_error", "major_omission":
			r.Blocking = true
		default:
			// Non-blocking issue code
		}
		r.Blocking = r.Blocking || issue.Severity == "blocking"
	}
	if complete {
		r.Total = &total
	}
	r.NeedsReview = r.NeedsReview || !complete || r.Blocking || total < e.Threshold
	return r, nil
}

func hasEvidence(entries []any) bool {
	if len(entries) == 0 {
		return false
	}
	for _, entry := range entries {
		switch v := entry.(type) {
		case string:
			if strings.TrimSpace(v) == "" {
				return false
			}
		case map[string]any:
			if len(v) == 0 {
				return false
			}
		default:
			return false
		}
	}
	return true
}

func applyDimensions(e *Effective, rawDimensions any, origin string) error {
	dims, ok := rawDimensions.(map[string]any)
	if !ok {
		return problem(422, "invalid dimensions")
	}
	for id, raw := range dims {
		target, ok := e.Dimensions[id]
		if !ok {
			return problem(422, "unknown quality dimension")
		}
		fields, ok := raw.(map[string]any)
		if !ok {
			return problem(422, "invalid dimension patch")
		}
		if err := applyDimensionFields(e, id, target, fields, origin); err != nil {
			return err
		}
	}
	return nil
}

func applyDimensionFields(e *Effective, id string, target, fields map[string]any, origin string) error {
	for key, value := range fields {
		switch key {
		case "weight":
			n, ok := value.(float64)
			if !ok || !isValidWeight(n) {
				return problem(422, "invalid dimension weight")
			}
			target[key] = n
		case "rubric":
			s, ok := value.(string)
			if !ok || strings.TrimSpace(s) == "" || len(s) > 4000 {
				return problem(422, "invalid rubric")
			}
			target[key] = s
		default:
			return problem(422, "unknown dimension field")
		}
		e.Origins["dimensions."+id+"."+key] = origin
	}
	return nil
}

func validateDimensionScore(d Dimension) error {
	if d.Score != nil {
		n := *d.Score
		if math.IsNaN(n) || math.IsInf(n, 0) || n < 0 || n > 100 {
			return problem(422, "score must be between zero and 100")
		}
	}
	return nil
}

func validIssueOrigin(origin string) bool {
	return origin == "source" || origin == "conversion"
}

func validIssueSeverity(sev string) bool {
	return sev == "blocking" || sev == "warning"
}

func validateQualityIssue(issue Issue) error {
	if !validIssueOrigin(issue.Origin) || !validIssueSeverity(issue.Severity) {
		return problem(422, "invalid quality issue")
	}
	if issue.Description == "" || issue.Code == "" {
		return problem(422, "invalid quality issue")
	}
	return nil
}

func completeDimensionScore(d Dimension, present bool) bool {
	if !present || d.Score == nil {
		return false
	}
	return hasEvidence(d.Evidence) && strings.TrimSpace(d.Reason) != ""
}
