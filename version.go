package main

// AppVersion follows the same text as git tags (e.g. "v0.1.0-beta.3") — update it
// manually for each release, using the same non-automated pattern as VERSION in
// packaging/deb/build.sh (no ldflags/build-time infrastructure at this stage). Used by
// the update checker (CheckForUpdate, app.go).
const AppVersion = "v0.1.0-beta.7"
