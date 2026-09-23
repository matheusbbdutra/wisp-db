package db

import (
	"context"
	"database/sql"
	"fmt"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/go-sql-driver/mysql"
)

// MySQLDriver implements DatabaseDriver for MySQL 8.0+ and MariaDB 10.11+ via the
// go-sql-driver/mysql package (puro Go, MPL-2.0 — see docs/adr/0007-mysql-mariadb-driver.md).
//
// One pool (dataDB) is opened in Connect — a single reserved *sql.Conn is used for all
// query/cursor traffic per the Session Manager contract (one tab = one connection). Cancel
// strategy: CancelRunningQuery closes and reopens the *sql.Conn (the pool re-issues a fresh
// connection); any in-flight server-side query on the old connection is interrupted by the
// server when the TCP socket goes away.
//
// An earlier design attempted KILL QUERY <conn_id> via a separate control connection —
// that required SELECT CONNECTION_ID() on the data connection before each query, which
// conflicted with the subsequent query on the same *sql.Conn (only one statement can be
// in flight per *sql.Conn in database/sql). Reverting to the close+reopen path for now;
// KILL QUERY can be revisited via `multi-statement=true` or a non-reserved Conn if it
// becomes a UX problem (the only real cost is a few hundred ms of reconnect latency).
//
// MariaDB shares the wire protocol with MySQL, so the same driver handles both (see
// ADR 0007 — the factory maps both DriverMySQL and DriverMariaDB to NewMySQLDriver()).
// MariaDB-specific quirks (sequences, SHOW CREATE SEQUENCE) are out of scope for the MVP.
type MySQLDriver struct {
	dataDB   *sql.DB
	dataConn *sql.Conn

	cursor       *sql.Rows
	cursorBinary []bool

	dialer    Dialer
	customNet string

	mu sync.Mutex // protects Close + reopen race during cancel
}

func NewMySQLDriver() *MySQLDriver {
	return &MySQLDriver{}
}

// SetDialer configures a custom dialer (e.g. SSH tunnel) for outbound connections.
func (d *MySQLDriver) SetDialer(dialer Dialer) {
	d.dialer = dialer
}

// quoteIdentMySQL wraps an identifier in backticks (MySQL's identifier quote character),
// doubling any embedded backticks. Used in place of the sqlite/postgres quoteIdent because
// MySQL does not accept double quotes for identifiers by default.
func quoteIdentMySQL(s string) string {
	return "`" + strings.ReplaceAll(s, "`", "``") + "`"
}

// binaryColumnMaskMySQL marks columns whose declared type is binary — the same reason as
// binaryColumnMaskSQLite / binaryColumnMask in postgres.go: normalizeRowSkipping preserves
// []byte for these, so genuine binary columns stay base64-reversible in the JSON IPC payload
// instead of being mangled into U+FFFD by the generic []byte-to-string conversion.
func binaryColumnMaskMySQL(colTypes []*sql.ColumnType) []bool {
	mask := make([]bool, len(colTypes))
	binary := map[string]bool{
		"BLOB": true, "TINYBLOB": true, "MEDIUMBLOB": true, "LONGBLOB": true,
		"BINARY": true, "VARBINARY": true,
	}
	for i, ct := range colTypes {
		mask[i] = binary[strings.ToUpper(ct.DatabaseTypeName())]
	}
	return mask
}

// qualifyTableNameMySQL builds the schema-qualified table name with backtick-quoted
// identifiers. An empty schema yields just the quoted table name (MySQL allows it because
// the implicit schema is the current database; callers usually pass an explicit one).
func qualifyTableNameMySQL(schema, table string) string {
	if schema == "" {
		return quoteIdentMySQL(table)
	}
	return quoteIdentMySQL(schema) + "." + quoteIdentMySQL(table)
}

