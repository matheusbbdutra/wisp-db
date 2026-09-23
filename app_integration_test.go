package main

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"wisp/internal/session"
	"wisp/internal/store"
	"wisp/internal/vault"
)

// newTestAppWithStore builds a minimal *App wired with a real session.Manager and a
// real store.Store backed by a temp SQLite file. Mirrors the startup shape from app.go
// (sessions + store) but skips the Wails runtime/event bus (a.ctx) and the schemaCache —
// none of the bindings exercised here need them, and keeping them nil matches what
// production does in the brief window before startup completes.
//
// The vault uses NewWithKey with a zero key (deterministic, no OS keychain) — the same
// pattern used by internal/store/store_test.go. This keeps the test fully self-contained
// and runnable in any environment.
func newTestAppWithStore(t *testing.T) (*App, string, string) {
	t.Helper()

	tempDir := t.TempDir()
	storePath := filepath.Join(tempDir, "store.db")
	dbPath := filepath.Join(tempDir, "target.db")
	f, err := os.Create(dbPath)
	if err != nil {
		t.Fatalf("creating target sqlite: %v", err)
	}
	_ = f.Close()

	v, err := vault.NewWithKey(make([]byte, 32))
	if err != nil {
		t.Fatalf("vault.NewWithKey: %v", err)
	}
	st, err := store.Open(storePath, v)
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })

	app := &App{
		sessions: session.NewManager(),
		store:    st,
	}
	return app, storePath, dbPath
}

// TestAppSaveConnectionRoundTrip exercises the connection lifecycle through the *App
// bindings (not internal/store directly), validating two security/UX properties:
//
//  1. ListSavedConnections never exposes the DSN — SavedConnection only carries
//     ID/Name/Driver/CreatedAt (see internal/store/store.go:65-71).
//  2. ConnectSaved decrypts the stored DSN via the vault and opens a real session that
//     matches the saved metadata (driver + dialect).
func TestAppSaveConnectionRoundTrip(t *testing.T) {
	app, _, dbPath := newTestAppWithStore(t)

	// Unique DSN so this test doesn't collide with anything serialized if the test
	// ever runs under -race against a shared store (paranoid; current setup is isolated).
	uniqueDSN := dbPath + "?_test=round-trip"

	connID, err := app.SaveConnection("Local SQLite (round-trip)", "sqlite", uniqueDSN)
	if err != nil {
		t.Fatalf("SaveConnection: %v", err)
	}
	if connID == "" {
		t.Fatalf("SaveConnection returned empty id")
	}

	listed, err := app.ListSavedConnections()
	if err != nil {
		t.Fatalf("ListSavedConnections: %v", err)
	}
	if len(listed) != 1 {
		t.Fatalf("ListSavedConnections: expected 1 entry, got %d", len(listed))
	}
	got := listed[0]
	if got.ID != connID {
		t.Errorf("Listed ID = %q, want %q", got.ID, connID)
	}
	if got.Name != "Local SQLite (round-trip)" {
		t.Errorf("Listed Name = %q, want %q", got.Name, "Local SQLite (round-trip)")
	}
	if got.Driver != "sqlite" {
		t.Errorf("Listed Driver = %q, want sqlite", got.Driver)
	}

	// Security assertion: the DSN MUST NOT leak through the listing endpoint. We check
	// via reflection on the SavedConnection struct fields (which is what JSON marshaling
	// would expose to the frontend) — even if someone added a DSN field later, this
	// test catches it because the field set is asserted by name, not by count.
	wantFields := []string{"ID", "Name", "Driver", "CreatedAt"}
	gotType := reflect.TypeOf(got)
	gotFields := make([]string, 0, gotType.NumField())
	for i := 0; i < gotType.NumField(); i++ {
		gotFields = append(gotFields, gotType.Field(i).Name)
	}
	if !reflect.DeepEqual(gotFields, wantFields) {
		t.Errorf("SavedConnection leaked fields. got=%v want=%v", gotFields, wantFields)
	}

	// ConnectSaved decrypts the DSN and opens a session on the target tab. We then
	// disconnect so the test cleans up; the round-trip itself is the contract.
	meta, err := app.ConnectSaved("tab-saved", connID)
	if err != nil {
		t.Fatalf("ConnectSaved: %v", err)
	}
	if meta == nil {
		t.Fatalf("ConnectSaved returned nil metadata")
	}
	if meta.Driver != "sqlite" {
		t.Errorf("SessionMetadata.Driver = %q, want sqlite", meta.Driver)
	}
	if meta.Dialect != "sqlite" {
		t.Errorf("SessionMetadata.Dialect = %q, want sqlite", meta.Dialect)
	}
	if meta.TabID != "tab-saved" {
		t.Errorf("SessionMetadata.TabID = %q, want tab-saved", meta.TabID)
	}
	if err := app.Disconnect("tab-saved"); err != nil {
		t.Fatalf("Disconnect: %v", err)
	}

	// Second disconnect must be safe (idempotent) — Disconnect on a closed tab is a
	// common UI race (user clicks "disconnect" twice, or after auto-cleanup).
	if err := app.Disconnect("tab-saved"); err != nil {
		t.Errorf("Disconnect on closed tab should be a no-op, got: %v", err)
	}
}

