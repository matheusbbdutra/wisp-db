// Package db defines the common contract for supported databases (Strategy pattern).
// Each dialect (Postgres, DuckDB, ClickHouse, MySQL, SQLite) implements DatabaseDriver
// in its own file/package; no business code should switch on database type outside this
// layer. See docs/ARCHITECTURE.md and docs/adr/0002-cgo-policy.md.
package db

import "context"

// normalizeCellValue converts []byte to string before the row becomes QueryResult.Rows —
// Go serializes []byte as base64 in JSON (that is how json.Marshal handles the type),
// and the Wails IPC bridge serializes QueryResult as plain JSON. A real production bug:
// pgx v5 has no native codec for the Postgres XML type (unlike JSON/JSONB, which it
// decodes to string), so rows.Values() returns the raw wire value as []byte — without
// this conversion, an XML column appeared as unreadable base64 in the grid instead of
// the actual text. This applies to ANY []byte not handled by a driver (not just XML), so
// it normalizes generically instead of listing specific types.
func normalizeCellValue(v any) any {
	if b, ok := v.([]byte); ok {
		return string(b)
	}
	return v
}

func normalizeRow(row []any) []any {
	for i, v := range row {
		row[i] = normalizeCellValue(v)
	}
	return row
}

// normalizeRowSkipping is normalizeRow, but preserves []byte as-is in columns marked by
// `binary` (same index) — used for actual Postgres bytea. A real bug found during code
// review: normalizeRow converted genuine bytea to string, and strings containing bytes
// that are not valid UTF-8 become U+FFFD (replacement character) during JSON
// serialization — irreversibly losing the original bytes (copying/exporting cannot
// recover the actual value). Unconverted bytea still becomes base64 in JSON (the
// behavior for this type before this session) — not pretty in the grid, but reversible;
// xml/other text types without a codec are still converted to readable strings.
func normalizeRowSkipping(row []any, binary []bool) []any {
	for i, v := range row {
		if i < len(binary) && binary[i] {
			continue
		}
		row[i] = normalizeCellValue(v)
	}
	return row
}

// QueryResult is the single result transport format across the IPC bridge to the
// frontend: flat columns/types + a row matrix, without duplicating keys per row (avoids
// the overhead of []map[string]any in JSON).
type QueryResult struct {
	Columns []string
	Types   []string
	Rows    [][]any
}

// Column describes a table column for schema introspection and editability decisions
// (see docs/adr/0004-inline-edit-safety.md).
type Column struct {
	Name         string
	Type         string
	IsPrimaryKey bool
	IsGenerated  bool
	Nullable     bool
}

// Table is the metadata node returned by schema introspection.
type Table struct {
	Schema  string
	Name    string
	Columns []Column
	// Kind distinguishes tables from views in schema browsing — always "table" or "view",
	// never empty (see ListTables/IntrospectSchema in each driver). Views do not support
	// UpdateCell/inline editing.
	Kind string
}

// Index describes a table index with its full DDL definition, verbatim, and the covered
// columns (in index order).
type Index struct {
	Name       string
	Columns    []string
	Unique     bool
	Definition string
}

// ForeignKey describes an outgoing FK of a table (the referenced table is
// RefSchema/RefTable) with its full DDL definition, verbatim.
type ForeignKey struct {
	Name       string
	Columns    []string
	RefSchema  string
	RefTable   string
	RefColumns []string
	Definition string
}

// IncomingForeignKey describes an FK on another table (FromSchema.FromTable) that
// references THIS table's columns — the reverse direction of ForeignKey. Used to warn
// about ON DELETE CASCADE before a batch delete: OnDelete is one of "CASCADE",
// "RESTRICT", "SET NULL", "SET DEFAULT", "NO ACTION", or "" when the dialect does not
// expose it.
type IncomingForeignKey struct {
	Name        string
	FromSchema  string
	FromTable   string
	FromColumns []string
	ToColumns   []string
	OnDelete    string
}

// BatchOp is a single staged INSERT or DELETE within ExecuteBatch — the same shape as
// the arguments of InsertRow/DeleteRow, tagged by Kind so a mixed batch can be built
// from the grid's pending changes (see ADR 0004 and the "staged changes" review screen).
type BatchOp struct {
	Kind      string // "insert" or "delete"
	Schema    string
	Table     string
	Columns   []string // insert only
	Values    []any    // insert only
	PKColumns []string // delete only
	PKValues  []any    // delete only
}

// Trigger describes a table trigger with its full DDL, verbatim.
type Trigger struct {
	Name       string
	Definition string
}

// Function describes a schema function with its full DDL, verbatim.
type Function struct {
	Name       string
	Definition string
}

// Sequence describes a database sequence.
type Sequence struct {
	Name       string
	DataType   string
	StartValue int64
	Increment  int64
}

// SchemaObjects groups all first-class objects within a schema for unified browsing.
type SchemaObjects struct {
	Tables    []Table    `json:"tables"`
	Views     []Table    `json:"views"`
	Functions []Function `json:"functions"`
	Sequences []Sequence `json:"sequences"`
}

