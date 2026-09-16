package main

import "testing"

func TestIsNewerVersion(t *testing.T) {
	cases := []struct {
		latest  string
		current string
		want    bool
	}{
		// Prerelease numeric ordering (the string-inequality bug: "beta10" < "beta7" lexically).
		{"v0.1.0-beta.10", "v0.1.0-beta.7", true},
		{"v0.1.0-beta.7", "v0.1.0-beta.10", false},
		{"v0.1.0-beta.8", "v0.1.0-beta.7", true},
		// Equal tags: no update.
		{"v0.1.0-beta.7", "v0.1.0-beta.7", false},
		// Core ordering.
		{"v0.2.0-beta.1", "v0.1.0-beta.9", true},
		{"v0.1.0-beta.9", "v0.2.0-beta.1", false},
		// Stable outranks prerelease of the same core, and vice versa.
		{"v0.1.0", "v0.1.0-beta.7", true},
		{"v0.1.0-beta.7", "v0.1.0", false},
		{"v0.1.1", "v0.1.0", true},
		// Leading "v" optional on either side.
		{"0.1.0-beta.8", "v0.1.0-beta.7", true},
		// Unparsable side falls back to plain inequality (notify).
		{"not-a-version", "v0.1.0-beta.7", true},
		{"not-a-version", "not-a-version", false},
	}
	for _, c := range cases {
		if got := isNewerVersion(c.latest, c.current); got != c.want {
			t.Errorf("isNewerVersion(%q, %q) = %v, want %v", c.latest, c.current, got, c.want)
		}
	}
}