// Connect opens one pool against the DSN and reserves a *sql.Conn — the Session Manager
// contract is "one connection per tab". parseTime=true in the DSN is highly recommended
// (the modal always sets it as a default); without it, DATE/DATETIME columns arrive as
// []byte and the IPC bridge serializes them as base64 — unreadable in the grid.
func (d *MySQLDriver) Connect(ctx context.Context, dsn string) error {
	finalDSN := dsn
	if d.dialer != nil {
		netName := fmt.Sprintf("sshtun_%p_%d", d, time.Now().UnixNano())
		d.customNet = netName
		mysql.RegisterDialContext(netName, func(ctx context.Context, addr string) (net.Conn, error) {
			return d.dialer(ctx, "tcp", addr)
		})
		if strings.Contains(finalDSN, "@tcp(") {
			finalDSN = strings.Replace(finalDSN, "@tcp(", "@"+netName+"(", 1)
		}
	}

	dataPool, err := sql.Open("mysql", finalDSN)
	if err != nil {
		if d.customNet != "" {
			mysql.DeregisterDialContext(d.customNet)
			d.customNet = ""
		}
		return fmt.Errorf("abrindo pool mysql: %w", err)
	}
	// ADR 0023: pool hygiene — recycle connections that sit idle too long or have
	// been alive past the lifetime limit (covers VPN reconnects, DHCP renewals, NAT
	// timeouts). SetConnMaxIdleTime=0 is a no-op for database/sql (Go stdlib applies
	// it correctly); SetConnMaxLifetime=0 means no expiry, so non-zero values are
	// mandatory here.
	dataPool.SetConnMaxLifetime(DefaultConnMaxLifetime)
	dataPool.SetConnMaxIdleTime(DefaultConnMaxIdleTime)
	dataConn, err := dataPool.Conn(ctx)
	if err != nil {
		dataPool.Close()
		if d.customNet != "" {
			mysql.DeregisterDialContext(d.customNet)
			d.customNet = ""
		}
		return fmt.Errorf("obtendo conexão mysql: %w", err)
	}
	// ADR 0023: server-side execution timeout (MySQL 5.7.8+ / MariaDB 10.1.1+).
	// Defense-in-depth: native driver calls occasionally miss ctx propagation in
	// blocking code paths, so the server enforces the budget independently.
	if _, err := dataConn.ExecContext(ctx,
		fmt.Sprintf("SET SESSION MAX_EXECUTION_TIME = %d", int(DefaultQueryTimeout/time.Millisecond))); err != nil {
		_ = dataConn.Close()
		dataPool.Close()
		if d.customNet != "" {
			mysql.DeregisterDialContext(d.customNet)
			d.customNet = ""
		}
		return fmt.Errorf("configurando MAX_EXECUTION_TIME: %w", err)
	}
	d.dataDB = dataPool
	d.dataConn = dataConn
	return nil
}

func (d *MySQLDriver) Close() error {
	d.CloseCursor()
	var firstErr error
	if d.dataConn != nil {
		if err := d.dataConn.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
		d.dataConn = nil
	}
	if d.dataDB != nil {
		if err := d.dataDB.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
		d.dataDB = nil
	}
	if d.customNet != "" {
		mysql.DeregisterDialContext(d.customNet)
		d.customNet = ""
	}
	return firstErr
}

// Execute runs a query and returns the entire result (used for short queries / internal
// introspection). For interactive grids use ExecuteStreaming + FetchNext.
func (d *MySQLDriver) Execute(ctx context.Context, query string) (*QueryResult, error) {
	d.CloseCursor()
	rows, err := d.dataConn.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("executando query: %w", err)
	}
	defer rows.Close()
	return scanMySQLRows(rows)
}

// ExecuteStreaming starts a query and returns only the column metadata — paired with
// FetchNext/CloseCursor.
func (d *MySQLDriver) ExecuteStreaming(ctx context.Context, query string) ([]string, []string, error) {
	d.CloseCursor()

	rows, err := d.dataConn.QueryContext(ctx, query)
	if err != nil {
		return nil, nil, fmt.Errorf("executando query: %w", err)
	}

	columns, err := rows.Columns()
	if err != nil {
		rows.Close()
		return nil, nil, err
	}
	colTypes, err := rows.ColumnTypes()
	if err != nil {
		rows.Close()
		return nil, nil, err
	}
	types := make([]string, len(colTypes))
	for i, ct := range colTypes {
		types[i] = ct.DatabaseTypeName()
	}

	d.cursor = rows
	d.cursorBinary = binaryColumnMaskMySQL(colTypes)
	return columns, types, nil
}

