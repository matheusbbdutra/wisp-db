package db

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"

	_ "modernc.org/sqlite"
)

// SQLiteDriver implements DatabaseDriver for local SQLite files (modernc.org/sqlite,
// pure Go — see docs/adr/0002-cgo-policy.md).
type SQLiteDriver struct {
	conn   *sql.Conn
	pool   *sql.DB
	cursor *sql.Rows // cursor opened by ExecuteStreaming, see FetchNext/CloseCursor
	// cursorBinaryCols marks BLOB columns in the open cursor — for the same reason as the
	// field of the same name in PostgresDriver (see normalizeRowSkipping).
	cursorBinaryCols []bool
}

// binaryColumnMaskSQLite marks columns whose declared type is BLOB (by index) — these
// must not become strings via normalizeRow (genuine binary bytes would become
// irrecoverable, for the same reason as bytea in Postgres).
func binaryColumnMaskSQLite(colTypes []*sql.ColumnType) []bool {
	mask := make([]bool, len(colTypes))
	for i, ct := range colTypes {
		mask[i] = ct.DatabaseTypeName() == "BLOB"
	}
	return mask
}

func NewSQLiteDriver() *SQLiteDriver {
	return &SQLiteDriver{}
}

// Connect requires the file to already exist — the underlying driver (database/sql +
// modernc.org/sqlite) silently creates a new empty database if the path does not exist,
// making "Connect" to an incorrect path appear successful, only to fail later in a
// confusing way (e.g. "no such table") instead of warning immediately. ":memory:" is the
// obvious exception (not a file).
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
	d.CloseCursor()
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

// ExecuteStreaming starts the query and returns only column metadata — rows are fetched
// on demand via FetchNext (see docs/ARCHITECTURE.md, "Data Grid Virtualizado" and the
// user's request for real pagination instead of loading everything at once).
func (d *SQLiteDriver) ExecuteStreaming(ctx context.Context, query string) ([]string, []string, error) {
	d.CloseCursor()

	rows, err := d.conn.QueryContext(ctx, query)
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
	d.cursorBinaryCols = binaryColumnMaskSQLite(colTypes)
	return columns, types, nil
}

func (d *SQLiteDriver) FetchNext(ctx context.Context, n int) ([][]any, bool, error) {
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
		result = append(result, normalizeRowSkipping(values, d.cursorBinaryCols))
	}
	return result, true, nil
}

func (d *SQLiteDriver) CloseCursor() error {
	if d.cursor == nil {
		return nil
	}
	err := d.cursor.Close()
	d.cursor = nil
	return err
}

// CancelRunningQuery: SQLite is embedded and single-file — there is no native remote
// server cancellation. The canceled ctx (Session Manager) already interrupts the local
// call, which is the only applicable mechanism here.
func (d *SQLiteDriver) CancelRunningQuery(ctx context.Context) error {
	return nil
}

func (d *SQLiteDriver) ListSchemas(ctx context.Context) ([]string, error) {
	// SQLite has no concept of multiple schemas by default (apart from ATTACH).
	return []string{"main"}, nil
}

func (d *SQLiteDriver) ListTables(ctx context.Context, schema string) ([]Table, error) {
	rows, err := d.conn.QueryContext(ctx,
		`SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name`)
	if err != nil {
		return nil, fmt.Errorf("listando tabelas: %w", err)
	}
	defer rows.Close()

	var tables []Table
	for rows.Next() {
		var name, kind string
		if err := rows.Scan(&name, &kind); err != nil {
			return nil, err
		}
		tables = append(tables, Table{Schema: "main", Name: name, Kind: kind})
	}
	return tables, rows.Err()
}

// Introspect uses PRAGMA table_xinfo, which exposes the "hidden" column: 2 and 3
// identify generated columns (virtual/stored) since SQLite 3.31 — this feeds IsGenerated
// for the inline-editing safety check (docs/adr/0004-inline-edit-safety.md).
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

