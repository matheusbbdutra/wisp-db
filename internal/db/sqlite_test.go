package db

import (
	"context"
	"database/sql"
	"os"
	"strings"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func TestBuildUpdateCellQueryPKSimples(t *testing.T) {
	query, args, err := buildUpdateCellQuery("?", "", "customers", []string{"id"}, []any{42}, "name", "antigo", "novo")
	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if !strings.Contains(query, `UPDATE "customers" SET "name" = ?`) {
		t.Fatalf("query inesperada: %s", query)
	}
	if !strings.Contains(query, `"id" = ? AND "name" = ?`) {
		t.Fatalf("WHERE inesperado: %s", query)
	}
	// Ordem dos args acompanha a ordem textual: SET antes do WHERE.
	if len(args) != 3 || args[0] != "novo" || args[1] != 42 || args[2] != "antigo" {
		t.Fatalf("ordem de args incorreta: %v", args)
	}
}

func TestBuildUpdateCellQueryPKComposta(t *testing.T) {
	query, args, err := buildUpdateCellQuery("?", "", "pedidos", []string{"a", "b"}, []any{1, 2}, "status", "x", "y")
	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if !strings.Contains(query, `"a" = ? AND "b" = ? AND "status" = ?`) {
		t.Fatalf("WHERE inesperado: %s", query)
	}
	if len(args) != 4 || args[0] != "y" || args[1] != 1 || args[2] != 2 || args[3] != "x" {
		t.Fatalf("ordem de args incorreta: %v", args)
	}
}

func TestBuildUpdateCellQueryOldValueNULL(t *testing.T) {
	query, args, err := buildUpdateCellQuery("?", "", "customers", []string{"id"}, []any{1}, "name", nil, "novo")
	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if !strings.Contains(query, `"name" IS NULL`) {
		t.Fatalf("oldValue NULL deveria virar IS NULL: %s", query)
	}
	if len(args) != 2 || args[0] != "novo" || args[1] != 1 {
		t.Fatalf("args incorretos: %v", args)
	}
}

func TestBuildUpdateCellQueryErros(t *testing.T) {
	if _, _, err := buildUpdateCellQuery("?", "", "t", []string{"a", "b"}, []any{1}, "c", "x", "y"); err == nil {
		t.Fatal("esperava erro com pkColumns/pkValues divergentes")
	}
	if _, _, err := buildUpdateCellQuery("?", "", "t", nil, nil, "c", "x", "y"); err == nil {
		t.Fatal("esperava erro com pkColumns vazio")
	}
	if _, _, err := buildUpdateCellQuery("?", "", "", []string{"a"}, []any{1}, "c", "x", "y"); err == nil {
		t.Fatal("esperava erro com tabela vazia")
	}
}

func TestBuildInsertRowQuery(t *testing.T) {
	query, args, err := buildInsertRowQuery("?", "", "customers", []string{"name", "email"}, []any{"Ana", "ana@example.com"})
	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if !strings.Contains(query, `INSERT INTO "customers" ("name", "email") VALUES (?, ?)`) {
		t.Fatalf("query inesperada: %s", query)
	}
	if len(args) != 2 || args[0] != "Ana" || args[1] != "ana@example.com" {
		t.Fatalf("args incorretos: %v", args)
	}
}

func TestBuildInsertRowQueryPostgresPlaceholders(t *testing.T) {
	query, args, err := buildInsertRowQuery("$", "public", "customers", []string{"name"}, []any{"Ana"})
	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if !strings.Contains(query, `INSERT INTO "public"."customers" ("name") VALUES ($1)`) {
		t.Fatalf("query inesperada: %s", query)
	}
	if len(args) != 1 || args[0] != "Ana" {
		t.Fatalf("args incorretos: %v", args)
	}
}

func TestBuildInsertRowQueryErros(t *testing.T) {
	if _, _, err := buildInsertRowQuery("?", "", "t", nil, nil); err == nil {
		t.Fatal("esperava erro com columns vazio")
	}
	if _, _, err := buildInsertRowQuery("?", "", "t", []string{"a", "b"}, []any{1}); err == nil {
		t.Fatal("esperava erro com columns/values divergentes")
	}
	if _, _, err := buildInsertRowQuery("?", "", "", []string{"a"}, []any{1}); err == nil {
		t.Fatal("esperava erro com tabela vazia")
	}
}

func TestBuildDeleteRowQuery(t *testing.T) {
	query, args, err := buildDeleteRowQuery("?", "", "customers", []string{"id"}, []any{42})
	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if !strings.Contains(query, `DELETE FROM "customers" WHERE "id" = ?`) {
		t.Fatalf("query inesperada: %s", query)
	}
	if len(args) != 1 || args[0] != 42 {
		t.Fatalf("args incorretos: %v", args)
	}
}

func TestBuildDeleteRowQueryPKComposta(t *testing.T) {
	query, args, err := buildDeleteRowQuery("$", "", "order_items", []string{"order_id", "item_seq"}, []any{1, 2})
	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if !strings.Contains(query, `DELETE FROM "order_items" WHERE "order_id" = $1 AND "item_seq" = $2`) {
		t.Fatalf("query inesperada: %s", query)
	}
	if len(args) != 2 || args[0] != 1 || args[1] != 2 {
		t.Fatalf("args incorretos: %v", args)
	}
}

func TestBuildDeleteRowQueryErros(t *testing.T) {
	if _, _, err := buildDeleteRowQuery("?", "", "t", nil, nil); err == nil {
		t.Fatal("esperava erro com pkColumns vazio")
	}
	if _, _, err := buildDeleteRowQuery("?", "", "t", []string{"a", "b"}, []any{1}); err == nil {
		t.Fatal("esperava erro com pkColumns/pkValues divergentes")
	}
}

func TestQuoteIdent(t *testing.T) {
	if got := quoteIdent(`a"b`); got != `"a""b"` {
		t.Fatalf("escape incorreto: %s", got)
	}
	if got := quoteIdent("simples"); got != `"simples"` {
		t.Fatalf("quote incorreto: %s", got)
	}
}

// newTempSQLiteDriver abre um SQLiteDriver real contra arquivo temporário.
func newTempSQLiteDriver(t *testing.T) *SQLiteDriver {
	t.Helper()
	f, err := os.CreateTemp(t.TempDir(), "wisp-test-*.db")
	if err != nil {
		t.Fatalf("criando arquivo temporário: %v", err)
	}
	path := f.Name()
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}

	d := NewSQLiteDriver()
	if err := d.Connect(context.Background(), path); err != nil {
		t.Fatalf("conectando sqlite temporário: %v", err)
	}
	t.Cleanup(func() {
		if err := d.Close(); err != nil {
			t.Error(err)
		}
	})
	return d
}

