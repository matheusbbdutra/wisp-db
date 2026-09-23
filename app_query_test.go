package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"wisp/internal/db"
	"wisp/internal/session"
)

// TestFetchRowsTruncatesAtMaxRows covers ADR 0023: when the session's MaxRows cap is
// reached across FetchRows calls, FetchRows returns Truncated=true (with HasMore=false
// and Rows=nil), the underlying driver cursor is closed, and history is finalized at
// the actual FetchedRowCount — not silently inflated past the limit.
func TestFetchRowsTruncatesAtMaxRows(t *testing.T) {
	app := &App{
		sessions: session.NewManager(),
	}

	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "truncate.db")
	f, err := os.Create(dbPath)
	if err != nil {
		t.Fatalf("creating db file: %v", err)
	}
	_ = f.Close()

	if _, err := app.Connect("tab-trunc", "sqlite", dbPath); err != nil {
		t.Fatalf("Connect: %v", err)
	}
	defer app.Disconnect("tab-trunc")

	s, err := app.sessions.Get("tab-trunc")
	if err != nil {
		t.Fatalf("Get session: %v", err)
	}

	// Force a tiny cap so we exercise the truncation path with a few rows.
	s.MaxRows = 5

	if _, err := s.Driver.Execute(context.Background(), `
		CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT);
		INSERT INTO t (v) VALUES ('a'),('b'),('c'),('d'),('e'),('f'),('g'),('h');
	`); err != nil {
		t.Fatalf("seeding: %v", err)
	}

	if _, err := app.RunQuery("tab-trunc", "SELECT * FROM t ORDER BY id"); err != nil {
		t.Fatalf("RunQuery: %v", err)
	}

	// First batch: 3 rows (within cap).
	b1, err := app.FetchRows("tab-trunc", 3)
	if err != nil {
		t.Fatalf("FetchRows #1: %v", err)
	}
	if len(b1.Rows) != 3 || !b1.HasMore || b1.Truncated {
		t.Fatalf("unexpected first batch: rows=%d hasMore=%v truncated=%v",
			len(b1.Rows), b1.HasMore, b1.Truncated)
	}

	// Second batch: requesting 3 more, but only 2 remain in budget → driver returns 2,
	// post-fetch enforcement keeps HasMore=true (cumulative 5/5) but the next call
	// must report Truncated and return no rows.
	b2, err := app.FetchRows("tab-trunc", 3)
	if err != nil {
		t.Fatalf("FetchRows #2: %v", err)
	}
	if len(b2.Rows) != 2 {
		t.Fatalf("expected 2 rows in second batch, got %d", len(b2.Rows))
	}
	if !b2.HasMore || b2.Truncated {
		t.Fatalf("expected HasMore=true Truncated=false on second batch (cap reached, but more rows available server-side), got hasMore=%v truncated=%v",
			b2.HasMore, b2.Truncated)
	}

	// Third call: cumulative count has reached the cap → Truncated=true, no rows.
	b3, err := app.FetchRows("tab-trunc", 3)
	if err != nil {
		t.Fatalf("FetchRows #3: %v", err)
	}
	if b3.HasMore || !b3.Truncated || len(b3.Rows) != 0 {
		t.Fatalf("expected truncated empty batch, got rows=%d hasMore=%v truncated=%v",
			len(b3.Rows), b3.HasMore, b3.Truncated)
	}

	// Final count recorded in history equals MaxRows (not inflated past it).
	s2, _ := app.sessions.Get("tab-trunc")
	if s2.FetchedRowCount != 5 {
		t.Fatalf("expected FetchedRowCount=5 after truncation, got %d", s2.FetchedRowCount)
	}
}

// TestRunQueryAppliesDefaults verifies that Connect applies db.DefaultMaxRows and
// db.DefaultQueryTimeout to the session, so all subsequent QueryCtx derivations
// inherit the budget (ADR 0023).
func TestRunQueryAppliesDefaults(t *testing.T) {
	app := &App{
		sessions: session.NewManager(),
	}

	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "defaults.db")
	f, _ := os.Create(dbPath)
	_ = f.Close()

	if _, err := app.Connect("tab-defaults", "sqlite", dbPath); err != nil {
		t.Fatalf("Connect: %v", err)
	}
	defer app.Disconnect("tab-defaults")

	s, err := app.sessions.Get("tab-defaults")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if s.MaxRows != db.DefaultMaxRows {
		t.Fatalf("expected MaxRows=%d, got %d", db.DefaultMaxRows, s.MaxRows)
	}
	if s.QueryTimeout != db.DefaultQueryTimeout {
		t.Fatalf("expected QueryTimeout=%v, got %v", db.DefaultQueryTimeout, s.QueryTimeout)
	}
}
// TestFetchRowsNoCapWhenMaxRowsZero covers ADR 0023's defensive no-cap path: when
// MaxRows <= 0, FetchRows must not enforce a cap and must return the full batch with
// Truncated=false, even if the driver delivers more than a configured default.
func TestFetchRowsNoCapWhenMaxRowsZero(t *testing.T) {
	app := &App{sessions: session.NewManager()}

	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "nocap.db")
	f, err := os.Create(dbPath)
	if err != nil {
		t.Fatalf("creating db file: %v", err)
	}
	_ = f.Close()

	if _, err := app.Connect("tab-nocap", "sqlite", dbPath); err != nil {
		t.Fatalf("Connect: %v", err)
	}
	defer app.Disconnect("tab-nocap")

	s, err := app.sessions.Get("tab-nocap")
	if err != nil {
		t.Fatalf("Get session: %v", err)
	}
	s.MaxRows = 0

	if _, err := s.Driver.Execute(context.Background(), `
		CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT);
		INSERT INTO t (v) VALUES ('a'),('b'),('c'),('d'),('e'),('f'),('g'),('h');
	`); err != nil {
		t.Fatalf("seeding: %v", err)
	}

	if _, err := app.RunQuery("tab-nocap", "SELECT * FROM t ORDER BY id"); err != nil {
		t.Fatalf("RunQuery: %v", err)
	}

	b, err := app.FetchRows("tab-nocap", 100)
	if err != nil {
		t.Fatalf("FetchRows: %v", err)
	}
	if len(b.Rows) != 8 {
		t.Fatalf("expected all 8 rows (no cap), got %d", len(b.Rows))
	}
	if b.HasMore {
		t.Fatalf("expected HasMore=false (exhausted), got true")
	}
	if b.Truncated {
		t.Fatalf("expected Truncated=false with MaxRows=0")
	}
}