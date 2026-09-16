package errlog

import (
	"strings"
	"testing"
)

func TestScrubRedactsDSNCredentials(t *testing.T) {
	original := `dial error: postgres://admin:s3cr3t@db.internal:5432/app is unreachable`
	got := Scrub(original)
	if got == original {
		t.Fatal("expected the DSN credentials to be redacted, message left unchanged")
	}
	if want := "postgres://***@db.internal"; !strings.Contains(got, want) {
		t.Fatalf("expected redacted DSN to contain %q, got %q", want, got)
	}
	if strings.Contains(got, "admin:s3cr3t") {
		t.Fatalf("credentials leaked into scrubbed message: %q", got)
	}
}

func TestScrubRedactsQuotedLiterals(t *testing.T) {
	got := Scrub(`duplicate key value violates unique constraint: key 'joao.silva@example.com' already exists`)
	if strings.Contains(got, "joao.silva@example.com") {
		t.Fatalf("literal value leaked into scrubbed message: %q", got)
	}
	if !strings.Contains(got, "'***'") {
		t.Fatalf("expected redacted placeholder in message, got %q", got)
	}
}

func TestScrubLeavesPlainMessagesUnchanged(t *testing.T) {
	msg := "connection refused"
	if got := Scrub(msg); got != msg {
		t.Fatalf("expected plain message untouched, got %q", got)
	}
}
