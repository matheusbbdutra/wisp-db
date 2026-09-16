// Package store implements Wisp's local persistence (saved connections, query history,
// and schema cache) in a single SQLite file via modernc.org/sqlite (pure Go, no CGO).
// See docs/adr/0003-storage.md.
//
// Credentials are never written in plaintext: the full DSN goes through internal/vault
// (ChaCha20-Poly1305, key in the OS keychain) before reaching disk. A pragmatic decision
// (not originally documented in ADR 0003): instead of decomposing the DSN into
// host/port/user/password per dialect — driver-specific work with no real benefit in the
// MVP — we store the entire DSN encrypted in encrypted_secret. Revisit if any dialect
// needs individual field editing (e.g. changing only the password) without retyping
// everything.
package store

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"

	"wisp/internal/vault"
)

const schema = `
CREATE TABLE IF NOT EXISTS connections (
	id               TEXT PRIMARY KEY,
	name             TEXT NOT NULL,
	driver           TEXT NOT NULL,
	encrypted_secret BLOB NOT NULL,
	created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS query_history (
	id            INTEGER PRIMARY KEY AUTOINCREMENT,
	connection_id TEXT NOT NULL REFERENCES connections(id),
	tab_id        TEXT NOT NULL,
	query_text    TEXT NOT NULL,
	executed_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
	duration_ms   INTEGER,
	status        TEXT,
	row_count     INTEGER
);

CREATE TABLE IF NOT EXISTS schema_cache (
	cache_key       TEXT PRIMARY KEY,
	catalog_json    TEXT NOT NULL,
	fetched_at      DATETIME NOT NULL,
	ttl_expires_at  DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS saved_scripts (
	id         TEXT PRIMARY KEY,
	name       TEXT NOT NULL,
	query_text TEXT NOT NULL,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`

// SavedConnection is the representation exposed to the frontend — it never includes the
// decrypted DSN/secret, only what is needed to list and select.
type SavedConnection struct {
	ID        string
	Name      string
	Driver    string
	CreatedAt time.Time
}

// SavedScript is a named SQL script that can be edited and reopened (unlike history,
// which is an automatic execution log).
type SavedScript struct {
	ID        string
	Name      string
	QueryText string
	CreatedAt time.Time
	UpdatedAt time.Time
}

// QueryHistoryEntry is an execution recorded in query_history.
type QueryHistoryEntry struct {
	ID           int64
	ConnectionID string
	TabID        string
	QueryText    string
	Status       string
	DurationMs   int64
	RowCount     int
	ExecutedAt   time.Time
}

// Store encapsulates the *sql.DB for Wisp's local file and the Vault used to
// encrypt/decrypt saved DSNs.
type Store struct {
	db    *sql.DB
	vault *vault.Vault
}

// Open opens (creating if necessary) the SQLite file at path and applies the schema.
func Open(path string, v *vault.Vault) (*Store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("abrindo store em %q: %w", path, err)
	}
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("aplicando schema: %w", err)
	}
	return &Store{db: db, vault: v}, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

// SaveConnection encrypts dsn and saves a new named connection. It returns the generated
// id.
func (s *Store) SaveConnection(name, driver, dsn string) (string, error) {
	ciphertext, err := s.vault.Encrypt(dsn)
	if err != nil {
		return "", fmt.Errorf("cifrando dsn: %w", err)
	}

	id := uuid.NewString()
	_, err = s.db.Exec(
		`INSERT INTO connections (id, name, driver, encrypted_secret) VALUES (?, ?, ?, ?)`,
		id, name, driver, ciphertext,
	)
	if err != nil {
		return "", fmt.Errorf("gravando conexão: %w", err)
	}
	return id, nil
}

