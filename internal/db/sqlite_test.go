package db

import (
	"context"
	"os"
	"strings"
	"testing"
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
