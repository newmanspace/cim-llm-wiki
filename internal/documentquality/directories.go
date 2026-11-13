package documentquality

import (
	"context"
	"sort"
	"strings"
	"unicode/utf8"
)

func liveDirectory(r Record) bool      { return r["deleted"] != true }
func directoryName(path string) string { parts := strings.Split(path, "/"); return parts[len(parts)-1] }
func directoryMode(patch map[string]any) string {
	if len(patch) == 0 {
		return "inherit"
	}
	dims, _ := patch["dimensions"].(map[string]any)
	if _, ok := patch["review_threshold"]; !ok {
		return "partial"
	}
	for _, d := range Dimensions {
		fields, _ := dims[d].(map[string]any)
		if fields["weight"] == nil || fields["rubric"] == nil {
			return "partial"
		}
	}
	return "independent"
}
func directoryBlocked(tx Tx, path string) (bool, error) {
	groups := map[string][]Record{}
	for _, kind := range []string{"directories", "artifact_versions", "quality_policies", "publications"} {
		rows, err := tx.List(kind)
		if err != nil {
			return false, err
		}
		groups[kind] = rows
	}
	return blockedDirectoryRows(path, groups), nil
}
func blockedDirectoryRows(path string, groups map[string][]Record) bool {
	if path == "doc" || path == "code" {
		return true
	}
	for kind, rows := range groups {
		for _, row := range rows {
			if kind == "directories" {
				if liveDirectory(row) && strings.HasPrefix(Text(row, "path"), path+"/") {
					return true
				}
				continue
			}
			target := Text(row, "path")
			if kind != "quality_policies" {
				target = folder(Text(row, "target_path"))
			}
			if target == path || strings.HasPrefix(target, path+"/") {
				return true
			}
		}
	}
	return false
}
func mutateDirectory(tx Tx, r Record) (Record, error) {
	rows, err := tx.List("directories")
	if err != nil {
		return nil, err
	}
	path := Text(r, "path")
	action := Text(r, "action")
	if action == "" {
		action = "create"
	}
	if action != "create" && action != "update" && action != "delete" {
		return nil, problem(422, "Invalid directory action")
	}
	var old Record
	if action != "create" {
		old, err = tx.Get("directories", Text(r, "id"))
		if err != nil {
			return nil, err
		}
		if !liveDirectory(old) || revision(old) != int(number(r, "expected_revision")) {
			return nil, problem(409, "Directory changed; reload its properties")
		}
		if action == "delete" {
			path = Text(old, "path")
		}
	}
	if !ValidPath(path, false) {
		return nil, problem(422, "Invalid document directory")
	}
	name := strings.TrimSpace(Text(r, "display_name"))
	if name == "" {
		name = directoryName(path)
	}
	if utf8.RuneCountInString(name) > 100 || strings.ContainsAny(name, "\r\n\t\x00") {
		return nil, problem(422, "Invalid directory display name")
	}
	if old != nil && action == "update" && folder(path) != folder(Text(old, "path")) {
		return nil, problem(422, "Only the path segment of an empty directory can change")
	}
	if old != nil && (action == "delete" || path != Text(old, "path")) {
		blocked, e := directoryBlocked(tx, Text(old, "path"))
		if e != nil {
			return nil, e
		}
		if blocked {
			return nil, problem(409, "Directory has children, policy history or document references; only its display name can change")
		}
	}
	for _, row := range rows {
		if liveDirectory(row) && Text(row, "path") == path && id(row) != id(old) {
			return nil, problem(409, "Document directory already exists")
		}
	}
	if action == "create" {
		parts := strings.Split(path, "/")
		missing := []string{}
		for i := 1; i < len(parts); i++ {
			parent := strings.Join(parts[:i], "/")
			found := false
			for _, row := range rows {
				if liveDirectory(row) && Text(row, "path") == parent {
					found = true
				}
			}
			if !found {
				missing = append(missing, parent)
			}
		}
		if len(missing) > 0 && r["create_parents"] != true {
			return nil, problem(422, "Parent directory is missing; explicitly confirm creating missing parents")
		}
		for _, parent := range missing {
			row, e := tx.Insert("directories", Record{"path": parent, "display_name": directoryName(parent)})
			if e != nil {
				return nil, e
			}
			if _, e = tx.Insert("directory_events", Record{"directory_id": id(row), "action": "create", "after": row}); e != nil {
				return nil, e
			}
		}
	}
	next := Record{"path": path, "display_name": name}
	if action == "delete" {
		next = copyRecord(old)
		next["deleted"] = true
	}
	var saved Record
	if old == nil {
		saved, err = tx.Insert("directories", next)
	} else {
		saved, err = tx.Update("directories", id(old), revision(old), next)
	}
	if err != nil {
		return nil, err
	}
	_, err = tx.Insert("directory_events", Record{"directory_id": id(saved), "action": action, "before": old, "after": saved})
	return saved, err
}
func catalog(tx Tx) ([]Record, error) {
	dirs, err := tx.List("directories")
	if err != nil {
		return nil, err
	}
	ps, err := policies(tx)
	if err != nil {
		return nil, err
	}
	artifacts, err := tx.List("artifact_versions")
	if err != nil {
		return nil, err
	}
	policyRows, err := tx.List("quality_policies")
	if err != nil {
		return nil, err
	}
	pubRows, err := tx.List("publications")
	if err != nil {
		return nil, err
	}
	groups := map[string][]Record{"directories": dirs, "artifact_versions": artifacts, "quality_policies": policyRows, "publications": pubRows}
	entries := map[string]Record{}
	add := func(path string) {
		parts := strings.Split(path, "/")
		for i := 1; i <= len(parts); i++ {
			p := strings.Join(parts[:i], "/")
			if ValidPath(p, false) && entries[p] == nil {
				entries[p] = Record{"path": p, "parent_path": folder(p), "display_name": directoryName(p), "virtual": true}
			}
		}
	}
	for _, r := range dirs {
		if liveDirectory(r) {
			add(Text(r, "path"))
			n := copyRecord(r)
			n["parent_path"] = folder(Text(r, "path"))
			entries[Text(r, "path")] = n
		}
	}
	for _, p := range ps {
		if p.Path != "" {
			add(p.Path)
		}
	}
	for _, r := range artifacts {
		add(folder(Text(r, "target_path")))
	}
	out := []Record{}
	for path, r := range entries {
		childCount := 0
		for p := range entries {
			if folder(p) == path {
				childCount++
			}
		}
		documents := map[string]bool{}
		for _, a := range artifacts {
			if strings.HasPrefix(Text(a, "target_path"), path+"/") {
				documents[Text(a, "target_path")] = true
			}
		}
		mode := "inherit"
		for _, p := range ps {
			if p.Path == path {
				mode = directoryMode(p.Patch)
			}
		}
		blocked := blockedDirectoryRows(path, groups)
		r["child_count"] = childCount
		r["document_count"] = len(documents)
		r["scoring_mode"] = mode
		r["path_locked"] = blocked
		r["can_delete"] = !blocked && r["virtual"] != true
		out = append(out, r)
	}
	sort.Slice(out, func(i, j int) bool { return Text(out[i], "path") < Text(out[j], "path") })
	return out, nil
}
func (s Service) DirectoryCatalog(ctx context.Context, project string) ([]Record, error) {
	var rows []Record
	err := s.Repository.WithProject(ctx, project, "reader", func(tx Tx) error { var e error; rows, e = catalog(tx); return e })
	return rows, err
}
func (s Service) PreviewPolicy(ctx context.Context, project string, r Record) (Record, error) {
	var result Record
	err := s.Repository.WithProject(ctx, project, "administrator", func(tx Tx) error {
		path := Text(r, "path")
		if path != "" && !ValidPath(path, false) {
			return problem(422, "Invalid policy path")
		}
		patch := object(r, "patch")
		if patch == nil {
			return problem(422, "Policy patch must be an object")
		}
		ps, e := policies(tx)
		if e != nil {
			return e
		}
		next := append([]Policy{}, ps...)
		n := 0
		for i, p := range next {
			if p.Path == path {
				n = p.Revision
				next = append(next[:i], next[i+1:]...)
				break
			}
		}
		if int(number(r, "expected_revision")) != n {
			return problem(409, "Policy revision changed")
		}
		next = append(next, Policy{Path: path, Revision: n + 1, Patch: patch})
		rows, e := catalog(tx)
		if e != nil {
			return e
		}
		paths := map[string]bool{path: true}
		for _, row := range rows {
			p := Text(row, "path")
			if path == "" || p == path || strings.HasPrefix(p, path+"/") {
				paths[p] = true
			}
		}
		changed := []string{}
		for p := range paths {
			before, e := Resolve(ps, p)
			if e != nil {
				return e
			}
			after, e := Resolve(next, p)
			if e != nil {
				return e
			}
			if before.Digest != after.Digest {
				changed = append(changed, p)
			}
		}
		sort.Strings(changed)
		before, e := Resolve(ps, path)
		if e != nil {
			return e
		}
		after, e := Resolve(next, path)
		if e != nil {
			return e
		}
		result = Record{"changed_paths": changed, "effective": after, "expected_digest": before.Digest}
		return nil
	})
	return result, err
}
