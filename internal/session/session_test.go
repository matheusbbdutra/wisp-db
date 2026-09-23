package session

import (
	"context"
	"os"
	"testing"
	"time"

	"wisp/internal/db"
)

// newTestDriver abre um SQLiteDriver real (arquivo temporário) como o
// db.DatabaseDriver de teste — nunca interface mockada.
func newTestDriver(t *testing.T) *db.SQLiteDriver {
	t.Helper()
	f, err := os.CreateTemp(t.TempDir(), "wisp-session-test-*.db")
	if err != nil {
		t.Fatalf("criando arquivo temporário: %v", err)
	}
	path := f.Name()
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}

	d := db.NewSQLiteDriver()
	if err := d.Connect(context.Background(), path); err != nil {
		t.Fatalf("conectando sqlite temporário: %v", err)
	}
	t.Cleanup(func() {
		if err := d.Close(); err != nil {
			t.Error(err)
		}
	})
	return d
}

func TestOpenMesmoTabIdCancelaSessaoAnterior(t *testing.T) {
	m := NewManager()
	t.Cleanup(func() {
		if err := m.Close("tab1"); err != nil {
			t.Error(err)
		}
	})

	d1 := newTestDriver(t)
	ctx1, err := m.Open("tab1", d1, d1, "k1", "")
	if err != nil {
		t.Fatalf("primeiro Open: %v", err)
	}

	d2 := newTestDriver(t)
	defer d2.Close()
	if _, err := m.Open("tab1", d2, d2, "k1", ""); err != nil {
		t.Fatalf("segundo Open: %v", err)
	}

	select {
	case <-ctx1.Done():
		// Esperado: a primeira sessão foi cancelada.
	default:
		t.Fatal("Ctx da primeira sessão não foi cancelado após segundo Open com mesmo tabId")
	}
}

func TestGetTabIdInexistenteRetornaErro(t *testing.T) {
	m := NewManager()
	t.Cleanup(func() {
		if err := m.Close("tab1"); err != nil {
			t.Error(err)
		}
	})
	if _, err := m.Get("inexistente"); err == nil {
		t.Fatal("esperava erro para tabId inexistente")
	}
}

func TestCloseIdempotente(t *testing.T) {
	m := NewManager()
	t.Cleanup(func() {
		if err := m.Close("tab1"); err != nil {
			t.Error(err)
		}
	})
	d := newTestDriver(t)
	if _, err := m.Open("tab1", d, d, "k1", ""); err != nil {
		t.Fatalf("Open: %v", err)
	}
	if err := m.Close("tab1"); err != nil {
		t.Fatalf("primeiro Close: %v", err)
	}
	// Segunda chamada não deve panicar nem dar erro inesperado.
	// (Manager não tem Disconnect — Close é o único encerramento; segunda
	// chamada é no-op que retorna nil.)
	if err := m.Close("tab1"); err != nil {
		t.Fatalf("segundo Close deveria ser idempotente: %v", err)
	}
}

func TestManagerCancelSQLiteQuery(t *testing.T) {
	m := NewManager()
	t.Cleanup(func() {
		_ = m.Close("tab1")
	})

	d := newTestDriver(t)
	if _, err := m.Open("tab1", d, d, "k1", ""); err != nil {
		t.Fatalf("Open: %v", err)
	}

	qctx, err := m.StartQuery("tab1")
	if err != nil {
		t.Fatalf("StartQuery: %v", err)
	}

	errCh := make(chan error, 1)
	go func() {
		slowQuery := `WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt) SELECT count(*) FROM cnt`
		_, err := d.Execute(qctx, slowQuery)
		errCh <- err
	}()

	// Allow query to start
	time.Sleep(20 * time.Millisecond)
	cancelCtx := context.Background()
	if err := m.Cancel(cancelCtx, "tab1"); err != nil {
		t.Fatalf("Cancel: %v", err)
	}

	select {
	case err := <-errCh:
		if err == nil {
			t.Fatal("query should have failed with cancellation error")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("query did not cancel within 2 seconds")
	}

	// Verify tab session is still open and can run subsequent queries
	res, err := d.Execute(context.Background(), `SELECT 1`)
	if err != nil {
		t.Fatalf("subsequent query failed: %v", err)
	}
	if len(res.Rows) != 1 {
		t.Fatalf("unexpected result: %+v", res)
	}
}

func TestSessionMetadataAndDialect(t *testing.T) {
	// Test DialectForDriver normalization
	if d := DialectForDriver("mysql"); d != "mysql" {
		t.Fatalf("expected mysql, got %s", d)
	}
	if d := DialectForDriver("mariadb"); d != "mysql" {
		t.Fatalf("expected mysql, got %s", d)
	}
	if d := DialectForDriver("sqlite"); d != "sqlite" {
		t.Fatalf("expected sqlite, got %s", d)
	}
	if d := DialectForDriver("postgres"); d != "postgres" {
		t.Fatalf("expected postgres, got %s", d)
	}
	if d := DialectForDriver("unknown"); d != "postgres" {
		t.Fatalf("expected postgres, got %s", d)
	}

	m := NewManager()
	t.Cleanup(func() {
		_ = m.Close("tab-meta")
	})

	d := newTestDriver(t)
	initialMeta := SessionMetadata{
		TabID:   "tab-meta",
		Driver:  "sqlite",
		Dialect: "sqlite",
	}

	if _, err := m.Open("tab-meta", d, d, "k1", "", initialMeta); err != nil {
		t.Fatalf("Open: %v", err)
	}

	meta, err := m.GetMetadata("tab-meta")
	if err != nil {
		t.Fatalf("GetMetadata: %v", err)
	}
	if meta.Driver != "sqlite" || meta.Dialect != "sqlite" {
		t.Fatalf("unexpected metadata: %+v", meta)
	}

	// Update metadata (e.g. after querying version)
	meta.ServerVersion = "SQLite 3.45.1"
	if err := m.SetMetadata("tab-meta", meta); err != nil {
		t.Fatalf("SetMetadata: %v", err)
	}

	updated, err := m.GetMetadata("tab-meta")
	if err != nil {
		t.Fatalf("GetMetadata after update: %v", err)
	}
	if updated.ServerVersion != "SQLite 3.45.1" {
		t.Fatalf("expected version SQLite 3.45.1, got %s", updated.ServerVersion)
	}
}