func TestSQLiteTableDDLListTriggersListFunctions(t *testing.T) {
	ctx := context.Background()
	d := newTempSQLiteDriver(t)

	if _, err := d.Execute(ctx, `CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL)`); err != nil {
		t.Fatalf("criando tabela: %v", err)
	}
	if _, err := d.Execute(ctx, `CREATE TRIGGER trg_customers AFTER INSERT ON customers BEGIN SELECT 1; END`); err != nil {
		t.Fatalf("criando trigger: %v", err)
	}

	ddl, err := d.TableDDL(ctx, "", "customers")
	if err != nil {
		t.Fatalf("TableDDL: %v", err)
	}
	if ddl != "CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL)" {
		t.Fatalf("DDL literal incorreto: %s", ddl)
	}

	triggers, err := d.ListTriggers(ctx, "", "customers")
	if err != nil {
		t.Fatalf("ListTriggers: %v", err)
	}
	if len(triggers) != 1 || triggers[0].Name != "trg_customers" {
		t.Fatalf("triggers inesperados: %+v", triggers)
	}
	if triggers[0].Definition != "CREATE TRIGGER trg_customers AFTER INSERT ON customers BEGIN SELECT 1; END" {
		t.Fatalf("definição de trigger incorreta: %s", triggers[0].Definition)
	}

	// ListFunctions sempre vazio no SQLite — documentado, não é bug.
	fns, err := d.ListFunctions(ctx, "")
	if err != nil {
		t.Fatalf("ListFunctions: %v", err)
	}
	if len(fns) != 0 {
		t.Fatalf("ListFunctions deveria ser vazio: %+v", fns)
	}
}

