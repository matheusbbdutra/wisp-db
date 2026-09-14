package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// PostgresDriver implementa DatabaseDriver via pgx (puro Go, protocolo
// nativo — sem CGO). Uma instância = uma conexão dedicada de uma aba
// (nunca compartilhada, ver internal/session).
type PostgresDriver struct {
	conn   *pgx.Conn
	cursor pgx.Rows // cursor aberto por ExecuteStreaming, ver FetchNext/CloseCursor
}

func NewPostgresDriver() *PostgresDriver {
	return &PostgresDriver{}
}

func (d *PostgresDriver) Connect(ctx context.Context, dsn string) error {
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		return fmt.Errorf("conectando ao postgres: %w", err)
	}
	d.conn = conn
	return nil
}

func (d *PostgresDriver) Close() error {
	d.CloseCursor()
	if d.conn == nil {
		return nil
	}
	return d.conn.Close(context.Background())
}

func (d *PostgresDriver) Execute(ctx context.Context, query string) (*QueryResult, error) {
	rows, err := d.conn.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("executando query: %w", err)
	}
	defer rows.Close()

	fields := rows.FieldDescriptions()
	result := &QueryResult{
		Columns: make([]string, len(fields)),
		Types:   make([]string, len(fields)),
	}
	for i, f := range fields {
		result.Columns[i] = f.Name
		result.Types[i] = fmt.Sprintf("oid:%d", f.DataTypeOID)
	}

	for rows.Next() {
		values, err := rows.Values()
		if err != nil {
			return nil, err
		}
		result.Rows = append(result.Rows, values)
	}
	return result, rows.Err()
}

// ExecuteStreaming inicia a query e devolve só os metadados de coluna — as
// linhas são buscadas sob demanda via FetchNext (ver docs/ARCHITECTURE.md,
// "Data Grid Virtualizado" e o pedido do usuário de paginação real em vez
// de carregar tudo de uma vez).
func (d *PostgresDriver) ExecuteStreaming(ctx context.Context, query string) ([]string, []string, error) {
	d.CloseCursor()

	rows, err := d.conn.Query(ctx, query)
	if err != nil {
		return nil, nil, fmt.Errorf("executando query: %w", err)
	}

	fields := rows.FieldDescriptions()
	columns := make([]string, len(fields))
	types := make([]string, len(fields))
	for i, f := range fields {
		columns[i] = f.Name
		types[i] = fmt.Sprintf("oid:%d", f.DataTypeOID)
	}

	d.cursor = rows
	return columns, types, nil
}

func (d *PostgresDriver) FetchNext(ctx context.Context, n int) ([][]any, bool, error) {
	if d.cursor == nil {
		return nil, false, nil
	}

	var result [][]any
	for len(result) < n {
		if !d.cursor.Next() {
			err := d.cursor.Err()
			d.cursor.Close()
			d.cursor = nil
			return result, false, err
		}
		values, err := d.cursor.Values()
		if err != nil {
			return result, false, err
		}
		result = append(result, values)
	}
	return result, true, nil
}

func (d *PostgresDriver) CloseCursor() error {
	if d.cursor == nil {
		return nil
	}
	d.cursor.Close()
	d.cursor = nil
	return nil
}

// CancelRunningQuery dispara o cancelamento nativo do protocolo Postgres
// (CancelRequest em conexão auxiliar) — é o que garante que "stop" na aba
// realmente derruba a query no servidor, não só localmente (ver CLAUDE.md,
// "Isolamento de sessão").
func (d *PostgresDriver) CancelRunningQuery(ctx context.Context) error {
	if d.conn == nil {
		return nil
	}
	return d.conn.PgConn().CancelRequest(ctx)
}

func (d *PostgresDriver) ListSchemas(ctx context.Context) ([]string, error) {
	rows, err := d.conn.Query(ctx,
		`SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT LIKE 'pg\_%' AND schema_name != 'information_schema' ORDER BY schema_name`)
	if err != nil {
		return nil, fmt.Errorf("listando schemas: %w", err)
	}
	defer rows.Close()

	var schemas []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		schemas = append(schemas, name)
	}
	return schemas, rows.Err()
}

func (d *PostgresDriver) ListTables(ctx context.Context, schema string) ([]Table, error) {
	rows, err := d.conn.Query(ctx,
		`SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name`, schema)
	if err != nil {
		return nil, fmt.Errorf("listando tabelas de %q: %w", schema, err)
	}
	defer rows.Close()

	var tables []Table
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		tables = append(tables, Table{Schema: schema, Name: name})
	}
	return tables, rows.Err()
}

// Introspect cruza information_schema.columns (tipo/nullable/generated) com
// table_constraints/key_column_usage (PK real) — nunca heurística por nome
// de coluna, conforme docs/adr/0004-inline-edit-safety.md.
func (d *PostgresDriver) Introspect(ctx context.Context, schema, table string) (*Table, error) {
	rows, err := d.conn.Query(ctx, `
		SELECT c.column_name, c.data_type, c.is_nullable = 'YES', c.is_generated = 'ALWAYS',
		       EXISTS (
		           SELECT 1 FROM information_schema.table_constraints tc
		           JOIN information_schema.key_column_usage kcu
		             ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
		           WHERE tc.constraint_type = 'PRIMARY KEY'
		             AND tc.table_schema = c.table_schema
		             AND tc.table_name = c.table_name
		             AND kcu.column_name = c.column_name
		       ) AS is_primary_key
		FROM information_schema.columns c
		WHERE c.table_schema = $1 AND c.table_name = $2
		ORDER BY c.ordinal_position`, schema, table)
	if err != nil {
		return nil, fmt.Errorf("introspectando %s.%s: %w", schema, table, err)
	}
	defer rows.Close()

	result := &Table{Schema: schema, Name: table}
	for rows.Next() {
		var col Column
		if err := rows.Scan(&col.Name, &col.Type, &col.Nullable, &col.IsGenerated, &col.IsPrimaryKey); err != nil {
			return nil, err
		}
		result.Columns = append(result.Columns, col)
	}
	return result, rows.Err()
}
