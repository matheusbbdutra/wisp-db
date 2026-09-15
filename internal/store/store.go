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

// SavedConnection é a representação exposta ao frontend — nunca inclui a
// DSN/segredo decifrado, só o necessário para listar e escolher.
type SavedConnection struct {
	ID        string
	Name      string
	Driver    string
	CreatedAt time.Time
}

// SavedScript é um script SQL nomeado, editável e reaberto (diferente do
// histórico, que é log automático de execuções).
type SavedScript struct {
	ID        string
	Name      string
	QueryText string
	CreatedAt time.Time
	UpdatedAt time.Time
}

// QueryHistoryEntry é uma execução registrada em query_history.
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

// RecordQuery grava uma execução em query_history. Um connectionID vazio
// significa que a sessão ativa não está associada a nenhuma conexão salva
// (Connect direto por DSN) — como connection_id é NOT NULL com FK para
// connections(id), nesse caso nada é inserido e nil é retornado sem erro.
// RecordQuery retorna o id da linha inserida (0 se não inseriu, caso
// connectionID vazio) — usado por FinishQuery para atualizar o total real
// de linhas depois que o cursor em streaming se esgota (ver App.FetchRows).
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

// FinishQuery atualiza status e row_count de uma entrada já gravada por
// RecordQuery — usado quando o resultado é buscado em streaming (ver
// App.FetchRows) e o total de linhas só é conhecido depois do fetch inicial
// (ou quando o cursor se esgota / dá erro no meio do caminho). id == 0 é
// tratado como no-op (RecordQuery retorna 0 quando não grava nada).
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

// ListQueryHistory retorna as últimas N entradas do histórico, da mais
// recente para a mais antiga.
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

// SaveScript grava um novo script SQL nomeado. Retorna o id gerado.
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

// ListScripts retorna os scripts salvos, do mais recentemente atualizado
// para o mais antigo.
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

// UpdateScript sobrescreve nome e/ou texto de um script existente.
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

// DeleteScript remove um script salvo permanentemente.
func (s *Store) DeleteScript(id string) error {
	_, err := s.db.Exec(`DELETE FROM saved_scripts WHERE id = ?`, id)
	return err
}

// GetSchemaCacheJSON, SetSchemaCacheJSON e DeleteSchemaCacheJSON implementam
// a camada persistente do schema cache (ver internal/schemacache.Cache —
// este Store satisfaz schemacache.PersistentStore estruturalmente, sem
// import direto entre os pacotes). cacheKey nunca é a DSN em texto puro —
// é um hash calculado pelo chamador (ver schemacache.Key).
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
