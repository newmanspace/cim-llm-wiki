package documentquality

import "testing"

func TestSVNSourceTransports(t *testing.T) {
	for _, remote := range []string{
		"http://10.10.50.171/svnRepos/myCIM4.0%E4%BA%A7%E5%93%81%E6%96%87%E6%A1%A3",
		"https://example.test/svn/docs",
	} {
		t.Run(remote, func(t *testing.T) {
			r, err := NormalizeSourceConfig(Record{"name": "Documents", "type": "svn", "url": remote, "revision_selector": "5032"})
			if err != nil {
				t.Fatal(err)
			}
			if Text(r, "url") != remote || Text(r, "auth") != "svn_cache" {
				t.Fatalf("source transport or authentication changed: %+v", r)
			}
		})
	}
	for _, remote := range []string{
		"file:///tmp/repo", "ftp://example.test/repo", "svn://example.test/repo",
		"http://user:password@example.test/repo", "http://user@example.test/repo",
		"http://example.test/repo?token=secret", "http://example.test/repo#fragment", "http:///repo",
	} {
		t.Run(remote, func(t *testing.T) {
			if _, err := NormalizeSourceConfig(Record{"name": "Documents", "type": "svn", "url": remote, "revision_selector": "HEAD"}); err == nil {
				t.Fatal("accepted invalid SVN URL")
			}
		})
	}
}
