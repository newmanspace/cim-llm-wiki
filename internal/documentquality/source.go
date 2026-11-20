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

func isAllowedGitScheme(scheme string) bool {
	return scheme == "https" || scheme == "ssh"
}

func hasGitURLInvalidParts(u *url.URL, raw string) bool {
	if u.Host == "" || !isAllowedGitScheme(u.Scheme) {
		return true
	}
	return u.RawQuery != "" || u.Fragment != "" || strings.ContainsAny(raw, " \t\r\n")
}

func normalizeGitURL(raw string) (string, error) {
	if match := gitSCP.FindStringSubmatch(raw); match != nil {
		raw = "ssh://" + match[1] + "@" + match[2] + "/" + match[3]
	}
	u, e := url.Parse(raw)
	if e != nil || hasGitURLInvalidParts(u, raw) {
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

func hasGitRefBoundaryIssue(ref string) bool {
	if strings.Contains(ref, "..") || strings.Contains(ref, "//") {
		return true
	}
	return strings.HasSuffix(ref, "/") || strings.HasSuffix(ref, ".")
}

func validGitReference(ref string) bool {
	if !gitReference.MatchString(ref) || hasGitRefBoundaryIssue(ref) {
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
	if Text(r, "source_type") == "local_file" {
		return "local_file"
	}
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
	remote, auth, e := normalizeSourceURL(kind, Text(r, "url"))
	if e != nil {
		return nil, e
	}
	sub := Text(r, "subpath")
	if e := validateSourceSubpath(sub); e != nil {
		return nil, e
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
	} else {
		// Valid HEAD selector for non-git sources
	}
	return Record{
		"name":              Text(r, "name"),
		"type":              kind,
		"url":               remote,
		"auth":              auth,
		"subpath":           sub,
		"revision_selector": selector,
	}, nil
}

func isInvalidSVNURL(u *url.URL) bool {
	if u.Scheme != "http" && u.Scheme != "https" {
		return true
	}
	if u.Host == "" || u.User != nil {
		return true
	}
	return u.RawQuery != "" || u.Fragment != ""
}

func normalizeSourceURL(kind, remote string) (string, string, error) {
	auth := "svn_cache"
	var e error
	if kind == "git" {
		remote, e = normalizeGitURL(remote)
		auth = "git_local"
	} else {
		u, err := url.Parse(remote)
		if err != nil || isInvalidSVNURL(u) {
			return "", "", problem(422, "SVN URL must be HTTP or HTTPS without credentials, query or fragment")
		}
	}
	if e != nil {
		return "", "", e
	}
	return remote, auth, nil
}

func validateSourceSubpath(sub string) error {
	if sub != "" {
		for _, part := range strings.Split(sub, "/") {
			if part == "." || part == ".." || part == "" || strings.ContainsAny(part, "\\@\x00%?#") {
				return problem(422, "Invalid repository subpath")
			}
		}
	}
	return nil
}
