package db

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

// binaryColumnMask marks which fields are bytea (by column index) — these MUST NOT
// become strings in normalizeRow (see normalizeRowSkipping), otherwise genuine binary
// bytes become irrecoverable garbage when passed through string() (a real bug found
// during code review).
func binaryColumnMask(fields []pgconn.FieldDescription) []bool {
	mask := make([]bool, len(fields))
	for i, f := range fields {
		mask[i] = f.DataTypeOID == pgtype.ByteaOID
	}
	return mask
}

// PostgresDriver implements DatabaseDriver via pgx (pure Go, native protocol — no CGO).
// One instance = one dedicated connection for a tab (never shared, see
// internal/session).
type PostgresDriver struct {
	conn   *pgx.Conn
	cursor pgx.Rows // cursor opened by ExecuteStreaming, see FetchNext/CloseCursor
	// cursorBinaryCols marks which columns of the open cursor are bytea (by column index) —
	// see normalizeRow/binaryColumnMask, both in driver.go.
	cursorBinaryCols []bool
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
	// closePendingCursor (not plain CloseCursor) — for the same reason described in
	// closePendingCursor: without canceling first, disconnecting during a large query
	// without LIMIT would hang here, draining everything before closing.
	if d.conn != nil {
		d.closePendingCursor(context.Background())
	}
	if d.conn == nil {
		return nil
	}
	return d.conn.Close(context.Background())
}

func (d *PostgresDriver) Execute(ctx context.Context, query string) (*QueryResult, error) {
	// Close a pending streaming cursor (ExecuteStreaming/FetchNext) before reusing the
	// connection — pgx rejects a new query with "conn busy" while rows from a previous
	// query are not exhausted/closed.
	d.closePendingCursor(ctx)
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
	binary := binaryColumnMask(fields)

	for rows.Next() {
		values, err := rows.Values()
		if err != nil {
			return nil, err
		}
		result.Rows = append(result.Rows, normalizeRowSkipping(values, binary))
	}
	return result, rows.Err()
}

