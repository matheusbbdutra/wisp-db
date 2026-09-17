package db

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestBuildUpdateCellQueryMySQLPKSimples(t *testing.T) {
	query, args, err := buildUpdateCellQueryMySQL("", "customers", []string{"id"}, []any{42}, "name", "antigo", "novo")
	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if !strings.Contains(query, "UPDATE `customers` SET `name` = ?") {
		t.Fatalf("query inesperada: %s", query)
	}
	if !strings.Contains(query, "`id` = ? AND `name` = ?") {
		t.Fatalf("WHERE inesperado: %s", query)
	}
	if len(args) != 3 || args[0] != "novo" || args[1] != 42 || args[2] != "antigo" {
		t.Fatalf("ordem de args incorreta: %v", args)
	}
}

func TestBuildUpdateCellQueryMySQLPKComposta(t *testing.T) {
	query, args, err := buildUpdateCellQueryMySQL("", "pedidos", []string{"a", "b"}, []any{1, 2}, "status", "x", "y")
	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if !strings.Contains(query, "`a` = ? AND `b` = ?") {
		t.Fatalf("WHERE inesperado: %s", query)
	}
	if len(args) != 4 || args[1] != 1 || args[2] != 2 {
		t.Fatalf("ordem de args incorreta: %v", args)
	}
}

func TestBuildInsertRowQueryMySQLSchemaQualificado(t *testing.T) {
	query, args, err := buildInsertRowQueryMySQL("reporting", "customers", []string{"name", "email"}, []any{"Ana", "ana@example.com"})
	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if !strings.Contains(query, "INSERT INTO `reporting`.`customers` (`name`, `email`) VALUES (?, ?)") {
		t.Fatalf("query inesperada: %s", query)
	}
	if len(args) != 2 || args[0] != "Ana" || args[1] != "ana@example.com" {
		t.Fatalf("args incorretos: %v", args)
	}
}

func TestBuildDeleteRowQueryMySQLPKNula(t *testing.T) {
	query, args, err := buildDeleteRowQueryMySQL("", "logs", []string{"id"}, []any{nil})
	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if !strings.Contains(query, "`id` IS NULL") {
		t.Fatalf("query inesperada: %s", query)
	}
	if len(args) != 0 {
		t.Fatalf("esperava 0 args; veio %v", args)
	}
}

func TestQuoteIdentMySQL(t *testing.T) {
	tests := []struct{ in, want string }{
		{"customers", "`customers`"},
		{"weird`name", "`weird``name`"},
		{"order_items", "`order_items`"},
	}
	for _, tt := range tests {
		if got := quoteIdentMySQL(tt.in); got != tt.want {
			t.Errorf("quoteIdentMySQL(%q) = %q; esperado %q", tt.in, got, tt.want)
		}
	}
}

func TestBinaryColumnMaskMySQL(t *testing.T) {
	// We can't easily mock *sql.ColumnType without a live connection, so this is a
	// unit-level smoke test on the function's helper — keeps it cheap.
	got := binaryColumnMaskMySQL(nil)
	if len(got) != 0 {
		t.Errorf("esperava máscara vazia; veio %v", got)
	}
}