// ListConnections returns saved connections without decrypting the DSN.
func (s *Store) ListConnections() ([]SavedConnection, error) {
	rows, err := s.db.Query(`SELECT id, name, driver, created_at FROM connections ORDER BY created_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("listando conexões: %w", err)
	}
	defer rows.Close()

	var result []SavedConnection
	for rows.Next() {
		var c SavedConnection
		if err := rows.Scan(&c.ID, &c.Name, &c.Driver, &c.CreatedAt); err != nil {
			return nil, err
		}
		result = append(result, c)
	}
	return result, rows.Err()
}

// ResolveConnection decrypts a saved connection's DSN — it should only be called when
// actually connecting, never for display in the UI.
func (s *Store) ResolveConnection(id string) (driver string, dsn string, err error) {
	var ciphertext []byte
	err = s.db.QueryRow(`SELECT driver, encrypted_secret FROM connections WHERE id = ?`, id).
		Scan(&driver, &ciphertext)
	if err != nil {
		return "", "", fmt.Errorf("buscando conexão %q: %w", id, err)
	}

	dsn, err = s.vault.Decrypt(ciphertext)
	if err != nil {
		return "", "", fmt.Errorf("decifrando dsn da conexão %q: %w", id, err)
	}
	return driver, dsn, nil
}

// DeleteConnection removes a saved connection.
func (s *Store) DeleteConnection(id string) error {
	_, err := s.db.Exec(`DELETE FROM connections WHERE id = ?`, id)
	return err
}

// RecordQuery records an execution in query_history. An empty connectionID means the
// active session is not associated with a saved connection (Connect directly via DSN) —
// since connection_id is NOT NULL with an FK to connections(id), nothing is inserted in
// this case and nil is returned without error. RecordQuery returns the inserted row id
// (0 if nothing was inserted because connectionID was empty) — used by FinishQuery to
// update the actual row total after the streaming cursor is exhausted (see
// App.FetchRows).
func (s *Store) RecordQuery(connectionID, tabID, queryText, status string, durationMs int64, rowCount int) (int64, error) {
	if connectionID == "" {
		return 0, nil
	}
	res, err := s.db.Exec(
		`INSERT INTO query_history (connection_id, tab_id, query_text, duration_ms, status, row_count) VALUES (?, ?, ?, ?, ?, ?)`,
		connectionID, tabID, queryText, durationMs, status, rowCount,
	)
	if err != nil {
		return 0, fmt.Errorf("gravando histórico de query: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("obtendo id do histórico: %w", err)
	}
	return id, nil
}

// FinishQuery updates status and row_count of an entry already written by RecordQuery —
// used when the result is fetched in streaming mode (see App.FetchRows) and the row
// total is only known after the initial fetch (or when the cursor is exhausted / errors
// midway through). id == 0 is treated as a no-op (RecordQuery returns 0 when it writes
// nothing).
func (s *Store) FinishQuery(id int64, status string, rowCount int) error {
	if id == 0 {
		return nil
	}
	_, err := s.db.Exec(
		`UPDATE query_history SET status = ?, row_count = ? WHERE id = ?`,
		status, rowCount, id,
	)
	if err != nil {
		return fmt.Errorf("atualizando histórico de query %d: %w", id, err)
	}
	return nil
}

// ListQueryHistory returns the last N history entries, newest to oldest.
func (s *Store) ListQueryHistory(limit int) ([]QueryHistoryEntry, error) {
	rows, err := s.db.Query(
		`SELECT id, connection_id, tab_id, query_text, executed_at, duration_ms, status, row_count FROM query_history ORDER BY executed_at DESC LIMIT ?`,
		limit,
	)
	if err != nil {
		return nil, fmt.Errorf("listando histórico de queries: %w", err)
	}
	defer rows.Close()

	var result []QueryHistoryEntry
	for rows.Next() {
		var e QueryHistoryEntry
		if err := rows.Scan(&e.ID, &e.ConnectionID, &e.TabID, &e.QueryText, &e.ExecutedAt, &e.DurationMs, &e.Status, &e.RowCount); err != nil {
			return nil, err
		}
		result = append(result, e)
	}
	return result, rows.Err()
}

// SaveScript saves a new named SQL script. It returns the generated id.
func (s *Store) SaveScript(name, queryText string) (string, error) {
	id := uuid.NewString()
	_, err := s.db.Exec(
		`INSERT INTO saved_scripts (id, name, query_text) VALUES (?, ?, ?)`,
		id, name, queryText,
	)
	if err != nil {
		return "", fmt.Errorf("gravando script: %w", err)
	}
	return id, nil
}

// ListScripts returns saved scripts, from most recently updated to oldest.
func (s *Store) ListScripts() ([]SavedScript, error) {
	rows, err := s.db.Query(`SELECT id, name, query_text, created_at, updated_at FROM saved_scripts ORDER BY updated_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("listando scripts: %w", err)
	}
	defer rows.Close()

	var result []SavedScript
	for rows.Next() {
		var sc SavedScript
		if err := rows.Scan(&sc.ID, &sc.Name, &sc.QueryText, &sc.CreatedAt, &sc.UpdatedAt); err != nil {
			return nil, err
		}
		result = append(result, sc)
	}
	return result, rows.Err()
}

// UpdateScript overwrites the name and/or text of an existing script.
func (s *Store) UpdateScript(id, name, queryText string) error {
	res, err := s.db.Exec(
		`UPDATE saved_scripts SET name = ?, query_text = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
		name, queryText, id,
	)
	if err != nil {
		return fmt.Errorf("atualizando script %q: %w", id, err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("script %q não encontrado", id)
	}
	return nil
}

// DeleteScript permanently removes a saved script.
func (s *Store) DeleteScript(id string) error {
	_, err := s.db.Exec(`DELETE FROM saved_scripts WHERE id = ?`, id)
	return err
}

// GetSchemaCacheJSON, SetSchemaCacheJSON and DeleteSchemaCacheJSON implement the
// persistent schema cache layer (see internal/schemacache.Cache — this Store
// structurally satisfies schemacache.PersistentStore, with no direct import between
// packages). cacheKey is never the plaintext DSN — it is a hash calculated by the caller
// (see schemacache.Key).
func (s *Store) GetSchemaCacheJSON(cacheKey string) (catalogJSON string, found bool, err error) {
	var ttlExpiresAt time.Time
	err = s.db.QueryRow(
		`SELECT catalog_json, ttl_expires_at FROM schema_cache WHERE cache_key = ?`, cacheKey,
	).Scan(&catalogJSON, &ttlExpiresAt)
	if err == sql.ErrNoRows {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("lendo schema cache: %w", err)
	}
	if time.Now().After(ttlExpiresAt) {
		return "", false, nil
	}
	return catalogJSON, true, nil
}

func (s *Store) SetSchemaCacheJSON(cacheKey string, catalogJSON string, ttl time.Duration) error {
	now := time.Now()
	_, err := s.db.Exec(
		`INSERT INTO schema_cache (cache_key, catalog_json, fetched_at, ttl_expires_at) VALUES (?, ?, ?, ?)
		 ON CONFLICT(cache_key) DO UPDATE SET catalog_json = excluded.catalog_json, fetched_at = excluded.fetched_at, ttl_expires_at = excluded.ttl_expires_at`,
		cacheKey, catalogJSON, now, now.Add(ttl),
	)
	if err != nil {
		return fmt.Errorf("gravando schema cache: %w", err)
	}
	return nil
}

func (s *Store) DeleteSchemaCacheJSON(cacheKey string) error {
	_, err := s.db.Exec(`DELETE FROM schema_cache WHERE cache_key = ?`, cacheKey)
	return err
}
