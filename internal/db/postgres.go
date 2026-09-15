package db

import (
	"context"
	"fmt"
	"strings"

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

// UpdateCell executa um UPDATE parametrizado de uma única célula com
// checagem otimista de concorrência (WHERE pk = $n AND coluna_antiga = $n,
// ver docs/adr/0004-inline-edit-safety.md). Placeholders $1..$n nativos do
// protocolo Postgres; valores sempre como argumento — nunca concatenados.
func (d *PostgresDriver) UpdateCell(ctx context.Context, schema, table string, pkColumns []string, pkValues []any, column string, oldValue any, newValue any) (int64, error) {
	if schema == "" || schema == "main" {
		schema = "public"
	}
	query, args, err := buildUpdateCellQuery("$", schema, table, pkColumns, pkValues, column, oldValue, newValue)
	if err != nil {
		return 0, err
	}
	tag, err := d.conn.Exec(ctx, query, args...)
	if err != nil {
		return 0, fmt.Errorf("atualizando célula de %s.%s: %w", schema, table, err)
	}
	return tag.RowsAffected(), nil
}

// TableDDL reconstrói o CREATE TABLE a partir do catálogo, pois o Postgres
// NÃO tem "SHOW CREATE TABLE" nativo: colunas via information_schema.columns
// (ordenadas por ordinal_position) + constraints via pg_get_constraintdef(oid)
// filtrando conrelid pelo oid da tabela (pg_class/pg_namespace).
// Escopo v1 (gap conhecido): colunas + constraints. Índices
// (pg_indexes.indexdef) ficam de fora — documentado como limitação, não
// implementado silenciosamente incompleto.
func (d *PostgresDriver) TableDDL(ctx context.Context, schema, table string) (string, error) {
	if schema == "" || schema == "main" {
		schema = "public"
	}
	colRows, err := d.conn.Query(ctx, `
		SELECT column_name, data_type, udt_name, character_maximum_length,
		       is_nullable = 'YES', column_default,
		       is_generated = 'ALWAYS', generation_expression
		FROM information_schema.columns
		WHERE table_schema = $1 AND table_name = $2
		ORDER BY ordinal_position`, schema, table)
	if err != nil {
		return "", fmt.Errorf("lendo colunas de %s.%s: %w", schema, table, err)
	}
	defer colRows.Close()

	var defs []string
	found := false
	for colRows.Next() {
		var name, dataType, udtName string
		var maxLen *int
		var nullable, generated bool
		var dflt, genExpr *string
		if err := colRows.Scan(&name, &dataType, &udtName, &maxLen, &nullable, &dflt, &generated, &genExpr); err != nil {
			return "", err
		}
		found = true
		colType := resolveColumnType(dataType, udtName, maxLen)
		def := fmt.Sprintf("  %s %s", quoteIdentPG(name), colType)
		if generated && genExpr != nil {
			// Coluna gerada (STORED — Postgres não suporta VIRTUAL): sem a
			// expressão, a reconstrução perderia a geração e criaria uma
			// coluna normal (bug real encontrado testando contra Postgres
			// real, ver memória wisp-table-schema-tab-context-canceled-fix).
			def += fmt.Sprintf(" GENERATED ALWAYS AS (%s) STORED", *genExpr)
		} else {
			if !nullable {
				def += " NOT NULL"
			}
			if dflt != nil && *dflt != "" {
				def += " DEFAULT " + *dflt
			}
		}
		defs = append(defs, def)
	}
	if err := colRows.Err(); err != nil {
		return "", err
	}
	if !found {
		return "", fmt.Errorf("tabela %s.%s não encontrada", schema, table)
	}

	conRows, err := d.conn.Query(ctx, `
		SELECT c.conname, pg_get_constraintdef(c.oid)
		FROM pg_constraint c
		JOIN pg_class t ON t.oid = c.conrelid
		JOIN pg_namespace n ON n.oid = t.relnamespace
		WHERE n.nspname = $1 AND t.relname = $2
		ORDER BY c.oid`, schema, table)
	if err != nil {
		return "", fmt.Errorf("lendo constraints de %s.%s: %w", schema, table, err)
	}
	defer conRows.Close()

	for conRows.Next() {
		var conname, condef string
		if err := conRows.Scan(&conname, &condef); err != nil {
			return "", err
		}
		defs = append(defs, fmt.Sprintf("  CONSTRAINT %s %s", quoteIdentPG(conname), condef))
	}
	if err := conRows.Err(); err != nil {
		return "", err
	}

	ddl := fmt.Sprintf("CREATE TABLE %s.%s (\n%s\n);",
		quoteIdentPG(schema), quoteIdentPG(table), strings.Join(defs, ",\n"))
	return ddl, nil
}

// ListTriggers retorna triggers de usuário da tabela via pg_trigger +
// pg_get_triggerdef(oid), excluindo tgisinternal (triggers internos de FK
// não são "triggers do usuário").
func (d *PostgresDriver) ListTriggers(ctx context.Context, schema, table string) ([]Trigger, error) {
	if schema == "" || schema == "main" {
		schema = "public"
	}
	rows, err := d.conn.Query(ctx, `
		SELECT t.tgname, pg_get_triggerdef(t.oid)
		FROM pg_trigger t
		JOIN pg_class c ON c.oid = t.tgrelid
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = $1 AND c.relname = $2 AND NOT t.tgisinternal
		ORDER BY t.tgname`, schema, table)
	if err != nil {
		return nil, fmt.Errorf("listando triggers de %s.%s: %w", schema, table, err)
	}
	defer rows.Close()

	var triggers []Trigger
	for rows.Next() {
		var trg Trigger
		if err := rows.Scan(&trg.Name, &trg.Definition); err != nil {
			return nil, err
		}
		triggers = append(triggers, trg)
	}
	return triggers, rows.Err()
}

// ListFunctions retorna funções do schema via pg_proc + pg_get_functiondef,
// só prokind = 'f' (funções normais — exclui agregados/window).
func (d *PostgresDriver) ListFunctions(ctx context.Context, schema string) ([]Function, error) {
	if schema == "" || schema == "main" {
		schema = "public"
	}
	rows, err := d.conn.Query(ctx, `
		SELECT p.proname, pg_get_functiondef(p.oid)
		FROM pg_proc p
		JOIN pg_namespace n ON n.oid = p.pronamespace
		WHERE n.nspname = $1 AND p.prokind = 'f'
		ORDER BY p.proname`, schema)
	if err != nil {
		return nil, fmt.Errorf("listando funções de %q: %w", schema, err)
	}
	defer rows.Close()

	var functions []Function
	for rows.Next() {
		var fn Function
		if err := rows.Scan(&fn.Name, &fn.Definition); err != nil {
			return nil, err
		}
		functions = append(functions, fn)
	}
	return functions, rows.Err()
}

// quoteIdentPG quota um identificador Postgres com aspas duplas, escapando
// aspas internas por duplicação — evita injeção via nome de schema/tabela.
func quoteIdentPG(ident string) string {
	return `"` + strings.ReplaceAll(ident, `"`, `""`) + `"`
}

// resolveColumnType mapeia o trio data_type/udt_name/character_maximum_length
// do information_schema para um tipo exibível no DDL reconstruído.
func resolveColumnType(dataType, udtName string, maxLen *int) string {
	switch dataType {
	case "character varying":
		if maxLen != nil {
			return fmt.Sprintf("character varying(%d)", *maxLen)
		}
		return "character varying"
	case "character":
		if maxLen != nil {
			return fmt.Sprintf("character(%d)", *maxLen)
		}
		return "character"
	case "USER-DEFINED":
		return udtName
	default:
		return dataType
	}
}