// IntrospectSchema is the equivalent of Postgres IntrospectSchema, but the per-table
// loop remains here: SQLite is a local file (no network round-trip), so the N+1 cost
// that motivated the batched Postgres version does not exist here — there is no actual
// requirement to avoid the loop.
func (d *SQLiteDriver) IntrospectSchema(ctx context.Context, schema string) ([]Table, error) {
	tables, err := d.ListTables(ctx, schema)
	if err != nil {
		return nil, err
	}
	result := make([]Table, 0, len(tables))
	for _, t := range tables {
		full, err := d.Introspect(ctx, schema, t.Name)
		if err != nil {
			return nil, err
		}
		full.Kind = t.Kind
		result = append(result, *full)
	}
	return result, nil
}

// UpdateCell executes a parameterized UPDATE of a single cell with optimistic
// concurrency checking (WHERE pk = ? AND coluna_antiga = ?, see
// docs/adr/0004-inline-edit-safety.md). Native driver `?` placeholders; identifiers are
// quoted, values are always passed as arguments — never concatenated into SQL.
func (d *SQLiteDriver) UpdateCell(ctx context.Context, schema, table string, pkColumns []string, pkValues []any, column string, oldValue any, newValue any) (int64, error) {
	query, args, err := buildUpdateCellQuery("?", schema, table, pkColumns, pkValues, column, oldValue, newValue)
	if err != nil {
		return 0, err
	}
	res, err := d.conn.ExecContext(ctx, query, args...)
	if err != nil {
		return 0, fmt.Errorf("atualizando célula de %q: %w", table, err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("lendo linhas afetadas: %w", err)
	}
	return affected, nil
}

// InsertRow executes a parameterized INSERT with an explicit column list.
func (d *SQLiteDriver) InsertRow(ctx context.Context, schema, table string, columns []string, values []any) error {
	query, args, err := buildInsertRowQuery("?", schema, table, columns, values)
	if err != nil {
		return err
	}
	if _, err := d.conn.ExecContext(ctx, query, args...); err != nil {
		return fmt.Errorf("inserindo linha em %q: %w", table, err)
	}
	return nil
}

// DeleteRow executes a parameterized DELETE by real PK.
func (d *SQLiteDriver) DeleteRow(ctx context.Context, schema, table string, pkColumns []string, pkValues []any) (int64, error) {
	query, args, err := buildDeleteRowQuery("?", schema, table, pkColumns, pkValues)
	if err != nil {
		return 0, err
	}
	res, err := d.conn.ExecContext(ctx, query, args...)
	if err != nil {
		return 0, fmt.Errorf("apagando linha de %q: %w", table, err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("lendo linhas afetadas: %w", err)
	}
	return affected, nil
}

// ExecuteBatch runs every staged INSERT/DELETE inside a single sql.Tx on the tab's
// dedicated connection — all-or-nothing (see DatabaseDriver.ExecuteBatch).
func (d *SQLiteDriver) ExecuteBatch(ctx context.Context, ops []BatchOp) error {
	tx, err := d.conn.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("iniciando transação: %w", err)
	}
	for _, op := range ops {
		var query string
		var args []any
		switch op.Kind {
		case "insert":
			query, args, err = buildInsertRowQuery("?", op.Schema, op.Table, op.Columns, op.Values)
		case "delete":
			query, args, err = buildDeleteRowQuery("?", op.Schema, op.Table, op.PKColumns, op.PKValues)
		default:
			err = fmt.Errorf("tipo de operação desconhecido: %q", op.Kind)
		}
		if err != nil {
			tx.Rollback()
			return err
		}
		if _, err := tx.ExecContext(ctx, query, args...); err != nil {
			tx.Rollback()
			return fmt.Errorf("executando %s em %q: %w", op.Kind, op.Table, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("confirmando transação: %w", err)
	}
	return nil
}

// ListIncomingForeignKeys scans EVERY table in the database (SQLite has no reverse FK
// index) and keeps only the FKs whose ref table matches — there is no cheaper query
// available via PRAGMA. Databases with a very large number of tables pay an N+1 cost
// here; acceptable since this only runs once per batch-delete review, not per row.
func (d *SQLiteDriver) ListIncomingForeignKeys(ctx context.Context, schema, table string) ([]IncomingForeignKey, error) {
	tableRows, err := d.conn.QueryContext(ctx, `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
	if err != nil {
		return nil, fmt.Errorf("listando tabelas: %w", err)
	}
	var allTables []string
	for tableRows.Next() {
		var name string
		if err := tableRows.Scan(&name); err != nil {
			tableRows.Close()
			return nil, err
		}
		allTables = append(allTables, name)
	}
	if err := tableRows.Err(); err != nil {
		return nil, err
	}
	tableRows.Close()

	var result []IncomingForeignKey
	for _, fromTable := range allTables {
		fkRows, err := d.conn.QueryContext(ctx, fmt.Sprintf(`PRAGMA foreign_key_list(%q)`, fromTable))
		if err != nil {
			return nil, fmt.Errorf("listando foreign keys de %q: %w", fromTable, err)
		}
		byID := map[int]*IncomingForeignKey{}
		var order []int
		for fkRows.Next() {
			var id, seq int
			var refTable string
			var from, to sql.NullString
			var onUpdate, onDelete, match string
			if err := fkRows.Scan(&id, &seq, &refTable, &from, &to, &onUpdate, &onDelete, &match); err != nil {
				fkRows.Close()
				return nil, err
			}
			if refTable != table {
				continue
			}
			fk, ok := byID[id]
			if !ok {
				fk = &IncomingForeignKey{Name: fmt.Sprintf("fk_%d", id), FromSchema: "main", FromTable: fromTable, OnDelete: onDelete}
				byID[id] = fk
				order = append(order, id)
			}
			if from.Valid {
				fk.FromColumns = append(fk.FromColumns, from.String)
			}
			if to.Valid {
				fk.ToColumns = append(fk.ToColumns, to.String)
			}
		}
		if err := fkRows.Err(); err != nil {
			fkRows.Close()
			return nil, err
		}
		fkRows.Close()
		for _, id := range order {
			result = append(result, *byID[id])
		}
	}
	return result, nil
}

// TableDDL returns the original DDL stored in sqlite_master.sql — literal, without
// reconstruction (SQLite already persists CREATE TABLE verbatim).
func (d *SQLiteDriver) TableDDL(ctx context.Context, schema, table string) (string, error) {
	var ddl sql.NullString
	err := d.conn.QueryRowContext(ctx,
		`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`, table).Scan(&ddl)
	if err != nil {
		return "", fmt.Errorf("lendo DDL de %q: %w", table, err)
	}
	if !ddl.Valid {
		return "", fmt.Errorf("tabela %q não encontrada", table)
	}
	return ddl.String, nil
}

// ListTriggers lists table triggers via sqlite_master (name + sql).
func (d *SQLiteDriver) ListTriggers(ctx context.Context, schema, table string) ([]Trigger, error) {
	rows, err := d.conn.QueryContext(ctx,
		`SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ? ORDER BY name`, table)
	if err != nil {
		return nil, fmt.Errorf("listando triggers de %q: %w", table, err)
	}
	defer rows.Close()

	var triggers []Trigger
	for rows.Next() {
		var trg Trigger
		var def sql.NullString
		if err := rows.Scan(&trg.Name, &def); err != nil {
			return nil, err
		}
		if def.Valid {
			trg.Definition = def.String
		}
		triggers = append(triggers, trg)
	}
	return triggers, rows.Err()
}

// ListFunctions: SQLite has no user functions in the traditional sense — returns empty
// (not a bug; the frontend shows an empty state with a note).
func (d *SQLiteDriver) ListFunctions(ctx context.Context, schema string) ([]Function, error) {
	return nil, nil
}

// ListIndexes lists explicit table indexes via sqlite_master (excludes PK/UNIQUE
// autoindexes, which already appear in TableDDL as part of CREATE TABLE itself —
// "sqlite_autoindex_" is SQLite's internal prefix for them). Columns come from PRAGMA
// index_info, in index order.
func (d *SQLiteDriver) ListIndexes(ctx context.Context, schema, table string) ([]Index, error) {
	rows, err := d.conn.QueryContext(ctx,
		`SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND name NOT LIKE 'sqlite_autoindex_%' ORDER BY name`, table)
	if err != nil {
		return nil, fmt.Errorf("listando índices de %q: %w", table, err)
	}
	defer rows.Close()

	var indexes []Index
	for rows.Next() {
		var idx Index
		var def sql.NullString
		if err := rows.Scan(&idx.Name, &def); err != nil {
			return nil, err
		}
		if def.Valid {
			idx.Definition = def.String
		}
		indexes = append(indexes, idx)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// PRAGMA index_list provides the "unique" flag per TABLE (not per index) — a real bug
	// fixed during code review: the previous version always returned Unique=false, so
	// "CREATE UNIQUE INDEX" appeared as "no" in the UI (an incorrect answer, not just
	// missing information). Read once per table and match by index name.
	uniqueByName, err := d.uniqueIndexNames(ctx, table)
	if err != nil {
		return nil, err
	}
	for i := range indexes {
		cols, err := d.indexColumns(ctx, indexes[i].Name)
		if err != nil {
			return nil, err
		}
		indexes[i].Columns = cols
		indexes[i].Unique = uniqueByName[indexes[i].Name]
	}
	return indexes, nil
}

// uniqueIndexNames reads PRAGMA index_list(tabela) and returns the set of index names
// marked as unique.
func (d *SQLiteDriver) uniqueIndexNames(ctx context.Context, table string) (map[string]bool, error) {
	rows, err := d.conn.QueryContext(ctx, fmt.Sprintf(`PRAGMA index_list(%q)`, table))
	if err != nil {
		return nil, fmt.Errorf("lendo lista de índices de %q: %w", table, err)
	}
	defer rows.Close()

	unique := map[string]bool{}
	for rows.Next() {
		var seq int
		var name string
		var isUnique int
		var origin, partial string
		if err := rows.Scan(&seq, &name, &isUnique, &origin, &partial); err != nil {
			return nil, err
		}
		if isUnique != 0 {
			unique[name] = true
		}
	}
	return unique, rows.Err()
}

// indexColumns reads PRAGMA index_info to retrieve the index columns in seqno order.
func (d *SQLiteDriver) indexColumns(ctx context.Context, indexName string) ([]string, error) {
	infoRows, err := d.conn.QueryContext(ctx, fmt.Sprintf(`PRAGMA index_info(%q)`, indexName))
	if err != nil {
		return nil, fmt.Errorf("lendo colunas do índice %q: %w", indexName, err)
	}
	defer infoRows.Close()

	var cols []string
	for infoRows.Next() {
		var seqno, cid int
		var name sql.NullString
		if err := infoRows.Scan(&seqno, &cid, &name); err != nil {
			return nil, err
		}
		if name.Valid {
			cols = append(cols, name.String)
		}
	}
	return cols, infoRows.Err()
}

// ListForeignKeys lists the table's outgoing FKs via PRAGMA foreign_key_list. SQLite
// does not name FKs (no "CONSTRAINT nome"), so Name/Definition use a synthetic label
// ("fk_<id>") and a simple textual reconstruction.
func (d *SQLiteDriver) ListForeignKeys(ctx context.Context, schema, table string) ([]ForeignKey, error) {
	rows, err := d.conn.QueryContext(ctx, fmt.Sprintf(`PRAGMA foreign_key_list(%q)`, table))
	if err != nil {
		return nil, fmt.Errorf("listando foreign keys de %q: %w", table, err)
	}
	defer rows.Close()

	byID := map[int]*ForeignKey{}
	order := []int{}
	actionsByID := map[int]string{}
	for rows.Next() {
		var id, seq int
		var refTable string
		var from, to sql.NullString
		var onUpdate, onDelete, match string
		if err := rows.Scan(&id, &seq, &refTable, &from, &to, &onUpdate, &onDelete, &match); err != nil {
			return nil, err
		}
		fk, ok := byID[id]
		if !ok {
			fk = &ForeignKey{Name: fmt.Sprintf("fk_%d", id), RefSchema: "main", RefTable: refTable}
			byID[id] = fk
			order = append(order, id)
			if onDelete != "NO ACTION" {
				actionsByID[id] += " ON DELETE " + onDelete
			}
			if onUpdate != "NO ACTION" {
				actionsByID[id] += " ON UPDATE " + onUpdate
			}
		}
		if from.Valid {
			fk.Columns = append(fk.Columns, from.String)
		}
		if to.Valid {
			fk.RefColumns = append(fk.RefColumns, to.String)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	result := make([]ForeignKey, 0, len(order))
	for _, id := range order {
		fk := byID[id]
		columns := make([]string, len(fk.Columns))
		for i, column := range fk.Columns {
			columns[i] = quoteIdent(column)
		}
		fk.Definition = fmt.Sprintf("FOREIGN KEY (%s) REFERENCES %s",
			strings.Join(columns, ", "), quoteIdent(fk.RefTable))
		if len(fk.RefColumns) > 0 {
			refColumns := make([]string, len(fk.RefColumns))
			for i, column := range fk.RefColumns {
				refColumns[i] = quoteIdent(column)
			}
			fk.Definition += " (" + strings.Join(refColumns, ", ") + ")"
		}
		fk.Definition += actionsByID[id]
		result = append(result, *fk)
	}
	return result, nil
}

// quoteIdent quotes a SQL identifier with double quotes, escaping internal quotes by
// doubling them — prevents injection through table/column names.
func quoteIdent(ident string) string {
	return `"` + strings.ReplaceAll(ident, `"`, `""`) + `"`
}

// buildUpdateCellQuery builds the parameterized UPDATE shared by the dialects:
// placeholder "?" (SQLite) or "$n" (Postgres, any other value); NULL values in the
// optimistic check become IS NULL instead of = ? (NULL never compares equal with =).
// Argument order follows placeholder numbering: PKs, old value, new value.
func buildUpdateCellQuery(placeholder, schema, table string, pkColumns []string, pkValues []any, column string, oldValue any, newValue any) (string, []any, error) {
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

	next := 1
	ph := func() string {
		if placeholder == "?" {
			return "?"
		}
		s := fmt.Sprintf("$%d", next)
		next++
		return s
	}

	qualified := quoteIdent(table)
	if schema != "" && schema != "main" {
		qualified = quoteIdent(schema) + "." + qualified
	}

	// setPh must be calculated BEFORE the WHERE loop: the SET placeholder appears first in
	// the final query text, and the driver's positional binding ("?" in SQLite) follows the
	// textual order of placeholders, not the order of calls in Go. args is built in the
	// same order (newValue first) to remain consistent across both placeholder styles.
	setPh := ph()
	args := []any{newValue}

	var where []string
	for i, pk := range pkColumns {
		if pk == "" {
			return "", nil, fmt.Errorf("nome de coluna de PK vazio")
		}
		if pkValues[i] == nil {
			where = append(where, quoteIdent(pk)+" IS NULL")
			continue
		}
		where = append(where, quoteIdent(pk)+" = "+ph())
		args = append(args, pkValues[i])
	}
	if oldValue == nil {
		where = append(where, quoteIdent(column)+" IS NULL")
	} else {
		where = append(where, quoteIdent(column)+" = "+ph())
		args = append(args, oldValue)
	}

	query := fmt.Sprintf("UPDATE %s SET %s = %s WHERE %s",
		qualified, quoteIdent(column), setPh, strings.Join(where, " AND "))
	return query, args, nil
}

// qualifyTableName builds the schema-qualified table name, except for SQLite's implicit
// "main" schema (the same rule used in buildUpdateCellQuery) — avoids duplicating this
// condition in each builder.
func qualifyTableName(schema, table string) string {
	qualified := quoteIdent(table)
	if schema != "" && schema != "main" {
		qualified = quoteIdent(schema) + "." + qualified
	}
	return qualified
}

// buildInsertRowQuery builds the parameterized INSERT shared by the dialects — always
// with an explicit column list (never INSERT INTO tabela VALUES (...) without naming
// columns, which silently breaks if the physical column order changes). columns/values
// must be in the same order (ConsoleTab builds both from editContext/the new grid row).
func buildInsertRowQuery(placeholder, schema, table string, columns []string, values []any) (string, []any, error) {
	if table == "" {
		return "", nil, fmt.Errorf("tabela vazia")
	}
	if len(columns) == 0 {
		return "", nil, fmt.Errorf("nenhuma coluna pra inserir em %q", table)
	}
	if len(columns) != len(values) {
		return "", nil, fmt.Errorf("columns (%d) e values (%d) divergem", len(columns), len(values))
	}

	next := 1
	ph := func() string {
		if placeholder == "?" {
			return "?"
		}
		s := fmt.Sprintf("$%d", next)
		next++
		return s
	}

	quotedCols := make([]string, len(columns))
	placeholders := make([]string, len(columns))
	for i, col := range columns {
		if col == "" {
			return "", nil, fmt.Errorf("nome de coluna vazio")
		}
		quotedCols[i] = quoteIdent(col)
		placeholders[i] = ph()
	}

	query := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)",
		qualifyTableName(schema, table), strings.Join(quotedCols, ", "), strings.Join(placeholders, ", "))
	return query, values, nil
}

// buildDeleteRowQuery builds the parameterized DELETE shared by the dialects, always by
// real PK (never by all visible columns — a row with a NULL value in a non-PK column
// must not include that column in the WHERE clause; only the primary key unambiguously
// identifies the row).
func buildDeleteRowQuery(placeholder, schema, table string, pkColumns []string, pkValues []any) (string, []any, error) {
	if table == "" {
		return "", nil, fmt.Errorf("tabela vazia")
	}
	if len(pkColumns) == 0 {
		return "", nil, fmt.Errorf("sem colunas de chave primária para %q", table)
	}
	if len(pkColumns) != len(pkValues) {
		return "", nil, fmt.Errorf("pkColumns (%d) e pkValues (%d) divergem", len(pkColumns), len(pkValues))
	}

	next := 1
	ph := func() string {
		if placeholder == "?" {
			return "?"
		}
		s := fmt.Sprintf("$%d", next)
		next++
		return s
	}

	var where []string
	var args []any
	for i, pk := range pkColumns {
		if pk == "" {
			return "", nil, fmt.Errorf("nome de coluna de PK vazio")
		}
		if pkValues[i] == nil {
			where = append(where, quoteIdent(pk)+" IS NULL")
			continue
		}
		where = append(where, quoteIdent(pk)+" = "+ph())
		args = append(args, pkValues[i])
	}

	query := fmt.Sprintf("DELETE FROM %s WHERE %s", qualifyTableName(schema, table), strings.Join(where, " AND "))
	return query, args, nil
}

// scanRows converts a generic *sql.Rows into the common transport format {columns,
// types, rows} used by all drivers.
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
	binary := binaryColumnMaskSQLite(colTypes)
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
