package session

import (
	"context"
	"os"
	"testing"

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
	ctx1, err := m.Open("tab1", d1, "k1", "")
	if err != nil {
		t.Fatalf("primeiro Open: %v", err)
	}

	d2 := newTestDriver(t)
	defer d2.Close()
	if _, err := m.Open("tab1", d2, "k1", ""); err != nil {
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
	if _, err := m.Open("tab1", d, "k1", ""); err != nil {
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
