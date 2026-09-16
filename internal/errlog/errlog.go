// Package errlog is the local, append-only error/panic log used to diagnose crashes
// after the fact (see docs/adr — error reporting flow: capture locally first, the user
// reviews and decides whether to open a GitHub issue; nothing is sent automatically).
//
// Format: JSON Lines (one JSON object per line, via log/slog's stdlib JSON handler —
// no new dependency). A single JSON array file would need a full rewrite on every
// append and corrupts easily if the process dies mid-write (exactly the case this
// package exists for — panics and crashes); JSON Lines only ever appends a line.
package errlog

import (
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"sync"
)

// maxSizeBytes is the rotation threshold: past this size, the current file becomes
// wisp.log.1 (overwriting any previous one) and logging continues in a fresh file.
// Deliberately simple (no external rotation lib) — this is a diagnostic log for a
// desktop app, not a service with sustained high-volume logging.
const maxSizeBytes = 5 * 1024 * 1024

var (
	mu     sync.Mutex
	logger *slog.Logger
	file   *os.File
)

// dsnPattern matches "scheme://user:pass@host" connection strings so credentials never
// reach the log file even if a driver echoes the DSN back in an error message.
var dsnPattern = regexp.MustCompile(`([a-zA-Z][a-zA-Z0-9+.-]*://)[^/\s@]+@`)

// quotedLiteralPattern matches single-quoted SQL string literals — a query error can
// wrap the offending literal value (which may be user data), so it is redacted too.
// Same "err on the side of not leaking" spirit as SqlEditor.tsx's isInStringOrComment.
var quotedLiteralPattern = regexp.MustCompile(`'(?:[^']|'')*'`)

// Scrub removes patterns that could leak credentials or query data before a message is
// logged or shown to the user. Exported so the same redaction applies to whatever the
// future "Report problem" flow shows before opening a GitHub issue.
func Scrub(message string) string {
	message = dsnPattern.ReplaceAllString(message, "$1***@")
	message = quotedLiteralPattern.ReplaceAllString(message, "'***'")
	return message
}

// Init opens (creating if needed) <dbDir>/wisp.log for appending, rotating it first if
// it is already past maxSizeBytes. dbDir is the same directory the caller already uses
// for the SQLite store (see app.go startup) — one place for the app's local state.
// Safe to call more than once; a later call replaces the active logger/file.
func Init(dbDir string) error {
	mu.Lock()
	defer mu.Unlock()

	path := filepath.Join(dbDir, "wisp.log")
	if err := rotateIfNeeded(path); err != nil {
		return err
	}

	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}

	if file != nil {
		_ = file.Close()
	}
	file = f
	logger = slog.New(slog.NewJSONHandler(f, nil))
	return nil
}

func rotateIfNeeded(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if info.Size() < maxSizeBytes {
		return nil
	}
	return os.Rename(path, path+".1")
}

// Error records a scrubbed error entry. source identifies where it came from ("go-panic",
// "go", "frontend-error", "frontend-rejection", ...) so a later "Report problem" flow can
// tell a Go panic apart from a plain frontend exception. Attrs are extra structured
// fields (e.g. a stack trace) — logged as-is, so callers must scrub anything derived from
// user data (query text, DSNs) before passing it in; Scrub is exported for that.
func Error(source, message string, attrs ...slog.Attr) {
	mu.Lock()
	l := logger
	mu.Unlock()
	if l == nil {
		return
	}
	args := make([]any, 0, len(attrs)+2)
	args = append(args, slog.String("source", source))
	for _, a := range attrs {
		args = append(args, a)
	}
	l.Error(Scrub(message), args...)
}

// Close flushes and closes the log file — called from App.shutdown alongside the other
// local resources (store, vault).
func Close() error {
	mu.Lock()
	defer mu.Unlock()
	if file == nil {
		return nil
	}
	err := file.Close()
	file = nil
	logger = nil
	return err
}