// DatabaseDriver is the contract every supported dialect must implement. An instance
// represents a single live connection, isolated by tabId in the Session Manager — never
// shared between tabs.
type DatabaseDriver interface {
	// Connect opens the database connection using the supplied string/config.
	Connect(ctx context.Context, dsn string) error

	// Close closes the connection.
	Close() error

	// Execute runs a query and returns the entire result already scanned into the transport
	// format. General-purpose use (internal introspection, scripts); the interactive editor
	// flow uses ExecuteStreaming/FetchNext instead to avoid loading entire large results
	// into memory. ctx must be derived from the session's (tabId) context.CancelFunc so
	// that canceling the tab actually cancels the query on the server, not just locally.
	Execute(ctx context.Context, query string) (*QueryResult, error)

	// ExecuteStreaming starts a query and returns column metadata without fetching rows yet
	// — paired with FetchNext (on-demand batch fetching) and CloseCursor (releases the open
	// cursor). A new call to ExecuteStreaming automatically closes any previous cursor
	// still open on the same connection (only one result in flight at a time, as Connect
	// already does with sessions).
	ExecuteStreaming(ctx context.Context, query string) (columns []string, types []string, err error)

	// FetchNext returns up to n rows from the cursor opened by ExecuteStreaming.
	// hasMore=false means the cursor is exhausted (and has already been closed internally);
	// calling FetchNext without a prior ExecuteStreaming returns (nil, false, nil), not an
	// error.
	FetchNext(ctx context.Context, n int) (rows [][]any, hasMore bool, err error)

	// CloseCursor closes the cursor opened by ExecuteStreaming, if any (idempotent —
	// calling it without an open cursor is not an error). Used when
	// canceling/reconnecting/disconnecting the tab before the cursor is exhausted on its
	// own via FetchNext.
	CloseCursor() error

	// CancelRunningQuery triggers native dialect cancellation (e.g. pgx.CancelQuery), when
	// available, in addition to cancellation via ctx.
	CancelRunningQuery(ctx context.Context) error

	// ListSchemas, ListTables and Introspect implement the lazy introspection used by the
	// sidebar (see docs/ARCHITECTURE.md, "Fluxo de metadados").
	ListSchemas(ctx context.Context) ([]string, error)
	ListTables(ctx context.Context, schema string) ([]Table, error)
	Introspect(ctx context.Context, schema, table string) (*Table, error)

	// IntrospectSchema returns ALL tables in a schema with Columns already populated, in a
	// single batched query — avoids N+1 round-trips (one Introspect per table) when
	// building the autocomplete catalog for the entire schema at once (see
	// App.IntrospectSchemaTables). A real production bug fixed: with schemas containing
	// many tables, the sequential Introspect loop blocked the tab's queue (same exclusive
	// connection) long enough to make the user's query appear to have "disappeared".
	IntrospectSchema(ctx context.Context, schema string) ([]Table, error)

	// UpdateCell generates and executes a parameterized UPDATE of a single cell, with
	// optimistic concurrency checking (WHERE pk... AND coluna_antiga = ?, see
	// docs/adr/0004-inline-edit-safety.md). It returns rowsAffected — 0 means the row
	// changed between fetch and save (another process modified it), not an error; the
	// caller must warn the user instead of assuming success.
	UpdateCell(ctx context.Context, schema, table string, pkColumns []string, pkValues []any, column string, oldValue any, newValue any) (rowsAffected int64, err error)

	// InsertRow inserts a new row, always with an explicit column list (never positional) —
	// parameterized, using the same security pattern as UpdateCell. columns/values must be
	// in the same order.
	InsertRow(ctx context.Context, schema, table string, columns []string, values []any) error

	// DeleteRow deletes the row identified by its real PK (never by all visible columns).
	// It returns rowsAffected — 0 means the row no longer existed (another process deleted
	// it first), not an error; the caller must warn the user instead of assuming success
	// (the same pattern as UpdateCell/optimistic checking).
	DeleteRow(ctx context.Context, schema, table string, pkColumns []string, pkValues []any) (rowsAffected int64, err error)

	// ExecuteBatch runs every staged INSERT/DELETE from the "review changes" screen inside
	// a single transaction — all-or-nothing: any failing op rolls back the whole batch, so
	// the grid never ends up half-applied. Uses the same parameterized builders as
	// InsertRow/DeleteRow (buildInsertRowQuery/buildDeleteRowQuery); no optimistic check is
	// re-run per delete here (the review screen already showed the exact PK values staged
	// from the loaded rows) — a delete that no longer matches any row simply affects 0 rows
	// without failing the transaction.
	ExecuteBatch(ctx context.Context, ops []BatchOp) error

	// ListIncomingForeignKeys lists FKs on OTHER tables that reference this table's columns
	// — the reverse of ListForeignKeys. Used to warn the user before a batch delete when a
	// child table has ON DELETE CASCADE pointing at the table being deleted from.
	ListIncomingForeignKeys(ctx context.Context, schema, table string) ([]IncomingForeignKey, error)

	// TableDDL returns the table creation DDL.
	TableDDL(ctx context.Context, schema, table string) (string, error)
	// ListTriggers lists a table's triggers, with full DDL.
	ListTriggers(ctx context.Context, schema, table string) ([]Trigger, error)
	// ListFunctions lists schema functions (not per table).
	ListFunctions(ctx context.Context, schema string) ([]Function, error)
	// ListIndexes lists a table's indexes, with full DDL.
	ListIndexes(ctx context.Context, schema, table string) ([]Index, error)
	// ListForeignKeys lists a table's outgoing FKs, with full DDL.
	ListForeignKeys(ctx context.Context, schema, table string) ([]ForeignKey, error)
	// ListSequences lists schema sequences (not per table).
	ListSequences(ctx context.Context, schema string) ([]Sequence, error)
}
