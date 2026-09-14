// Package store implementa a persistência local do Wisp (conexões salvas,
// histórico de queries e cache de schema) em um único arquivo SQLite via
// modernc.org/sqlite (puro Go, sem CGO). Ver docs/adr/0003-storage.md.
//
// Credenciais nunca são gravadas em texto puro: a DSN completa passa pelo
// internal/vault (ChaCha20-Poly1305, chave no keychain do SO) antes de
// chegar ao disco. Decisão pragmática (não documentada originalmente no
// ADR 0003): em vez de decompor a DSN em host/port/user/senha por dialeto
// — trabalho específico por driver sem ganho real no MVP — guardamos a DSN
// inteira cifrada em encrypted_secret. Reabrir se algum dialeto precisar de
// edição de campo individual (ex. trocar só a senha) sem redigitar tudo.
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
	connection_id   TEXT PRIMARY KEY REFERENCES connections(id),
	catalog_json    TEXT NOT NULL,
	fetched_at      DATETIME NOT NULL,
	ttl_expires_at  DATETIME NOT NULL
);
`

// SavedConnection é a representação exposta ao frontend — nunca inclui a
// DSN/segredo decifrado, só o necessário para listar e escolher.
type SavedConnection struct {
	ID        string
	Name      string
	Driver    string
	CreatedAt time.Time
}

// Store encapsula o *sql.DB do arquivo local do Wisp e o Vault usado para
// cifrar/decifrar as DSNs salvas.
type Store struct {
	db    *sql.DB
	vault *vault.Vault
}

// Open abre (criando se necessário) o arquivo SQLite em path e aplica o schema.
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

// SaveConnection cifra dsn e grava uma nova conexão nomeada. Retorna o id gerado.
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

// ListConnections retorna as conexões salvas sem decifrar a DSN.
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

// ResolveConnection decifra a DSN de uma conexão salva — só deve ser chamado
// no momento de conectar de fato, nunca para exibição na UI.
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

// DeleteConnection remove uma conexão salva.
func (s *Store) DeleteConnection(id string) error {
	_, err := s.db.Exec(`DELETE FROM connections WHERE id = ?`, id)
	return err
}
