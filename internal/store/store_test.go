package store

import (
	"path/filepath"
	"testing"

	"wisp/internal/sshtunnel"
	"wisp/internal/vault"
)

func TestStoreQueryHistoryPagedAndClear(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "test_store.db")
	v, err := vault.NewWithKey(make([]byte, 32))
	if err != nil {
		t.Fatalf("vault.NewWithKey failed: %v", err)
	}

	st, err := Open(dbPath, v)
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	defer st.Close()

	connID, err := st.SaveConnection("Test Conn", "sqlite", dbPath)
	if err != nil {
		t.Fatalf("SaveConnection failed: %v", err)
	}

	// Insert 5 queries
	queries := []string{
		"SELECT * FROM users;",
		"SELECT id, name FROM users WHERE active = 1;",
		"INSERT INTO users (name) VALUES ('Alice');",
		"UPDATE users SET active = 0 WHERE id = 1;",
		"DELETE FROM users WHERE id = 2;",
	}

	for _, q := range queries {
		id, err := st.RecordQuery(connID, "tab-1", q, "ok", 12, 1)
		if err != nil {
			t.Fatalf("RecordQuery failed: %v", err)
		}
		if id == 0 {
			t.Fatalf("Expected non-zero history ID")
		}
		_ = st.FinishQuery(id, "ok", 1)
	}

	t.Run("Paging without search", func(t *testing.T) {
		entries, total, err := st.GetQueryHistoryPaged("", 2, 0)
		if err != nil {
			t.Fatalf("GetQueryHistoryPaged failed: %v", err)
		}
		if total != 5 {
			t.Errorf("Expected total 5, got %d", total)
		}
		if len(entries) != 2 {
			t.Errorf("Expected 2 entries, got %d", len(entries))
		}
		// Most recent first: "DELETE FROM users WHERE id = 2;"
		if entries[0].QueryText != "DELETE FROM users WHERE id = 2;" {
			t.Errorf("Expected newest query first, got %q", entries[0].QueryText)
		}

		// Second page
		entries2, total2, err := st.GetQueryHistoryPaged("", 2, 2)
		if err != nil {
			t.Fatalf("GetQueryHistoryPaged page 2 failed: %v", err)
		}
		if total2 != 5 {
			t.Errorf("Expected total 5, got %d", total2)
		}
		if len(entries2) != 2 {
			t.Errorf("Expected 2 entries on page 2, got %d", len(entries2))
		}
	})

	t.Run("Search filtering", func(t *testing.T) {
		entries, total, err := st.GetQueryHistoryPaged("WHERE", 10, 0)
		if err != nil {
			t.Fatalf("GetQueryHistoryPaged search failed: %v", err)
		}
		// 3 queries have "WHERE"
		if total != 3 {
			t.Errorf("Expected 3 matches for WHERE, got %d", total)
		}
		if len(entries) != 3 {
			t.Errorf("Expected 3 entries returned, got %d", len(entries))
		}

		entriesNone, totalNone, err := st.GetQueryHistoryPaged("NON_EXISTENT_KEYWORD", 10, 0)
		if err != nil {
			t.Fatalf("GetQueryHistoryPaged non-existent failed: %v", err)
		}
		if totalNone != 0 || len(entriesNone) != 0 {
			t.Errorf("Expected 0 matches, got total=%d len=%d", totalNone, len(entriesNone))
		}
	})

	t.Run("Clear history", func(t *testing.T) {
		if err := st.ClearQueryHistory(); err != nil {
			t.Fatalf("ClearQueryHistory failed: %v", err)
		}
		entries, total, err := st.GetQueryHistoryPaged("", 10, 0)
		if err != nil {
			t.Fatalf("GetQueryHistoryPaged post clear failed: %v", err)
		}
		if total != 0 || len(entries) != 0 {
			t.Errorf("Expected 0 history after clear, got total=%d, len=%d", total, len(entries))
		}
	})
}

func TestStoreSaveAndResolveConnectionWithSSH(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "test_store_ssh.db")
	v, err := vault.NewWithKey(make([]byte, 32))
	if err != nil {
		t.Fatalf("vault.NewWithKey failed: %v", err)
	}

	st, err := Open(dbPath, v)
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	defer st.Close()

	// 1. Plain connection without SSH
	plainID, err := st.SaveConnection("Plain Conn", "postgres", "postgres://user:pass@localhost:5432/db")
	if err != nil {
		t.Fatalf("SaveConnection failed: %v", err)
	}

	driver1, dsn1, ssh1, err := st.ResolveConnectionWithSSH(plainID)
	if err != nil {
		t.Fatalf("ResolveConnectionWithSSH failed for plain conn: %v", err)
	}
	if driver1 != "postgres" || dsn1 != "postgres://user:pass@localhost:5432/db" {
		t.Fatalf("Unexpected resolved values: driver=%q dsn=%q", driver1, dsn1)
	}
	if ssh1 != nil {
		t.Fatalf("Expected nil SSH config for plain conn, got: %+v", ssh1)
	}

	// 2. Connection with SSH config
	sshCfg := &sshtunnel.SSHConfig{
		Enabled:       true,
		Host:          "bastion.prod.internal",
		Port:          2222,
		User:          "ops",
		AuthMethod:    "key_file",
		KeyPath:       "/home/ops/.ssh/id_ed25519",
		KeyPassphrase: "secretpassphrase",
	}
	sshID, err := st.SaveConnectionWithSSH("SSH Conn", "postgres", "postgres://user:pass@db.internal:5432/proddb", sshCfg)
	if err != nil {
		t.Fatalf("SaveConnectionWithSSH failed: %v", err)
	}

	// Test ResolveConnection (backward compatibility)
	driver2a, dsn2a, err := st.ResolveConnection(sshID)
	if err != nil {
		t.Fatalf("ResolveConnection failed for SSH conn: %v", err)
	}
	if driver2a != "postgres" || dsn2a != "postgres://user:pass@db.internal:5432/proddb" {
		t.Fatalf("ResolveConnection legacy returned unexpected driver=%q dsn=%q", driver2a, dsn2a)
	}

	// Test ResolveConnectionWithSSH
	driver2b, dsn2b, ssh2, err := st.ResolveConnectionWithSSH(sshID)
	if err != nil {
		t.Fatalf("ResolveConnectionWithSSH failed: %v", err)
	}
	if driver2b != "postgres" || dsn2b != "postgres://user:pass@db.internal:5432/proddb" {
		t.Fatalf("Unexpected resolved driver/dsn: driver=%q dsn=%q", driver2b, dsn2b)
	}
	if ssh2 == nil || !ssh2.Enabled || ssh2.Host != "bastion.prod.internal" || ssh2.Port != 2222 || ssh2.User != "ops" || ssh2.KeyPath != "/home/ops/.ssh/id_ed25519" || ssh2.KeyPassphrase != "secretpassphrase" {
		t.Fatalf("Unexpected resolved SSH config: %+v", ssh2)
	}
}
