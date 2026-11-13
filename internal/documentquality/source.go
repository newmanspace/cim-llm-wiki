package documentquality

import (
	"net"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

var gitCommit = regexp.MustCompile(`^(?:[0-9a-f]{40}|[0-9a-f]{64})$`)
var gitReference = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._/-]*$`)
var gitSCP = regexp.MustCompile(`^([A-Za-z0-9][A-Za-z0-9._-]*)@([A-Za-z0-9][A-Za-z0-9.-]*):([^[:space:]]+)$`)
var gitHost = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9.-]*$`)
var gitUser = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*$`)

func normalizeGitURL(raw string) (string, error) {
	if match := gitSCP.FindStringSubmatch(raw); match != nil {
		raw = "ssh://" + match[1] + "@" + match[2] + "/" + match[3]
	}
	u, e := url.Parse(raw)
	if e != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "ssh") || u.RawQuery != "" || u.Fragment != "" || strings.ContainsAny(raw, " \t\r\n") {
		return "", problem(422, "Git URL must use HTTPS or SSH without a password, query or fragment")
	}
	if !gitHost.MatchString(u.Hostname()) && net.ParseIP(u.Hostname()) == nil {
		return "", problem(422, "Invalid Git host")
	}
	if u.User != nil {
		_, password := u.User.Password()
		if u.Scheme != "ssh" || password || !gitUser.MatchString(u.User.Username()) {
			return "", problem(422, "Git credentials must remain in the local credential helper or SSH agent")
		}
	}
	u.Host = strings.ToLower(u.Host)
	return strings.TrimRight(u.String(), "/"), nil
}
func validGitReference(ref string) bool {
	if !gitReference.MatchString(ref) || strings.Contains(ref, "..") || strings.Contains(ref, "//") || strings.HasSuffix(ref, "/") || strings.HasSuffix(ref, ".") {
		return false
	}
	for _, part := range strings.Split(ref, "/") {
		if strings.HasPrefix(part, ".") || strings.HasSuffix(part, ".lock") {
			return false
		}
	}
	return true
}
func sourceType(r Record) string {
	if Text(r, "source_type") == "git" {
		return "git"
	}
	return "svn"
}
func sourceRevision(r Record) string {
	if sourceType(r) == "git" {
		return Text(r, "commit_sha")
	}
	return Text(r, "operative_revision")
}
func repositoryIdentity(r Record) string {
	if sourceType(r) == "git" {
		return Text(r, "repository_url")
	}
	return Text(r, "repository_uuid")
}

// NormalizeSourceConfig shares transport and selection validation across source kinds.
func NormalizeSourceConfig(r Record) (Record, error) {
	if e := required(r, "name", "url"); e != nil {
		return nil, e
	}
	kind := Text(r, "type")
	if kind != "svn" && kind != "git" {
		return nil, problem(422, "Data source type must be svn or git")
	}
	remote := Text(r, "url")
	auth := "svn_cache"
	var e error
	if kind == "git" {
		remote, e = normalizeGitURL(remote)
		auth = "git_local"
	} else {
		u, err := url.Parse(remote)
		if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
			return nil, problem(422, "SVN URL must be HTTPS without credentials, query or fragment")
		}
	}
	if e != nil {
		return nil, e
	}
	sub := Text(r, "subpath")
	if sub != "" {
		for _, part := range strings.Split(sub, "/") {
			if part == "." || part == ".." || part == "" || strings.ContainsAny(part, "\\@\x00%?#") {
				return nil, problem(422, "Invalid repository subpath")
			}
		}
	}
	selector := Text(r, "revision_selector")
	if kind == "git" {
		if !validGitReference(selector) {
			return nil, problem(422, "Invalid Git branch, tag or commit selector")
		}
	} else if selector != "HEAD" {
		if _, e = strconv.ParseUint(selector, 10, 64); e != nil {
			return nil, problem(422, "Invalid SVN revision selector")
		}
	}
	return Record{"name": Text(r, "name"), "type": kind, "url": remote, "auth": auth, "subpath": sub, "revision_selector": selector}, nil
}
