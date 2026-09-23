package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// wispReleasesAPI is the repository release list (not .../releases/latest!) — a real bug
// avoided before implementation: GitHub's "latest" endpoint IGNORES releases marked as
// prerelease and returns 404 when no stable release exists yet (confirmed against the
// real API while developing this feature) — all Wisp releases so far are prereleases
// (v0.1.0-beta.N). The regular list is already ordered newest to oldest, so the first
// item is always the relevant one.
const wispReleasesAPI = "https://api.github.com/repos/matheusbbdutra/wisp-db/releases"

// UpdateInfo is the result of CheckForUpdate — notification only; it never downloads or
// replaces the binary on its own (Wails has no native updater, unlike Electron's
// autoUpdater/Tauri's updater).
type UpdateInfo struct {
	CurrentVersion string
	LatestVersion  string
	HTMLURL        string
	HasUpdate      bool
}

type githubRelease struct {
	TagName string `json:"tag_name"`
	HTMLURL string `json:"html_url"`
}

// CheckForUpdate queries the public GitHub API (no authentication or credentials
// involved) and compares against AppVersion (version.go) with semver precedence
// (see isNewerVersion): only a strictly NEWER tag counts as "update available",
// so running a build newer than the latest release stays silent instead of
// nagging. A short timeout keeps the UI from hanging if the network is
// poor/unavailable (entirely optional; never blocks any app workflow).
func (a *App) CheckForUpdate() (*UpdateInfo, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, wispReleasesAPI, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("consultando releases do GitHub: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub respondeu %d", resp.StatusCode)
	}

	var releases []githubRelease
	if err := json.NewDecoder(resp.Body).Decode(&releases); err != nil {
		return nil, fmt.Errorf("lendo resposta do GitHub: %w", err)
	}
	if len(releases) == 0 {
		return &UpdateInfo{CurrentVersion: AppVersion, LatestVersion: AppVersion, HasUpdate: false}, nil
	}

	latest := releases[0]
	return &UpdateInfo{
		CurrentVersion: AppVersion,
		LatestVersion:  latest.TagName,
		HTMLURL:        latest.HTMLURL,
		HasUpdate:      isNewerVersion(latest.TagName, AppVersion),
	}, nil
}

// OpenReleaseURL opens the release page in the system default browser (never inside
// Wisp's own window). Restricted to https://github.com/ — never opens an arbitrary URL
// from elsewhere, only the one just returned by CheckForUpdate.
func (a *App) OpenReleaseURL(rawURL string) error {
	if !strings.HasPrefix(rawURL, "https://github.com/") {
		return fmt.Errorf("URL fora do domínio esperado")
	}
	runtime.BrowserOpenURL(a.ctx, rawURL)
	return nil
}

// GetAppVersion returns the current compiled application version string.
func (a *App) GetAppVersion() string {
	return AppVersion
}