// TestMySQLDriverIntegration exercises the full DatabaseDriver contract against a real
// MySQL/MariaDB instance. Skipped automatically if the container isn't reachable on
// localhost:3306 — same pattern as postgres_test.go. Each run uses unique table names
// inside the existing `wisp_test` database (where the `wisp` user already has full
// access) to avoid touching the seed and to allow concurrent runs.
func TestMySQLDriverIntegration(t *testing.T) {
	driver := NewMySQLDriver()
	connectCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	const dsn = "wisp:wisp@tcp(localhost:3306)/wisp_test?parseTime=true"
	if err := driver.Connect(connectCtx, dsn); err != nil {
		t.Skipf("MySQL de teste não está rodando — suba com docker compose -f testdata/docker-compose.yml up -d mysql: %v", err)
	}
	t.Cleanup(func() {
		if err := driver.Close(); err != nil {
			t.Error(err)
		}
	})
	ctx, cancelQueries := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancelQueries()

	// Usa schema fixo `wisp_test` (onde o usuário `wisp` tem acesso total) e nomes de
	// tabela com timestamp pra permitir execuções concorrentes sem colisão.
	const schema = "wisp_test"
	suffix := fmt.Sprintf("_%d", time.Now().UnixNano())
	customers := "customers" + suffix
	orders := "orders" + suffix

	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, _ = driver.dataConn.ExecContext(cleanupCtx, fmt.Sprintf("DROP TABLE IF EXISTS `%s`.`%s`", schema, orders))
		_, _ = driver.dataConn.ExecContext(cleanupCtx, fmt.Sprintf("DROP TABLE IF EXISTS `%s`.`%s`", schema, customers))
	})

	// Tabela com PK simples, coluna gerada, índice único.
	if _, err := driver.dataConn.ExecContext(ctx, fmt.Sprintf(
		"CREATE TABLE `%s`.`%s` (id INT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(80), email VARCHAR(120), total DECIMAL(10,2) GENERATED ALWAYS AS (1+1) STORED, UNIQUE KEY uniq_email(email))",
		schema, customers)); err != nil {
		t.Fatal(err)
	}
	if _, err := driver.dataConn.ExecContext(ctx, fmt.Sprintf(
		"CREATE TABLE `%s`.`%s` (id INT PRIMARY KEY AUTO_INCREMENT, customer_id INT NOT NULL, amount DECIMAL(10,2), CONSTRAINT fk_cust%s FOREIGN KEY (customer_id) REFERENCES `%s`.`%s`(id) ON DELETE CASCADE)",
		schema, orders, suffix, schema, customers)); err != nil {
		t.Fatal(err)
	}

	t.Run("ListSchemas inclui o schema wisp_test", func(t *testing.T) {
		schemas, err := driver.ListSchemas(ctx)
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for _, s := range schemas {
			if s == schema {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("schema %q ausente de %v", schema, schemas)
		}
	})

	t.Run("ListTables retorna kind=table", func(t *testing.T) {
		tables, err := driver.ListTables(ctx, schema)
		if err != nil {
			t.Fatal(err)
		}
		// ListTables traz TUDO no schema; só checamos que nossas 2 tabelas estão lá com
		// kind correto (podem coexistir com seed de outras execuções).
		gotCustomers, gotOrders := false, false
		for _, tbl := range tables {
			if tbl.Name == customers {
				if tbl.Kind != "table" {
					t.Errorf("tabela %s: kind=%q; esperado 'table'", tbl.Name, tbl.Kind)
				}
				gotCustomers = true
			}
			if tbl.Name == orders {
				gotOrders = true
			}
		}
		if !gotCustomers || !gotOrders {
			t.Errorf("tabelas criadas ausentes: customers=%v orders=%v (de %d tabelas)", gotCustomers, gotOrders, len(tables))
		}
	})

	t.Run("Introspect detecta PK e coluna gerada", func(t *testing.T) {
		tbl, err := driver.Introspect(ctx, schema, customers)
		if err != nil {
			t.Fatal(err)
		}
		var gotPK, gotGen bool
		for _, c := range tbl.Columns {
			if c.Name == "id" && c.IsPrimaryKey {
				gotPK = true
			}
			if c.Name == "total" && c.IsGenerated {
				gotGen = true
			}
		}
		if !gotPK {
			t.Errorf("PK não detectada em id: %+v", tbl.Columns)
		}
		if !gotGen {
			t.Errorf("coluna gerada não detectada em total: %+v", tbl.Columns)
		}
	})

	t.Run("Execute/ExecuteStreaming/FetchNext + cancelamento via close+reopen", func(t *testing.T) {
		// Insert uma linha pra ter dado.
		if err := driver.InsertRow(ctx, schema, customers, []string{"name", "email"}, []any{"Alice", "alice@example.com"}); err != nil {
			t.Fatal(err)
		}
		res, err := driver.Execute(ctx, fmt.Sprintf("SELECT name FROM `%s`.`%s` ORDER BY id", schema, customers))
		if err != nil {
			t.Fatal(err)
		}
		if len(res.Rows) != 1 || res.Rows[0][0] != "Alice" {
			t.Fatalf("resultado inesperado: %+v", res)
		}

		// Streaming + cancelamento via close+reopen.
		_, _, err = driver.ExecuteStreaming(ctx, "SELECT SLEEP(2)")
		if err != nil {
			t.Fatal(err)
		}
		cancelCtx, ccancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer ccancel()
		if err := driver.CancelRunningQuery(cancelCtx); err != nil {
			t.Logf("CancelRunningQuery retornou: %v", err)
		}
		_ = driver.CloseCursor()
		res2, err := driver.Execute(ctx, "SELECT 1")
		if err != nil {
			t.Fatalf("driver não sobreviveu ao cancelamento: %v", err)
		}
		if len(res2.Rows) != 1 {
			t.Fatalf("SELECT 1 retornou resultado inesperado: %+v", res2)
		}
	})

	t.Run("UpdateCell + DeleteRow + ExecuteBatch + ListIncomingForeignKeys", func(t *testing.T) {
		// Update: mudar name do id inserido no teste anterior (id=1).
		affected, err := driver.UpdateCell(ctx, schema, customers, []string{"id"}, []any{1}, "name", "Alice", "Bob")
		if err != nil {
			t.Fatal(err)
		}
		if affected != 1 {
			t.Errorf("UpdateCell afetou %d linhas; esperado 1", affected)
		}
		// Concorrência: re-executar com oldValue errado deve afetar 0.
		affected, _ = driver.UpdateCell(ctx, schema, customers, []string{"id"}, []any{1}, "name", "Alice", "Carol")
		if affected != 0 {
			t.Errorf("UpdateCell com oldValue incorreto afetou %d; esperado 0 (concorrência)", affected)
		}

		// ListIncomingForeignKeys: orders referencia customers (FK incoming).
		fks, err := driver.ListIncomingForeignKeys(ctx, schema, customers)
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for _, fk := range fks {
			if fk.FromTable == orders && fk.OnDelete == "CASCADE" {
				found = true
			}
		}
		if !found {
			t.Errorf("FK incoming esperada (orders → customers com CASCADE) ausente de %+v", fks)
		}

		// ExecuteBatch: insere 2 linhas em customers e deleta 1 (id=1) em uma transação.
		err = driver.ExecuteBatch(ctx, []BatchOp{
			{Kind: "insert", Schema: schema, Table: customers, Columns: []string{"name", "email"}, Values: []any{"Dave", "dave@example.com"}},
			{Kind: "insert", Schema: schema, Table: customers, Columns: []string{"name", "email"}, Values: []any{"Eve", "eve@example.com"}},
			{Kind: "delete", Schema: schema, Table: customers, PKColumns: []string{"id"}, PKValues: []any{1}},
		})
		if err != nil {
			t.Fatal(err)
		}
		res, err := driver.Execute(ctx, fmt.Sprintf("SELECT name FROM `%s`.`%s` WHERE id > 1 ORDER BY id", schema, customers))
		if err != nil {
			t.Fatal(err)
		}
		names := []string{}
		for _, row := range res.Rows {
			names = append(names, row[0].(string))
		}
		if len(names) != 2 || names[0] != "Dave" || names[1] != "Eve" {
			t.Errorf("estado pós-batch inesperado: %v", names)
		}
	})

	t.Run("TableDDL/Triggers/Functions/Indexes/FKs", func(t *testing.T) {
		triggerName := "trg_cust" + suffix
		fnName := "dbl" + suffix
		// Cria trigger + função pra cobrir esses caminhos.
		if _, err := driver.dataConn.ExecContext(ctx, fmt.Sprintf(
			"CREATE TRIGGER `%s`.`%s` BEFORE UPDATE ON `%s`.`%s` FOR EACH ROW SET NEW.name = UPPER(NEW.name)",
			schema, triggerName, schema, customers)); err != nil {
			t.Fatal(err)
		}
		if _, err := driver.dataConn.ExecContext(ctx, fmt.Sprintf(
			"CREATE FUNCTION `%s`.`%s`(x INT) RETURNS INT DETERMINISTIC RETURN x*2", schema, fnName)); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			c, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			_, _ = driver.dataConn.ExecContext(c, fmt.Sprintf("DROP TRIGGER IF EXISTS `%s`.`%s`", schema, triggerName))
			_, _ = driver.dataConn.ExecContext(c, fmt.Sprintf("DROP FUNCTION IF EXISTS `%s`.`%s`", schema, fnName))
		})

		ddl, err := driver.TableDDL(ctx, schema, customers)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(ddl, "CREATE TABLE") || !strings.Contains(ddl, "`"+customers+"`") {
			t.Errorf("TableDDL sem CREATE TABLE: %s", ddl)
		}

		triggers, err := driver.ListTriggers(ctx, schema, customers)
		if err != nil {
			t.Fatal(err)
		}
		foundTrigger := false
		for _, tr := range triggers {
			if tr.Name == triggerName {
				foundTrigger = true
			}
		}
		if !foundTrigger {
			t.Errorf("trigger %s ausente de %+v", triggerName, triggers)
		}

		fns, err := driver.ListFunctions(ctx, schema)
		if err != nil {
			t.Fatal(err)
		}
		foundFn := false
		for _, fn := range fns {
			if fn.Name == fnName {
				foundFn = true
			}
		}
		if !foundFn {
			t.Errorf("função %s ausente de %+v", fnName, fns)
		}

		indexes, err := driver.ListIndexes(ctx, schema, customers)
		if err != nil {
			t.Fatal(err)
		}
		gotUnique := false
		for _, idx := range indexes {
			if idx.Unique {
				gotUnique = true
			}
		}
		if !gotUnique {
			t.Errorf("índice UNIQUE não detectado: %+v", indexes)
		}

		fks, err := driver.ListForeignKeys(ctx, schema, orders)
		if err != nil {
			t.Fatal(err)
		}
		foundFK := false
		for _, fk := range fks {
			if fk.RefTable == customers && fk.Name == "fk_cust"+suffix {
				foundFK = true
			}
		}
		if !foundFK {
			t.Errorf("FK de orders→customers ausente de %+v", fks)
		}
	})
}