// ExecuteStreaming starts the query and returns only column metadata — rows are fetched
// on demand via FetchNext (see docs/ARCHITECTURE.md, "Data Grid Virtualizado" and the
// user's request for real pagination instead of loading everything at once).
func (d *PostgresDriver) ExecuteStreaming(ctx context.Context, query string) ([]string, []string, error) {
	d.closePendingCursor(ctx)

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
	d.cursorBinaryCols = binaryColumnMask(fields)
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
		result = append(result, normalizeRowSkipping(values, d.cursorBinaryCols))
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

// closePendingCursor closes an unexhausted streaming cursor by telling the server to
// STOP producing rows before closing.
//
// Root cause of a real production bug (user switching queries while a previous large
// query without LIMIT still had hasMore=true, "tab stuck in the queue"): our "cursor" is
// not a real server cursor — pgx is already receiving the entire result over the
// network, with FetchNext only consuming what has arrived a little at a time.
// rows.Close() (called by CloseCursor) synchronously READS AND DISCARDS ALL remaining
// rows from the socket until the command completes on the server (see
// pgconn.ResultReader.Close, "for !rr.commandConcluded") — on a large table without
// LIMIT this hangs for a long time. Sending CancelRequest first makes the server abort
// the running query, so the subsequent drain is fast (cancellation error) instead of
// continuing to push millions of rows just to discard them.
func (d *PostgresDriver) closePendingCursor(ctx context.Context) {
	if d.cursor == nil {
		return
	}
	_ = d.conn.PgConn().CancelRequest(ctx)
	d.CloseCursor()
}

// CancelRunningQuery triggers native Postgres protocol cancellation (CancelRequest on an
// auxiliary connection) — this ensures that "stop" in the tab actually terminates the
// query on the server, not just locally (see CLAUDE.md, "Isolamento de sessão").
func (d *PostgresDriver) CancelRunningQuery(ctx context.Context) error {
	if d.conn == nil {
		return nil
	}
	return d.conn.PgConn().CancelRequest(ctx)
}

func (d *PostgresDriver) ListSchemas(ctx context.Context) ([]string, error) {
	// See the comment in Execute about "conn busy" with an open streaming cursor.
	d.closePendingCursor(ctx)
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
	// See the comment in Execute about "conn busy" with an open streaming cursor.
	d.closePendingCursor(ctx)
	rows, err := d.conn.Query(ctx,
		`SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name`, schema)
	if err != nil {
		return nil, fmt.Errorf("listando tabelas de %q: %w", schema, err)
	}
	defer rows.Close()

	var tables []Table
	for rows.Next() {
		var name, tableType string
		if err := rows.Scan(&name, &tableType); err != nil {
			return nil, err
		}
		tables = append(tables, Table{Schema: schema, Name: name, Kind: tableKindFromPG(tableType)})
	}
	return tables, rows.Err()
}

// tableKindFromPG translates information_schema table_type into the Kind exposed in the
// UI ("table"/"view") — views do not support UpdateCell/inline editing. Materialized
// views do not appear in information_schema.tables (they are in pg_matviews); out of
// scope here, a known, unimplemented gap.
func tableKindFromPG(tableType string) string {
	if tableType == "VIEW" {
		return "view"
	}
	return "table"
}

// Introspect joins information_schema.columns (type/nullable/generated) with
// table_constraints/key_column_usage (real PK) — never using column-name heuristics, as
// specified in docs/adr/0004-inline-edit-safety.md.
func (d *PostgresDriver) Introspect(ctx context.Context, schema, table string) (*Table, error) {
	// See the comment in Execute about "conn busy" with an open streaming cursor.
	d.closePendingCursor(ctx)
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

// IntrospectSchema is the batched equivalent of Introspect for an entire schema: the
// same information_schema.columns + table_constraints/key_column_usage join as
// Introspect, but WITHOUT the table_name filter — a single query retrieves columns for
// all tables in the schema, avoiding N round-trips (see the comment on the
// DatabaseDriver interface).
func (d *PostgresDriver) IntrospectSchema(ctx context.Context, schema string) ([]Table, error) {
	// See the comment in Execute about "conn busy" with an open streaming cursor.
	d.closePendingCursor(ctx)
	rows, err := d.conn.Query(ctx, `
		SELECT c.table_name, t.table_type, c.column_name, c.data_type, c.is_nullable = 'YES', c.is_generated = 'ALWAYS',
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
		JOIN information_schema.tables t
		  ON t.table_schema = c.table_schema AND t.table_name = c.table_name
		WHERE c.table_schema = $1
		ORDER BY c.table_name, c.ordinal_position`, schema)
	if err != nil {
		return nil, fmt.Errorf("introspectando schema %s: %w", schema, err)
	}
	defer rows.Close()

	order := []string{}
	byTable := map[string]*Table{}
	for rows.Next() {
		var tableName, tableType string
		var col Column
		if err := rows.Scan(&tableName, &tableType, &col.Name, &col.Type, &col.Nullable, &col.IsGenerated, &col.IsPrimaryKey); err != nil {
			return nil, err
		}
		t, ok := byTable[tableName]
		if !ok {
			t = &Table{Schema: schema, Name: tableName, Kind: tableKindFromPG(tableType)}
			byTable[tableName] = t
			order = append(order, tableName)
		}
		t.Columns = append(t.Columns, col)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	result := make([]Table, 0, len(order))
	for _, name := range order {
		result = append(result, *byTable[name])
	}
	return result, nil
}

// UpdateCell executes a parameterized UPDATE of a single cell with optimistic
// concurrency checking (WHERE pk = $n AND coluna_antiga = $n, see
// docs/adr/0004-inline-edit-safety.md). Native Postgres protocol placeholders $1..$n;
// values are always passed as arguments — never concatenated.
func (d *PostgresDriver) UpdateCell(ctx context.Context, schema, table string, pkColumns []string, pkValues []any, column string, oldValue any, newValue any) (int64, error) {
	if schema == "" || schema == "main" {
		schema = "public"
	}
	query, args, err := buildUpdateCellQuery("$", schema, table, pkColumns, pkValues, column, oldValue, newValue)
	if err != nil {
		return 0, err
	}
	// See the comment in Execute about "conn busy" with an open streaming cursor.
	d.closePendingCursor(ctx)
	tag, err := d.conn.Exec(ctx, query, args...)
	if err != nil {
		return 0, fmt.Errorf("atualizando célula de %s.%s: %w", schema, table, err)
	}
	return tag.RowsAffected(), nil
}

// InsertRow executes a parameterized INSERT with an explicit column list.
func (d *PostgresDriver) InsertRow(ctx context.Context, schema, table string, columns []string, values []any) error {
	if schema == "" || schema == "main" {
		schema = "public"
	}
	query, args, err := buildInsertRowQuery("$", schema, table, columns, values)
	if err != nil {
		return err
	}
	// See the comment in Execute about "conn busy" with an open streaming cursor.
	d.closePendingCursor(ctx)
	if _, err := d.conn.Exec(ctx, query, args...); err != nil {
		return fmt.Errorf("inserindo linha em %s.%s: %w", schema, table, err)
	}
	return nil
}

// DeleteRow executes a parameterized DELETE by real PK.
func (d *PostgresDriver) DeleteRow(ctx context.Context, schema, table string, pkColumns []string, pkValues []any) (int64, error) {
	if schema == "" || schema == "main" {
		schema = "public"
	}
	query, args, err := buildDeleteRowQuery("$", schema, table, pkColumns, pkValues)
	if err != nil {
		return 0, err
	}
	// See the comment in Execute about "conn busy" with an open streaming cursor.
	d.closePendingCursor(ctx)
	tag, err := d.conn.Exec(ctx, query, args...)
	if err != nil {
		return 0, fmt.Errorf("apagando linha de %s.%s: %w", schema, table, err)
	}
	return tag.RowsAffected(), nil
}

// TableDDL reconstructs CREATE TABLE from the catalog, since Postgres has NO native
// "SHOW CREATE TABLE": columns via information_schema.columns (ordered by
// ordinal_position) + constraints via pg_get_constraintdef(oid), filtering conrelid by
// the table's oid (pg_class/pg_namespace). V1 scope (known gap): columns + constraints.
// Indexes (pg_indexes.indexdef) are left out — documented as a limitation, not silently
// implemented incompletely.
func (d *PostgresDriver) TableDDL(ctx context.Context, schema, table string) (string, error) {
	if schema == "" || schema == "main" {
		schema = "public"
	}
	// See the comment in Execute about "conn busy" with an open streaming cursor.
	d.closePendingCursor(ctx)
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
			// Generated column (STORED — Postgres does not support VIRTUAL): without the
			// expression, reconstruction would lose generation and create a regular column (a
			// real bug found by testing against real Postgres, see memory
			// wisp-table-schema-tab-context-canceled-fix).
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

// ListTriggers returns the table's user triggers via pg_trigger +
// pg_get_triggerdef(oid), excluding tgisinternal (internal FK triggers are not "user
// triggers").
func (d *PostgresDriver) ListTriggers(ctx context.Context, schema, table string) ([]Trigger, error) {
	if schema == "" || schema == "main" {
		schema = "public"
	}
	// See the comment in Execute about "conn busy" with an open streaming cursor.
	d.closePendingCursor(ctx)
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

// ListFunctions returns schema functions via pg_proc + pg_get_functiondef, only prokind
// = 'f' (normal functions — excludes aggregates/window functions).
func (d *PostgresDriver) ListFunctions(ctx context.Context, schema string) ([]Function, error) {
	if schema == "" || schema == "main" {
		schema = "public"
	}
	// See the comment in Execute about "conn busy" with an open streaming cursor.
	d.closePendingCursor(ctx)
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

// ListIndexes returns table indexes via pg_index + pg_get_indexdef, excluding the
// backing index of a PK/UNIQUE constraint (already included in TableDDL via CONSTRAINT)
// — criteria: indisprimary always excludes, and conrelid/conindid via pg_constraint also
// excludes the UNIQUE index, leaving only "real" indexes (explicit CREATE INDEX).
func (d *PostgresDriver) ListIndexes(ctx context.Context, schema, table string) ([]Index, error) {
	if schema == "" || schema == "main" {
		schema = "public"
	}
	// See the comment in Execute about "conn busy" with an open streaming cursor.
	d.closePendingCursor(ctx)
	rows, err := d.conn.Query(ctx, `
		SELECT ic.relname, i.indisunique, pg_get_indexdef(i.indexrelid),
		       (SELECT array_agg(a.attname ORDER BY k.ordinality)
		        FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, ordinality)
		        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum)
		FROM pg_index i
		JOIN pg_class ic ON ic.oid = i.indexrelid
		JOIN pg_class tc ON tc.oid = i.indrelid
		JOIN pg_namespace n ON n.oid = tc.relnamespace
		WHERE n.nspname = $1 AND tc.relname = $2 AND NOT i.indisprimary
		  AND NOT EXISTS (
		      SELECT 1 FROM pg_constraint c
		      WHERE c.conindid = i.indexrelid AND c.contype = 'u'
		  )
		ORDER BY ic.relname`, schema, table)
	if err != nil {
		return nil, fmt.Errorf("listando índices de %s.%s: %w", schema, table, err)
	}
	defer rows.Close()

	var indexes []Index
	for rows.Next() {
		var idx Index
		if err := rows.Scan(&idx.Name, &idx.Unique, &idx.Definition, &idx.Columns); err != nil {
			return nil, err
		}
		indexes = append(indexes, idx)
	}
	return indexes, rows.Err()
}

// ListForeignKeys returns the table's outgoing FKs (the table itself is the source) via
// pg_constraint (contype = 'f') + pg_get_constraintdef.
func (d *PostgresDriver) ListForeignKeys(ctx context.Context, schema, table string) ([]ForeignKey, error) {
	if schema == "" || schema == "main" {
		schema = "public"
	}
	// See the comment in Execute about "conn busy" with an open streaming cursor.
	d.closePendingCursor(ctx)
	rows, err := d.conn.Query(ctx, `
		SELECT c.conname, pg_get_constraintdef(c.oid),
		       rn.nspname, rc.relname,
		       (SELECT array_agg(a.attname ORDER BY k.ordinality)
		        FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ordinality)
		        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum),
		       (SELECT array_agg(a.attname ORDER BY k.ordinality)
		        FROM unnest(c.confkey) WITH ORDINALITY AS k(attnum, ordinality)
		        JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum)
		FROM pg_constraint c
		JOIN pg_class t ON t.oid = c.conrelid
		JOIN pg_namespace n ON n.oid = t.relnamespace
		JOIN pg_class rc ON rc.oid = c.confrelid
		JOIN pg_namespace rn ON rn.oid = rc.relnamespace
		WHERE n.nspname = $1 AND t.relname = $2 AND c.contype = 'f'
		ORDER BY c.conname`, schema, table)
	if err != nil {
		return nil, fmt.Errorf("listando foreign keys de %s.%s: %w", schema, table, err)
	}
	defer rows.Close()

	var fks []ForeignKey
	for rows.Next() {
		var fk ForeignKey
		if err := rows.Scan(&fk.Name, &fk.Definition, &fk.RefSchema, &fk.RefTable, &fk.Columns, &fk.RefColumns); err != nil {
			return nil, err
		}
		fks = append(fks, fk)
	}
	return fks, rows.Err()
}

// quoteIdentPG quotes a Postgres identifier with double quotes, escaping internal quotes
// by doubling them — prevents injection through schema/table names.
func quoteIdentPG(ident string) string {
	return `"` + strings.ReplaceAll(ident, `"`, `""`) + `"`
}

// resolveColumnType maps the information_schema
// data_type/udt_name/character_maximum_length trio to a type suitable for display in the
// reconstructed DDL.
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
