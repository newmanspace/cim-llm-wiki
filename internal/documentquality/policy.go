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

var Dimensions = []string{"fidelity", "completeness", "traceability", "consistency", "structure", "usability", "validity"}
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
	return !file || (len(parts) >= 3 && strings.HasSuffix(path, ".md") && !strings.EqualFold(parts[len(parts)-1], "README.md"))
}
func Digest(v any) string {
	b, _ := json.Marshal(v)
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}
func Resolve(policies []Policy, path string) (Effective, error) {
	e := Effective{Threshold: 80, Dimensions: map[string]map[string]any{}, Origins: map[string]string{}}
	if path != "" && !ValidPath(path, false) {
		return e, problem(422, "invalid target directory")
	}
	weights := []float64{.2, .2, .15, .15, .1, .1, .1}
	for i, id := range Dimensions {
		e.Dimensions[id] = map[string]any{"weight": weights[i], "rubric": "0 unavailable; 25 severe gaps; 50 partially usable; 75 minor gaps; 100 source-verified"}
		e.Origins["dimensions."+id+".weight"] = "default@1"
		e.Origins["dimensions."+id+".rubric"] = "default@1"
	}
	e.Origins["review_threshold"] = "default@1"
	e.Origins["require_human"] = "default@1"
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
	e.Digest = Digest(map[string]any{"review_threshold": e.Threshold, "dimensions": e.Dimensions, "require_human": e.RequireHuman})
	return e, nil
}
func apply(e *Effective, p Policy) error {
	origin := fmt.Sprintf("%s@%d", p.Path, p.Revision)
	for k, v := range p.Patch {
		switch k {
		case "review_threshold":
			n, ok := v.(float64)
			if !ok || math.IsNaN(n) || math.IsInf(n, 0) || n < 0 || n > 100 {
				return problem(422, "invalid review threshold")
			}
			e.Threshold = n
			e.Origins[k] = origin
		case "require_human":
			b, ok := v.(bool)
			if !ok {
				return problem(422, "invalid human review rule")
			}
			e.RequireHuman = b
			e.Origins[k] = origin
		case "dimensions":
			dims, ok := v.(map[string]any)
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
				for key, value := range fields {
					switch key {
					case "weight":
						n, ok := value.(float64)
						if !ok || math.IsNaN(n) || math.IsInf(n, 0) || n < 0 || n > 1 {
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
			}
		default:
			return problem(422, "unknown policy field")
		}
	}
	return nil
}
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
		if d.Score != nil {
			n := *d.Score
			if math.IsNaN(n) || math.IsInf(n, 0) || n < 0 || n > 100 {
				return r, problem(422, "score must be between zero and 100")
			}
		}
		if !ok || d.Score == nil || !hasEvidence(d.Evidence) || strings.TrimSpace(d.Reason) == "" {
			complete = false
			continue
		}
		total += *d.Score * e.Dimensions[id]["weight"].(float64)
	}

	for _, issue := range issues {
		if (issue.Origin != "source" && issue.Origin != "conversion") || (issue.Severity != "blocking" && issue.Severity != "warning") || issue.Description == "" || issue.Code == "" {
			return r, problem(422, "invalid quality issue")
		}
		switch issue.Code {
		case "missing_source", "source_hash_mismatch", "critical_fact_error", "major_omission":
			r.Blocking = true
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
