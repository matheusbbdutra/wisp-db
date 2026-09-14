package db

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"

	_ "modernc.org/sqlite"
)

// SQLiteDriver implementa DatabaseDriver para arquivos SQLite locais
// (modernc.org/sqlite, puro Go — ver docs/adr/0002-cgo-policy.md).
type SQLiteDriver struct {
	conn *sql.Conn
	pool *sql.DB
}

func NewSQLiteDriver() *SQLiteDriver {
	return &SQLiteDriver{}
}

// Connect exige que o arquivo já exista — o driver subjacente (database/sql
// + modernc.org/sqlite) cria silenciosamente um banco novo vazio se o
// caminho não existir, o que faz "Conectar" a um caminho errado parecer
// bem-sucedido e só falhar depois, de forma confusa (ex.: "no such table"),
// em vez de avisar na hora. ":memory:" é a exceção óbvia (não é arquivo).
func (d *SQLiteDriver) Connect(ctx context.Context, dsn string) error {
	if dsn != ":memory:" {
		path := dsn
		if idx := strings.IndexByte(path, '?'); idx >= 0 {
			path = path[:idx]
		}
		if _, err := os.Stat(path); err != nil {
			if os.IsNotExist(err) {
				return fmt.Errorf("arquivo sqlite não encontrado: %s", path)
			}
			return fmt.Errorf("verificando arquivo sqlite %q: %w", path, err)
		}
	}

	pool, err := sql.Open("sqlite", dsn)
	if err != nil {
		return fmt.Errorf("abrindo sqlite %q: %w", dsn, err)
	}
	conn, err := pool.Conn(ctx)
	if err != nil {
		pool.Close()
		return fmt.Errorf("obtendo conexão sqlite: %w", err)
	}
	d.pool = pool
	d.conn = conn
	return nil
}

func (d *SQLiteDriver) Close() error {
	if d.conn != nil {
		d.conn.Close()
	}
	if d.pool != nil {
		return d.pool.Close()
	}
	return nil
}

func (d *SQLiteDriver) Execute(ctx context.Context, query string) (*QueryResult, error) {
	rows, err := d.conn.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("executando query: %w", err)
	}
	defer rows.Close()
	return scanRows(rows)
}

// CancelRunningQuery: SQLite é embutido e single-file — não há cancelamento
// nativo de servidor remoto. O ctx cancelado (Session Manager) já interrompe
// a chamada local, que é o único mecanismo aplicável aqui.
func (d *SQLiteDriver) CancelRunningQuery(ctx context.Context) error {
	return nil
}

func (d *SQLiteDriver) ListSchemas(ctx context.Context) ([]string, error) {
	// SQLite não tem conceito de schema múltiplo por padrão (fora ATTACH).
	return []string{"main"}, nil
}

func (d *SQLiteDriver) ListTables(ctx context.Context, schema string) ([]Table, error) {
	rows, err := d.conn.QueryContext(ctx,
		`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
	if err != nil {
		return nil, fmt.Errorf("listando tabelas: %w", err)
	}
	defer rows.Close()

	var tables []Table
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		tables = append(tables, Table{Schema: "main", Name: name})
	}
	return tables, rows.Err()
}

// Introspect usa PRAGMA table_xinfo, que expõe a coluna "hidden": 2 e 3
// identificam colunas geradas (virtual/stored) desde o SQLite 3.31 — é o que
// alimenta IsGenerated para a checagem de segurança de edição inline
// (docs/adr/0004-inline-edit-safety.md).
func (d *SQLiteDriver) Introspect(ctx context.Context, schema, table string) (*Table, error) {
	rows, err := d.conn.QueryContext(ctx, fmt.Sprintf(`PRAGMA table_xinfo(%q)`, table))
	if err != nil {
		return nil, fmt.Errorf("introspectando tabela %q: %w", table, err)
	}
	defer rows.Close()

	result := &Table{Schema: "main", Name: table}
	for rows.Next() {
		var cid, notNull, pk, hidden int
		var name, colType string
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &colType, &notNull, &dflt, &pk, &hidden); err != nil {
			return nil, err
		}
		result.Columns = append(result.Columns, Column{
			Name:         name,
			Type:         colType,
			IsPrimaryKey: pk > 0,
			IsGenerated:  hidden == 2 || hidden == 3,
			Nullable:     notNull == 0,
		})
	}
	return result, rows.Err()
}

// scanRows converte um *sql.Rows genérico no formato de transporte comum
// {columns, types, rows} usado por todos os drivers.
func scanRows(rows *sql.Rows) (*QueryResult, error) {
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	colTypes, err := rows.ColumnTypes()
	if err != nil {
		return nil, err
	}

	types := make([]string, len(colTypes))
	for i, ct := range colTypes {
		types[i] = ct.DatabaseTypeName()
	}

	result := &QueryResult{Columns: columns, Types: types}
	for rows.Next() {
		values := make([]any, len(columns))
		pointers := make([]any, len(columns))
		for i := range values {
			pointers[i] = &values[i]
		}
		if err := rows.Scan(pointers...); err != nil {
			return nil, err
		}
		result.Rows = append(result.Rows, values)
	}
	return result, rows.Err()
}