func TestSQLiteUpdateCell(t *testing.T) {
	ctx := context.Background()
	d := newTempSQLiteDriver(t)

	if _, err := d.Execute(ctx, `CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT)`); err != nil {
		t.Fatalf("criando tabela: %v", err)
	}
	if _, err := d.Execute(ctx, `INSERT INTO customers (id, name) VALUES (1, 'antigo')`); err != nil {
		t.Fatalf("inserindo linha: %v", err)
	}

	affected, err := d.UpdateCell(ctx, "", "customers", []string{"id"}, []any{1}, "name", "antigo", "novo")
	if err != nil {
		t.Fatalf("UpdateCell: %v", err)
	}
	if affected != 1 {
		t.Fatalf("rowsAffected esperado 1, obtido %d", affected)
	}

	// Simula concorrência: outro processo altera a linha antes do UpdateCell.
	if _, err := d.Execute(ctx, `UPDATE customers SET name = 'outro' WHERE id = 1`); err != nil {
		t.Fatalf("alterando linha: %v", err)
	}
	affected, err = d.UpdateCell(ctx, "", "customers", []string{"id"}, []any{1}, "name", "novo", "final")
	if err != nil {
		t.Fatalf("UpdateCell com concorrência: %v", err)
	}
	if affected != 0 {
		t.Fatalf("rowsAffected esperado 0 (oldValue não bate mais), obtido %d", affected)
	}
}

func TestSQLiteInsertAndDeleteRow(t *testing.T) {
	ctx := context.Background()
	d := newTempSQLiteDriver(t)

	if _, err := d.Execute(ctx, `CREATE TABLE customers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT)`); err != nil {
		t.Fatalf("criando tabela: %v", err)
	}

	// INSERT com coluna omitida (id fica de fora — AUTOINCREMENT preenche).
	if err := d.InsertRow(ctx, "", "customers", []string{"name", "email"}, []any{"Ana", "ana@example.com"}); err != nil {
		t.Fatalf("InsertRow: %v", err)
	}
	result, err := d.Execute(ctx, `SELECT id, name, email FROM customers`)
	if err != nil {
		t.Fatalf("lendo linha inserida: %v", err)
	}
	if len(result.Rows) != 1 {
		t.Fatalf("esperava 1 linha, obtido %d", len(result.Rows))
	}
	row := result.Rows[0]
	if row[1] != "Ana" || row[2] != "ana@example.com" {
		t.Fatalf("linha inserida incorreta: %v", row)
	}
	id := row[0]

	// DELETE pela PK real.
	affected, err := d.DeleteRow(ctx, "", "customers", []string{"id"}, []any{id})
	if err != nil {
		t.Fatalf("DeleteRow: %v", err)
	}
	if affected != 1 {
		t.Fatalf("rowsAffected esperado 1, obtido %d", affected)
	}

	// Segunda tentativa de apagar a mesma linha: já não existe mais, 0 linhas.
	affected, err = d.DeleteRow(ctx, "", "customers", []string{"id"}, []any{id})
	if err != nil {
		t.Fatalf("DeleteRow (linha já apagada): %v", err)
	}
	if affected != 0 {
		t.Fatalf("rowsAffected esperado 0 (linha já apagada), obtido %d", affected)
	}
}

func TestSQLiteForeignKeyDefinitions(t *testing.T) {
	ctx := context.Background()
	d := newTempSQLiteDriver(t)
	if _, err := d.Execute(ctx, `CREATE TABLE "parent table" ("key""one" INTEGER, "key two" INTEGER, PRIMARY KEY ("key""one", "key two"))`); err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name       string
		definition string
	}{
		{"explicit", `FOREIGN KEY ("local""one", "local two") REFERENCES "parent table" ("key""one", "key two") ON DELETE CASCADE ON UPDATE CASCADE`},
		{"implicit", `FOREIGN KEY ("local""one", "local two") REFERENCES "parent table"`},
		{"actions", `FOREIGN KEY ("local""one", "local two") REFERENCES "parent table" ON DELETE SET NULL ON UPDATE RESTRICT`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ddl := `CREATE TABLE ` + quoteIdent(tc.name) + ` ("local""one" INTEGER, "local two" INTEGER, ` + tc.definition + `)`
			if _, err := d.Execute(ctx, ddl); err != nil {
				t.Fatal(err)
			}
			keys, err := d.ListForeignKeys(ctx, "main", tc.name)
			if err != nil {
				t.Fatal(err)
			}
			if len(keys) != 1 || keys[0].Definition != tc.definition || keys[0].Name != "fk_0" || keys[0].RefSchema != "main" {
				t.Fatalf("FK reconstruída incorretamente: %+v", keys)
			}
		})
	}
}

func TestSQLiteQueryCancellation(t *testing.T) {
	d := newTempSQLiteDriver(t)
	ctx, cancel := context.WithCancel(context.Background())

	errCh := make(chan error, 1)
	go func() {
		// Recursive CTE that takes seconds or runs forever
		_, err := d.Execute(ctx, `WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt) SELECT count(*) FROM cnt`)
		errCh <- err
	}()

	time.Sleep(10 * time.Millisecond)
	cancel()

	err := <-errCh
	if err == nil {
		t.Fatal("esperava erro de cancelamento, obtido nil")
	}

	// Now try running a new query on the same driver to see if d.conn is still usable
	res, err2 := d.Execute(context.Background(), `SELECT 1`)
	if err2 != nil {
		t.Fatalf("query subsequente falhou: %v", err2)
	}
	if len(res.Rows) != 1 || res.Rows[0][0] != int64(1) {
		t.Fatalf("resultado inesperado: %+v", res)
	}
}