// FetchNext returns up to n rows from the cursor opened by ExecuteStreaming. hasMore=false
// means the cursor is exhausted (and already closed internally).
func (d *MySQLDriver) FetchNext(ctx context.Context, n int) ([][]any, bool, error) {
	if d.cursor == nil {
		return nil, false, nil
	}

	columns, err := d.cursor.Columns()
	if err != nil {
		return nil, false, err
	}

	var result [][]any
	for len(result) < n {
		if !d.cursor.Next() {
			err := d.cursor.Err()
			d.cursor.Close()
			d.cursor = nil
			return result, false, err
		}
		values := make([]any, len(columns))
		pointers := make([]any, len(columns))
		for i := range values {
			pointers[i] = &values[i]
		}
		if err := d.cursor.Scan(pointers...); err != nil {
			return result, false, err
		}
		result = append(result, normalizeRowSkipping(values, d.cursorBinary))
	}
	return result, true, nil
}

func (d *MySQLDriver) CloseCursor() error {
	if d.cursor == nil {
		return nil
	}
	err := d.cursor.Close()
	d.cursor = nil
	return err
}

// CancelRunningQuery closes the data *sql.Conn and asks the pool for a fresh one —
// any in-flight server-side query on the old connection is interrupted when its TCP
// socket goes away. Always succeeds unless the pool itself is broken. Trade-off: a few
// hundred ms of reconnect latency vs. the simplicity of not having to track connection
// IDs. KILL QUERY could be layered on later via `multiStatements=true` or a non-reserved
// Conn if this becomes a UX problem.
func (d *MySQLDriver) CancelRunningQuery(ctx context.Context) error {
	d.CloseCursor()
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.dataConn == nil || d.dataDB == nil {
		return nil
	}
	if err := d.dataConn.Close(); err != nil {
		// Close already done — still try to reopen so the connection is recoverable.
		_ = err
	}
	newConn, err := d.dataDB.Conn(ctx)
	if err != nil {
		return fmt.Errorf("reabrindo dataConn após cancel: %w", err)
	}
	d.dataConn = newConn
	return nil
}

// --- Introspection ---

