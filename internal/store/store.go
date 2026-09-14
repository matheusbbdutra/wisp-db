// Package store implementa a persistência local do Wisp (conexões salvas,
// histórico de queries e cache de schema) em um único arquivo SQLite via
// modernc.org/sqlite (puro Go, sem CGO). Ver docs/adr/0003-storage.md.
//
// Credenciais nunca são gravadas em texto puro: o campo encrypted_secret é
// cifrado antes de chegar aqui (ver Credential Vault, ainda não implementado).
package store

import (
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"
)

const schema = `
CREATE TABLE IF NOT EXISTS connections (
	id               TEXT PRIMARY KEY,
	name             TEXT NOT NULL,
	driver           TEXT NOT NULL,
	host             TEXT,
	port             INTEGER,
	database_name    TEXT,
	username         TEXT,
	encrypted_secret BLOB,
	ssh_tunnel_json  TEXT,
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
	connection_id   TEXT PRIMARY KEY REFERENCES connections(id),
	catalog_json    TEXT NOT NULL,
	fetched_at      DATETIME NOT NULL,
	ttl_expires_at  DATETIME NOT NULL
);
`

// Store encapsula o *sql.DB do arquivo local do Wisp.
type Store struct {
	db *sql.DB
}

// Open abre (criando se necessário) o arquivo SQLite em path e aplica o schema.
func Open(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("abrindo store em %q: %w", path, err)
	}
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("aplicando schema: %w", err)
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}