func TestSQLiteStreamingCancellation(t *testing.T) {
	d := newTempSQLiteDriver(t)
	ctx, cancel := context.WithCancel(context.Background())

	cols, types, err := d.ExecuteStreaming(ctx, `WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt) SELECT x FROM cnt`)
	if err != nil {
		t.Fatalf("ExecuteStreaming failed: %v", err)
	}
	if len(cols) != 1 || cols[0] != "x" {
		t.Fatalf("colunas inesperadas: %v (tipos: %v)", cols, types)
	}

	// Fetch next 10 rows
	rows, hasMore, err := d.FetchNext(ctx, 10)
	if err != nil {
		t.Fatalf("FetchNext failed: %v", err)
	}
	if len(rows) != 10 || !hasMore {
		t.Fatalf("esperava 10 linhas com hasMore=true, obtido %d (hasMore=%v)", len(rows), hasMore)
	}

	// Now cancel context and try FetchNext
	cancel()
	_, hasMore2, err2 := d.FetchNext(ctx, 1000)
	if err2 == nil {
		t.Fatal("FetchNext após cancel deveria falhar com erro de contexto")
	}
	if hasMore2 {
		t.Fatal("hasMore deveria ser false após cancel")
	}

	// And verify that subsequent query works
	res, err3 := d.Execute(context.Background(), `SELECT 1`)
	if err3 != nil {
		t.Fatalf("query subsequente falhou: %v", err3)
	}
	if len(res.Rows) != 1 || res.Rows[0][0] != int64(1) {
		t.Fatalf("resultado inesperado: %+v", res)
	}
}

func TestSQLiteCancelRunningQueryDuringFetchNext(t *testing.T) {
	d := newTempSQLiteDriver(t)
	ctx := context.Background()

	// Use recursive CTE to generate endless rows
	_, _, err := d.ExecuteStreaming(ctx, `WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt) SELECT x FROM cnt`)
	if err != nil {
		t.Fatalf("ExecuteStreaming failed: %v", err)
	}

	fetchErrCh := make(chan error, 1)
	go func() {
		// Try fetching 50 million rows, which would take seconds
		_, _, err := d.FetchNext(ctx, 50_000_000)
		fetchErrCh <- err
	}()

	time.Sleep(20 * time.Millisecond)
	// Now call CancelRunningQuery
	if err := d.CancelRunningQuery(ctx); err != nil {
		t.Fatalf("CancelRunningQuery retornou erro: %v", err)
	}

	select {
	case err := <-fetchErrCh:
		if err == nil {
			t.Fatal("FetchNext deveria ter sido interrompido")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("FetchNext did not unblock within 2 seconds after CancelRunningQuery")
	}

	// Verify driver is still usable
	res, err := d.Execute(context.Background(), `SELECT 42`)
	if err != nil {
		t.Fatalf("subsequent query failed: %v", err)
	}
	if len(res.Rows) != 1 || res.Rows[0][0] != int64(42) {
		t.Fatalf("unexpected result: %+v", res)
	}
}

func TestSQLiteCancelRunningQueryDuringExecute(t *testing.T) {
	d := newTempSQLiteDriver(t)
	ctx := context.Background()

	// Query that runs indefinitely in Execute
	slowQuery := `WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt) SELECT count(*) FROM cnt`

	execErrCh := make(chan error, 1)
	go func() {
		_, err := d.Execute(ctx, slowQuery)
		execErrCh <- err
	}()

	time.Sleep(20 * time.Millisecond)
	if err := d.CancelRunningQuery(ctx); err != nil {
		t.Fatalf("CancelRunningQuery falhou: %v", err)
	}

	select {
	case err := <-execErrCh:
		if err == nil {
			t.Fatal("Execute deveria ter sido interrompido com erro")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Execute did not abort within 2 seconds")
	}

	// Verify driver remains usable
	res, err := d.Execute(context.Background(), `SELECT 100`)
	if err != nil {
		t.Fatalf("query subsequente falhou: %v", err)
	}
	if len(res.Rows) != 1 || res.Rows[0][0] != int64(100) {
		t.Fatalf("resultado inesperado: %+v", res)
	}
}

// TestSQLitePoolConnMaxLifetimeReclaims documents the *database/sql* contract that
// backs MySQL/MariaDB's ConnMaxLifetime guardrail (ADR 0023). Validates that after
// iterating connections past their lifetime, Stats().MaxLifetimeClosed increments.
//
// We use *database/sql directly (not SQLiteDriver, which pins a single *sql.Conn and
// never exercises pool churn). SQLite honors ConnMaxLifetime via database/sql's
// lifetime reaper; only ConnMaxIdleTime is a documented no-op for this driver.
func TestSQLitePoolConnMaxLifetimeReclaims(t *testing.T) {
	f, err := os.CreateTemp(t.TempDir(), "wisp-pooltest-*.db")
	if err != nil {
		t.Fatalf("criando arquivo temporário: %v", err)
	}
	path := f.Name()
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Remove(path) })

	pool, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("abrindo pool: %v", err)
	}
	t.Cleanup(func() { _ = pool.Close() })
	pool.SetMaxOpenConns(2)
	pool.SetMaxIdleConns(2)
	pool.SetConnMaxLifetime(50 * time.Millisecond)
	pool.SetConnMaxIdleTime(time.Hour) // disable idle reaping, isolate lifetime

	before := pool.Stats().MaxLifetimeClosed

	for i := 0; i < 20; i++ {
		conn, err := pool.Conn(context.Background())
		if err != nil {
			t.Fatalf("Conn #%d: %v", i, err)
		}
		if _, err := conn.ExecContext(context.Background(), "SELECT 1"); err != nil {
			t.Fatalf("query #%d: %v", i, err)
		}
		if err := conn.Close(); err != nil {
			t.Fatalf("close conn #%d: %v", i, err)
		}
		time.Sleep(10 * time.Millisecond) // ~200ms total — past 50ms lifetime
	}

	stats := pool.Stats()
	if stats.MaxLifetimeClosed <= before {
		t.Fatalf("esperava MaxLifetimeClosed aumentar após ConnMaxLifetime expirar; antes=%d depois=%d",
			before, stats.MaxLifetimeClosed)
	}
	if stats.OpenConnections > 2 {
		t.Fatalf("OpenConnections=%d excedeu SetMaxOpenConns(2) — vazamento", stats.OpenConnections)
	}
}