// ListSchemas returns user-visible databases (MySQL calls them "databases" — same concept
// as Postgres "schemas"). Excludes the system databases so the sidebar shows only what the
// user can actually query usefully.
func (d *MySQLDriver) ListSchemas(ctx context.Context) ([]string, error) {
	rows, err := d.dataConn.QueryContext(ctx, `
		SELECT schema_name FROM information_schema.schemata
		WHERE schema_name NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
		ORDER BY schema_name`)
	if err != nil {
		return nil, fmt.Errorf("listando databases: %w", err)
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

// ListTables returns tables and views in the given schema. Views are tagged so the UI
// can mark them as read-only (inline edit / INSERT/DELETE are gated on real tables).
func (d *MySQLDriver) ListTables(ctx context.Context, schema string) ([]Table, error) {
	rows, err := d.dataConn.QueryContext(ctx, `
		SELECT table_name, table_type
		FROM information_schema.tables
		WHERE table_schema = ?
		ORDER BY table_name`, schema)
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
		tables = append(tables, Table{Schema: schema, Name: name, Kind: tableKindFromMySQL(tableType)})
	}
	return tables, rows.Err()
}

func tableKindFromMySQL(tableType string) string {
	if tableType == "VIEW" || tableType == "SYSTEM VIEW" {
		return "view"
	}
	return "table"
}

// Introspect returns a single table's columns with PK detection — same pattern as the
// Postgres driver (information_schema join), adapted to MySQL's "extra" column which
// encodes generated/virtual columns differently from Postgres's is_generated.
func (d *MySQLDriver) Introspect(ctx context.Context, schema, table string) (*Table, error) {
	rows, err := d.dataConn.QueryContext(ctx, `
		SELECT c.column_name, c.data_type, c.is_nullable = 'YES',
		       c.extra LIKE '%GENERATED%',
		       EXISTS (
		           SELECT 1 FROM information_schema.key_column_usage kcu
		           JOIN information_schema.table_constraints tc
		             ON tc.constraint_name = kcu.constraint_name
		            AND tc.table_schema = kcu.table_schema
		           WHERE tc.constraint_type = 'PRIMARY KEY'
		             AND tc.table_schema = c.table_schema
		             AND tc.table_name = c.table_name
		             AND kcu.column_name = c.column_name
		       ) AS is_primary_key
		FROM information_schema.columns c
		WHERE c.table_schema = ? AND c.table_name = ?
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

// IntrospectSchema is the batched equivalent of Introspect for an entire schema — a
// single query retrieves columns for all tables, avoiding N round-trips (same rationale
// as PostgreSQL/MySQL IntrospectSchema).
func (d *MySQLDriver) IntrospectSchema(ctx context.Context, schema string) ([]Table, error) {
	rows, err := d.dataConn.QueryContext(ctx, `
		SELECT c.table_name, t.table_type, c.column_name, c.data_type, c.is_nullable = 'YES',
		       c.extra LIKE '%GENERATED%',
		       EXISTS (
		           SELECT 1 FROM information_schema.key_column_usage kcu
		           JOIN information_schema.table_constraints tc
		             ON tc.constraint_name = kcu.constraint_name
		            AND tc.table_schema = kcu.table_schema
		           WHERE tc.constraint_type = 'PRIMARY KEY'
		             AND tc.table_schema = c.table_schema
		             AND tc.table_name = c.table_name
		             AND kcu.column_name = c.column_name
		       ) AS is_primary_key
		FROM information_schema.columns c
		JOIN information_schema.tables t
		  ON t.table_schema = c.table_schema AND t.table_name = c.table_name
		WHERE c.table_schema = ?
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
			t = &Table{Schema: schema, Name: tableName, Kind: tableKindFromMySQL(tableType)}
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

// --- Write paths (UpdateCell, InsertRow, DeleteRow, ExecuteBatch) ---

// UpdateCell executes a parameterized UPDATE with optimistic concurrency checking
// (WHERE pk... AND coluna_antiga = ?, see docs/adr/0004-inline-edit-safety.md).
func (d *MySQLDriver) UpdateCell(ctx context.Context, schema, table string, pkColumns []string, pkValues []any, column string, oldValue any, newValue any) (int64, error) {
	query, args, err := buildUpdateCellQueryMySQL(schema, table, pkColumns, pkValues, column, oldValue, newValue)
	if err != nil {
		return 0, err
	}
	d.CloseCursor()
	res, err := d.dataConn.ExecContext(ctx, query, args...)
	if err != nil {
		return 0, fmt.Errorf("atualizando célula de %s.%s: %w", schema, table, err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("lendo rowsAffected de %s.%s: %w", schema, table, err)
	}
	return affected, nil
}

// InsertRow executes a parameterized INSERT with an explicit column list (never
// positional) — same security pattern as UpdateCell.
func (d *MySQLDriver) InsertRow(ctx context.Context, schema, table string, columns []string, values []any) error {
	query, args, err := buildInsertRowQueryMySQL(schema, table, columns, values)
	if err != nil {
		return err
	}
	d.CloseCursor()
	if _, err := d.dataConn.ExecContext(ctx, query, args...); err != nil {
		return fmt.Errorf("inserindo linha em %s.%s: %w", schema, table, err)
	}
	return nil
}

// DeleteRow executes a parameterized DELETE by real PK.
func (d *MySQLDriver) DeleteRow(ctx context.Context, schema, table string, pkColumns []string, pkValues []any) (int64, error) {
	query, args, err := buildDeleteRowQueryMySQL(schema, table, pkColumns, pkValues)
	if err != nil {
		return 0, err
	}
	d.CloseCursor()
	res, err := d.dataConn.ExecContext(ctx, query, args...)
	if err != nil {
		return 0, fmt.Errorf("apagando linha de %s.%s: %w", schema, table, err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("lendo rowsAffected de %s.%s: %w", schema, table, err)
	}
	return affected, nil
}

// ExecuteBatch runs every staged INSERT/DELETE inside a single transaction —
// all-or-nothing (see DatabaseDriver.ExecuteBatch).
func (d *MySQLDriver) ExecuteBatch(ctx context.Context, ops []BatchOp) error {
	d.CloseCursor()
	tx, err := d.dataConn.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("iniciando transação: %w", err)
	}
	for _, op := range ops {
		var query string
		var args []any
		switch op.Kind {
		case "insert":
			query, args, err = buildInsertRowQueryMySQL(op.Schema, op.Table, op.Columns, op.Values)
		case "delete":
			query, args, err = buildDeleteRowQueryMySQL(op.Schema, op.Table, op.PKColumns, op.PKValues)
		default:
			err = fmt.Errorf("tipo de operação desconhecido: %q", op.Kind)
		}
		if err != nil {
			tx.Rollback()
			return err
		}
		if _, err := tx.ExecContext(ctx, query, args...); err != nil {
			tx.Rollback()
			return fmt.Errorf("executando %s em %s.%s: %w", op.Kind, op.Schema, op.Table, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("confirmando transação: %w", err)
	}
	return nil
}

// ListIncomingForeignKeys lists FKs on OTHER tables that reference this table's columns
// (the reverse of ListForeignKeys). The join via referential_constraints is necessary to
// recover ON DELETE behavior — key_column_usage alone does not expose the rule.
// cross-schema: kcu.referenced_table_schema may differ from kcu.table_schema.
func (d *MySQLDriver) ListIncomingForeignKeys(ctx context.Context, schema, table string) ([]IncomingForeignKey, error) {
	rows, err := d.dataConn.QueryContext(ctx, `
		SELECT kcu.constraint_name,
		       kcu.table_schema AS from_schema,
		       kcu.table_name AS from_table,
		       kcu.column_name AS from_column,
		       kcu.referenced_column_name AS to_column,
		       rc.delete_rule
		FROM information_schema.key_column_usage kcu
		JOIN information_schema.referential_constraints rc
		  ON rc.constraint_schema = kcu.constraint_schema
		 AND rc.constraint_name  = kcu.constraint_name
		WHERE kcu.referenced_table_schema = ?
		  AND kcu.referenced_table_name   = ?
		ORDER BY kcu.constraint_name, kcu.ordinal_position`, schema, table)
	if err != nil {
		return nil, fmt.Errorf("listando incoming FKs de %s.%s: %w", schema, table, err)
	}
	defer rows.Close()

	order := []string{}
	byName := map[string]*IncomingForeignKey{}
	for rows.Next() {
		var name, fromSchema, fromTable, fromCol, toCol, deleteRule string
		if err := rows.Scan(&name, &fromSchema, &fromTable, &fromCol, &toCol, &deleteRule); err != nil {
			return nil, err
		}
		fk, ok := byName[name]
		if !ok {
			fk = &IncomingForeignKey{Name: name, FromSchema: fromSchema, FromTable: fromTable, OnDelete: deleteRule}
			byName[name] = fk
			order = append(order, name)
		}
		fk.FromColumns = append(fk.FromColumns, fromCol)
		fk.ToColumns = append(fk.ToColumns, toCol)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	result := make([]IncomingForeignKey, 0, len(order))
	for _, name := range order {
		result = append(result, *byName[name])
	}
	return result, nil
}

// --- DDL/introspection paths (TableDDL, Triggers, Functions, Indexes, FKs) ---

// TableDDL returns the verbatim CREATE TABLE statement via SHOW CREATE TABLE — much
// simpler than the Postgres path that reconstructs DDL from information_schema.
// SHOW CREATE TABLE always returns 2 columns: the table name and the DDL string.
func (d *MySQLDriver) TableDDL(ctx context.Context, schema, table string) (string, error) {
	var tableName, ddl string
	err := d.dataConn.QueryRowContext(ctx,
		fmt.Sprintf("SHOW CREATE TABLE %s", qualifyTableNameMySQL(schema, table))).Scan(&tableName, &ddl)
	if err != nil {
		return "", fmt.Errorf("buscando DDL de %s.%s: %w", schema, table, err)
	}
	return ddl, nil
}

// ListTriggers lists triggers defined on tables in the given schema, with their full DDL
// recovered via SHOW CREATE TRIGGER. Implementation note: trigger names are collected
// FIRST with the metadata rows fully drained and closed before issuing SHOW CREATE TRIGGER
// per name — a single *sql.Conn can only have one statement in flight, so running
// QueryRowContext while the SELECT cursor is still open returns "conn busy" / "bad
// connection" errors. SHOW CREATE TRIGGER returns 7 columns in MySQL 8+ / MariaDB 11+
// (Trigger, sql_mode, SQL Original Statement, character_set_client, collation_connection,
// Database Collation, Created) — the DDL is the 3rd column.
func (d *MySQLDriver) ListTriggers(ctx context.Context, schema, table string) ([]Trigger, error) {
	rows, err := d.dataConn.QueryContext(ctx, `
		SELECT trigger_name FROM information_schema.triggers
		WHERE trigger_schema = ? AND event_object_table = ?
		ORDER BY trigger_name`, schema, table)
	if err != nil {
		return nil, fmt.Errorf("listando triggers de %s.%s: %w", schema, table, err)
	}
	var names []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			rows.Close()
			return nil, err
		}
		names = append(names, name)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close() // libera a *sql.Conn antes das próximas queries

	var triggers []Trigger
	for _, name := range names {
		var (
			col1, col2, col3, col4, col5, col6, col7 sql.NullString
		)
		err := d.dataConn.QueryRowContext(ctx,
			fmt.Sprintf("SHOW CREATE TRIGGER %s", qualifyTableNameMySQL(schema, name))).
			Scan(&col1, &col2, &col3, &col4, &col5, &col6, &col7)
		if err != nil {
			return nil, fmt.Errorf("buscando DDL do trigger %s.%s: %w", schema, name, err)
		}
		triggers = append(triggers, Trigger{Name: name, Definition: col3.String})
	}
	return triggers, nil
}

// ListFunctions lists user-defined functions in the given schema. Uses
// information_schema.routines (compatible with both MySQL 8 and MariaDB 10.11+).
// Same cursor-drain-before-next-query pattern as ListTriggers — see comment there.
// SHOW CREATE FUNCTION returns 6 columns; the DDL is the 3rd ("Create Function").
func (d *MySQLDriver) ListFunctions(ctx context.Context, schema string) ([]Function, error) {
	rows, err := d.dataConn.QueryContext(ctx, `
		SELECT routine_name FROM information_schema.routines
		WHERE routine_schema = ? AND routine_type = 'FUNCTION'
		ORDER BY routine_name`, schema)
	if err != nil {
		return nil, fmt.Errorf("listando funções de %s: %w", schema, err)
	}
	var names []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			rows.Close()
			return nil, err
		}
		names = append(names, name)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	var fns []Function
	for _, name := range names {
		var (
			col1, col2, col3, col4, col5, col6 sql.NullString
		)
		err := d.dataConn.QueryRowContext(ctx,
			fmt.Sprintf("SHOW CREATE FUNCTION %s", qualifyTableNameMySQL(schema, name))).
			Scan(&col1, &col2, &col3, &col4, &col5, &col6)
		if err != nil {
			return nil, fmt.Errorf("buscando DDL da função %s.%s: %w", schema, name, err)
		}
		fns = append(fns, Function{Name: name, Definition: col3.String})
	}
	return fns, nil
}

// ListSequences: MySQL has no standalone user sequences — returns empty.
func (d *MySQLDriver) ListSequences(ctx context.Context, schema string) ([]Sequence, error) {
	return nil, nil
}

// ListIndexes lists indexes with their covered columns (in index order) and UNIQUE flag.
// Implementation note: SHOW INDEX FROM returns ONE ROW PER COLUMN — group by Key_name to
// recover the multi-column index definition.
func (d *MySQLDriver) ListIndexes(ctx context.Context, schema, table string) ([]Index, error) {
	rows, err := d.dataConn.QueryContext(ctx,
		fmt.Sprintf("SHOW INDEX FROM %s", qualifyTableNameMySQL(schema, table)))
	if err != nil {
		return nil, fmt.Errorf("listando índices de %s.%s: %w", schema, table, err)
	}
	defer rows.Close()

	type accum struct {
		columns    []string
		unique     bool
		definition string
	}
	order := []string{}
	byName := map[string]*accum{}
	for rows.Next() {
		// SHOW INDEX FROM returns 15 columns in MySQL 8+ (Visible and Expression added
		// since MySQL 5.7); 13 in older MariaDB variants. We always scan 15 — the last
		// two are nullable in MariaDB and the database/sql driver tolerates the type
		// mismatch silently.
		var (
			tableCol, keyName, columnName, collation, indexType string
			nonUnique                                          int
			seq                                                int64
			cardinality, subPart                               sql.NullInt64
			packed, nullCol, comment, indexComment             sql.NullString
			visible                                            sql.NullString
			expression                                         sql.NullString
		)
		if err := rows.Scan(&tableCol, &nonUnique, &keyName, &seq, &columnName, &collation, &cardinality, &subPart, &packed, &nullCol, &indexType, &comment, &indexComment, &visible, &expression); err != nil {
			return nil, fmt.Errorf("lendo linha de SHOW INDEX: %w", err)
		}
		a, ok := byName[keyName]
		if !ok {
			a = &accum{unique: nonUnique == 0}
			byName[keyName] = a
			order = append(order, keyName)
		}
		// seq is 1-based and increments per column within an index.
		for len(a.columns) < int(seq) {
			a.columns = append(a.columns, "")
		}
		a.columns[int(seq)-1] = columnName
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	result := make([]Index, 0, len(order))
	for _, name := range order {
		a := byName[name]
		// Best-effort DDL reconstruction — sufficient for the TableTab preview.
		unique := ""
		if a.unique {
			unique = "UNIQUE "
		}
		def := fmt.Sprintf("%sINDEX %s (%s)", unique, quoteIdentMySQL(name), joinQuotedMySQL(a.columns))
		result = append(result, Index{Name: name, Columns: a.columns, Unique: a.unique, Definition: def})
	}
	return result, nil
}

// ListForeignKeys lists outgoing FKs with full DDL recovered from information_schema.
func (d *MySQLDriver) ListForeignKeys(ctx context.Context, schema, table string) ([]ForeignKey, error) {
	rows, err := d.dataConn.QueryContext(ctx, `
		SELECT kcu.constraint_name, kcu.column_name,
		       kcu.referenced_table_schema, kcu.referenced_table_name, kcu.referenced_column_name,
		       rc.update_rule, rc.delete_rule
		FROM information_schema.key_column_usage kcu
		JOIN information_schema.referential_constraints rc
		  ON rc.constraint_schema = kcu.constraint_schema
		 AND rc.constraint_name  = kcu.constraint_name
		WHERE kcu.table_schema = ?
		  AND kcu.table_name   = ?
		  AND kcu.referenced_table_name IS NOT NULL
		ORDER BY kcu.constraint_name, kcu.ordinal_position`, schema, table)
	if err != nil {
		return nil, fmt.Errorf("listando FKs de %s.%s: %w", schema, table, err)
	}
	defer rows.Close()

	order := []string{}
	byName := map[string]*ForeignKey{}
	for rows.Next() {
		var name, column, refSchema, refTable, refColumn, updateRule, deleteRule string
		if err := rows.Scan(&name, &column, &refSchema, &refTable, &refColumn, &updateRule, &deleteRule); err != nil {
			return nil, err
		}
		fk, ok := byName[name]
		if !ok {
			fk = &ForeignKey{Name: name, RefSchema: refSchema, RefTable: refTable}
			byName[name] = fk
			order = append(order, name)
		}
		fk.Columns = append(fk.Columns, column)
		fk.RefColumns = append(fk.RefColumns, refColumn)
		// Store rules in the Definition for display — keeps the FK struct simple.
		if fk.Definition == "" {
			fk.Definition = fmt.Sprintf("FOREIGN KEY %s REFERENCES %s.%s ON UPDATE %s ON DELETE %s",
				quoteIdentMySQL(name), quoteIdentMySQL(refSchema), quoteIdentMySQL(refTable),
				updateRule, deleteRule)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	result := make([]ForeignKey, 0, len(order))
	for _, name := range order {
		result = append(result, *byName[name])
	}
	return result, nil
}

// --- Local builders (kept private to MySQL — the shared builders in sqlite.go use "?"
// for quoting, which is MySQL-incompatible; see ADR 0007) ---

func buildUpdateCellQueryMySQL(schema, table string, pkColumns []string, pkValues []any, column string, oldValue any, newValue any) (string, []any, error) {
	if table == "" {
		return "", nil, fmt.Errorf("tabela vazia")
	}
	if column == "" {
		return "", nil, fmt.Errorf("coluna vazia")
	}
	if len(pkColumns) == 0 {
		return "", nil, fmt.Errorf("sem colunas de chave primária para %q", table)
	}
	if len(pkColumns) != len(pkValues) {
		return "", nil, fmt.Errorf("pkColumns (%d) e pkValues (%d) divergem", len(pkColumns), len(pkValues))
	}

	args := []any{newValue}
	var where []string
	for i, pk := range pkColumns {
		if pk == "" {
			return "", nil, fmt.Errorf("nome de coluna de PK vazio")
		}
		if pkValues[i] == nil {
			where = append(where, quoteIdentMySQL(pk)+" IS NULL")
			continue
		}
		where = append(where, quoteIdentMySQL(pk)+" = ?")
		args = append(args, pkValues[i])
	}
	if oldValue == nil {
		where = append(where, quoteIdentMySQL(column)+" IS NULL")
	} else {
		where = append(where, quoteIdentMySQL(column)+" = ?")
		args = append(args, oldValue)
	}

	query := fmt.Sprintf("UPDATE %s SET %s = ? WHERE %s",
		qualifyTableNameMySQL(schema, table), quoteIdentMySQL(column), strings.Join(where, " AND "))
	return query, args, nil
}

func buildInsertRowQueryMySQL(schema, table string, columns []string, values []any) (string, []any, error) {
	if table == "" {
		return "", nil, fmt.Errorf("tabela vazia")
	}
	if len(columns) == 0 {
		return "", nil, fmt.Errorf("nenhuma coluna pra inserir em %q", table)
	}
	if len(columns) != len(values) {
		return "", nil, fmt.Errorf("columns (%d) e values (%d) divergem", len(columns), len(values))
	}

	quotedCols := make([]string, len(columns))
	placeholders := make([]string, len(columns))
	for i, col := range columns {
		if col == "" {
			return "", nil, fmt.Errorf("nome de coluna vazio")
		}
		quotedCols[i] = quoteIdentMySQL(col)
		placeholders[i] = "?"
	}
	query := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)",
		qualifyTableNameMySQL(schema, table), strings.Join(quotedCols, ", "), strings.Join(placeholders, ", "))
	return query, values, nil
}

func buildDeleteRowQueryMySQL(schema, table string, pkColumns []string, pkValues []any) (string, []any, error) {
	if table == "" {
		return "", nil, fmt.Errorf("tabela vazia")
	}
	if len(pkColumns) == 0 {
		return "", nil, fmt.Errorf("sem colunas de chave primária para %q", table)
	}
	if len(pkColumns) != len(pkValues) {
		return "", nil, fmt.Errorf("pkColumns (%d) e pkValues (%d) divergem", len(pkColumns), len(pkValues))
	}

	var where []string
	var args []any
	for i, pk := range pkColumns {
		if pk == "" {
			return "", nil, fmt.Errorf("nome de coluna de PK vazio")
		}
		if pkValues[i] == nil {
			where = append(where, quoteIdentMySQL(pk)+" IS NULL")
			continue
		}
		where = append(where, quoteIdentMySQL(pk)+" = ?")
		args = append(args, pkValues[i])
	}
	query := fmt.Sprintf("DELETE FROM %s WHERE %s",
		qualifyTableNameMySQL(schema, table), strings.Join(where, " AND "))
	return query, args, nil
}

// scanMySQLRows converts a generic *sql.Rows into the common transport format used by all
// drivers. Mirrors scanRows (sqlite.go) but uses binaryColumnMaskMySQL.
func scanMySQLRows(rows *sql.Rows) (*QueryResult, error) {
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
	binary := binaryColumnMaskMySQL(colTypes)
	for rows.Next() {
		values := make([]any, len(columns))
		pointers := make([]any, len(columns))
		for i := range values {
			pointers[i] = &values[i]
		}
		if err := rows.Scan(pointers...); err != nil {
			return nil, err
		}
		result.Rows = append(result.Rows, normalizeRowSkipping(values, binary))
	}
	return result, rows.Err()
}

func joinQuotedMySQL(cols []string) string {
	parts := make([]string, len(cols))
	for i, c := range cols {
		parts[i] = quoteIdentMySQL(c)
	}
	return strings.Join(parts, ", ")
}