// TestAppUpdateCellOptimisticConcurrency covers ADR 0004's optimistic concurrency rule
// (see docs/adr/0004-inline-edit-safety.md and internal/db/sqlite.go:335): an UPDATE with
// WHERE pk = ? AND coluna_antiga = ? must return RowsAffected=0 (NOT an error) when the
// row changed between fetch and save — the frontend reverts the cell and warns the user.
func TestAppUpdateCellOptimisticConcurrency(t *testing.T) {
	app, _, dbPath := newTestAppWithStore(t)

	if _, err := app.Connect("tab-edit", "sqlite", dbPath); err != nil {
		t.Fatalf("Connect: %v", err)
	}
	defer app.Disconnect("tab-edit")

	s, err := app.sessions.Get("tab-edit")
	if err != nil {
		t.Fatalf("Get session: %v", err)
	}

	if _, err := s.Driver.Execute(context.Background(), `
		CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
		INSERT INTO t (id, name) VALUES (1, 'original');
	`); err != nil {
		t.Fatalf("seeding: %v", err)
	}

	// Happy path: oldValue matches the row → exactly 1 row affected.
	affected, err := app.UpdateCell(
		"tab-edit", "", "t",
		[]string{"id"}, []any{1},
		"name", "original", "updated",
	)
	if err != nil {
		t.Fatalf("UpdateCell (matching oldValue): %v", err)
	}
	if affected != 1 {
		t.Errorf("UpdateCell (matching oldValue): affected=%d, want 1", affected)
	}

	// Concurrency path: pass the stale oldValue ('original') after the row was already
	// changed to 'updated' → 0 rows affected, NO error. This is the user-vs-other-process
	// race the ADR guards against.
	affected, err = app.UpdateCell(
		"tab-edit", "", "t",
		[]string{"id"}, []any{1},
		"name", "original", "would-also-update",
	)
	if err != nil {
		t.Fatalf("UpdateCell (stale oldValue) must NOT error: %v", err)
	}
	if affected != 0 {
		t.Errorf("UpdateCell (stale oldValue): affected=%d, want 0 (optimistic guard failed)", affected)
	}

	// Sanity: the row should still hold 'updated' (the stale write was rejected, not
	// partially applied). This proves the WHERE clause is real, not a fake stub.
	//
	// Use Execute (not ExecuteStreaming + FetchNext) for the sanity read: Execute returns
	// *QueryResult with Rows already materialized, while ExecuteStreaming opens a fresh
	// streaming cursor that FetchNext would have to drain. Mixing both on the same
	// driver works but adds noise — for a one-row read, Execute is the right primitive.
	res, err := s.Driver.Execute(context.Background(), `SELECT name FROM t WHERE id = 1`)
	if err != nil {
		t.Fatalf("re-read: %v", err)
	}
	if len(res.Rows) != 1 || len(res.Rows[0]) != 1 {
		t.Fatalf("unexpected row shape after stale update: %v", res.Rows)
	}
	if res.Rows[0][0] != "updated" {
		t.Errorf("row was overwritten despite stale oldValue: got %v, want \"updated\"", res.Rows[0][0])
	}
}