// TestSQLitePoolConnMaxIdleTimeIsNoOp documents the empirically observed limitation of
// modernc.org/sqlite: Stats().MaxIdleClosed stays at 0 even after waiting well past
// ConnMaxIdleTime (verified in /tmp/opencode/pool-probe with 50ms idle / 3.5s wait).
// This test pins the current behavior so future drivers or versions that fix it will
// fail loudly here — at which point the ADR 0023 comment in sqlite.go:67 can be
// revisited. The guardrail in MySQL/MariaDB still applies because those drivers route
// through the same database/sql pool and *do* honor ConnMaxIdleTime.
func TestSQLitePoolConnMaxIdleTimeIsNoOp(t *testing.T) {
	f, err := os.CreateTemp(t.TempDir(), "wisp-idletest-*.db")
	if err != nil {
		t.Fatalf("criando arquivo temporário: %v", err)
	}
	path := f.Name()
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Remove(path) })

	pool, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("abrindo pool: %v", err)
	}
	t.Cleanup(func() { _ = pool.Close() })
	pool.SetMaxOpenConns(2)
	pool.SetMaxIdleConns(2)
	pool.SetConnMaxLifetime(time.Hour) // disable lifetime reaping, isolate idle
	pool.SetConnMaxIdleTime(50 * time.Millisecond)

	conn, err := pool.Conn(context.Background())
	if err != nil {
		t.Fatalf("primeira Conn: %v", err)
	}
	if _, err := conn.ExecContext(context.Background(), "SELECT 1"); err != nil {
		t.Fatalf("create table: %v", err)
	}
	if err := conn.Close(); err != nil {
		t.Fatalf("close conn: %v", err)
	}

	// Wait 3.5s — 70× the configured idle window — to give the database/sql
	// reaper (1Hz sweep) many chances to fire.
	time.Sleep(3500 * time.Millisecond)

	// Now request a connection. If MaxIdleClosed stayed at 0, the same idle
	// connection was returned; if the driver eventually honors idle, it would
	// jump. We assert it stays at 0 — pinning the current limitation.
	if got := pool.Stats().MaxIdleClosed; got != 0 {
		t.Fatalf("esperava MaxIdleClosed=0 (limitação documentada do modernc.org/sqlite), got %d", got)
	}
}
