package main

import (
	"strconv"
	"strings"
)

// AppVersion follows the same text as git tags (e.g. "v0.1.0-beta.3") — update it
// manually for each release. It is the single source of truth for the release
// version: packaging/deb/build.sh derives its Debian VERSION from this constant
// (v-prefix stripped, "-beta" mapped to Debian's "~beta" ordering), and
// packaging/arch/PKGBUILD tracks it by hand (pkgver intentionally carries no
// beta suffix — Arch has no "~" ordering convention). Used by the update
// checker (CheckForUpdate, app.go).
const AppVersion = "v0.1.0-beta.14"

// isNewerVersion reports whether latest is a NEWER release than current,
// comparing with semver precedence (numeric prerelease identifiers compare
// numerically, so v0.1.0-beta.10 > v0.1.0-beta.7 — plain string comparison
// gets that wrong). A stable release outranks any prerelease of the same
// core. Either side unparsable falls back to plain inequality (notify rather
// than silently miss a real update).
func isNewerVersion(latest, current string) bool {
	ln, lok := parseReleaseVersion(latest)
	cn, cok := parseReleaseVersion(current)
	if !lok || !cok {
		return latest != current
	}
	if cmp := compareInts(ln.core, cn.core); cmp != 0 {
		return cmp > 0
	}
	// Same core: stable (no prerelease) outranks prerelease.
	if len(ln.pre) == 0 && len(cn.pre) == 0 {
		return false
	}
	if len(ln.pre) == 0 {
		return true
	}
	if len(cn.pre) == 0 {
		return false
	}
	return compareIdentifiers(ln.pre, cn.pre) > 0
}

type releaseVersion struct {
	core []int
	pre  []string
}

// parseReleaseVersion parses tags like "v0.1.0-beta.7" (leading "v" optional,
// build metadata after "+" ignored). ok=false when the core is not numeric.
func parseReleaseVersion(tag string) (releaseVersion, bool) {
	s := strings.TrimSpace(tag)
	s = strings.TrimPrefix(s, "v")
	s = strings.TrimPrefix(s, "V")
	if i := strings.Index(s, "+"); i >= 0 {
		s = s[:i]
	}
	core, pre := s, ""
	if i := strings.Index(s, "-"); i >= 0 {
		core, pre = s[:i], s[i+1:]
	}
	coreParts := strings.Split(core, ".")
	nums := make([]int, len(coreParts))
	for i, p := range coreParts {
		n, err := strconv.Atoi(p)
		if err != nil {
			return releaseVersion{}, false
		}
		nums[i] = n
	}
	var ids []string
	if pre != "" {
		ids = strings.Split(pre, ".")
	}
	return releaseVersion{core: nums, pre: ids}, true
}

func compareInts(a, b []int) int {
	for i := 0; i < len(a) && i < len(b); i++ {
		if a[i] != b[i] {
			if a[i] < b[i] {
				return -1
			}
			return 1
		}
	}
	switch {
	case len(a) < len(b):
		return -1
	case len(a) > len(b):
		return 1
	default:
		return 0
	}
}

// compareIdentifiers follows semver prerelease precedence: numeric identifiers
// compare numerically, alphanumeric lexically, numeric < alphanumeric, and a
// longer identifier set wins when the shorter is a prefix of it.
func compareIdentifiers(a, b []string) int {
	for i := 0; i < len(a) && i < len(b); i++ {
		an, aerr := strconv.Atoi(a[i])
		bn, berr := strconv.Atoi(b[i])
		switch {
		case aerr == nil && berr == nil:
			if an != bn {
				if an < bn {
					return -1
				}
				return 1
			}
		case aerr == nil:
			return -1
		case berr == nil:
			return 1
		default:
			if c := strings.Compare(a[i], b[i]); c != 0 {
				return c
			}
		}
	}
	switch {
	case len(a) < len(b):
		return -1
	case len(a) > len(b):
		return 1
	default:
		return 0
	}
}
