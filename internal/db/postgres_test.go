package db

import (
	"context"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestResolveColumnType(t *testing.T) {
	length := 42
	for _, tt := range []struct {
		name, dataType, udt string
		length              *int
		want                string
	}{
		{"varchar com tamanho", "character varying", "varchar", &length, "character varying(42)"},
		{"character sem tamanho", "character", "bpchar", nil, "character"},
		{"tipo do usuário", "USER-DEFINED", "status", nil, "status"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if got := resolveColumnType(tt.dataType, tt.udt, tt.length); got != tt.want {
				t.Errorf("tipo = %q; esperado %q", got, tt.want)
			}
		})
	}
}

func TestPostgresMetadata(t *testing.T) {
	driver := NewPostgresDriver()
	connectCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := driver.Connect(connectCtx, "postgres://wisp:wisp@localhost:5432/wisp_test"); err != nil {
		t.Skip("Postgres de teste não está rodando — suba com docker compose -f testdata/docker-compose.yml up -d")
	}
	t.Cleanup(func() {
		if err := driver.Close(); err != nil {
			t.Error(err)
		}
	})
	ctx, cancelQueries := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancelQueries()
	// Schema exclusivo evita tocar no seed e permite execuções simultâneas.
	schema := fmt.Sprintf("wisp_test_%d", time.Now().UnixNano())
	qualified := quoteIdentPG(schema)
	if _, err := driver.conn.Exec(ctx, "CREATE SCHEMA "+qualified); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		for _, query := range []string{
			"DROP TABLE IF EXISTS " + qualified + ".customers",
			"DROP FUNCTION IF EXISTS " + qualified + ".customer_trigger()",
			"DROP FUNCTION IF EXISTS " + qualified + ".double_value(integer)",
			"DROP SCHEMA " + qualified,
		} {
			if _, err := driver.conn.Exec(cleanupCtx, query); err != nil {
				t.Error(err)
			}
		}
	})
	for _, query := range []string{
		"CREATE TABLE " + qualified + ".customers (id integer, name character varying(42), doubled integer GENERATED ALWAYS AS (id * 2) STORED, CONSTRAINT nome_certo UNIQUE (name))",
		"CREATE FUNCTION " + qualified + ".customer_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$",
		"CREATE FUNCTION " + qualified + ".double_value(value integer) RETURNS integer LANGUAGE sql AS $$ SELECT value * 2; $$",
		"CREATE TRIGGER customers_insert BEFORE INSERT ON " + qualified + ".customers FOR EACH ROW EXECUTE FUNCTION " + qualified + ".customer_trigger()",
	} {
		if _, err := driver.conn.Exec(ctx, query); err != nil {
			t.Fatal(err)
		}
	}
	t.Run("DDL preserva constraint e expressão gerada", func(t *testing.T) {
		got, err := driver.TableDDL(ctx, schema, "customers")
		if err != nil {
			t.Fatal(err)
		}
		want := "CREATE TABLE " + qualified + ".\"customers\" (\n" +
			"  \"id\" integer,\n" +
			"  \"name\" character varying(42),\n" +
			"  \"doubled\" integer GENERATED ALWAYS AS ((id * 2)) STORED,\n" +
			"  CONSTRAINT \"nome_certo\" UNIQUE (name)\n);"
		if got != want {
			t.Errorf("DDL = %s\nesperado = %s", got, want)
		}
	})
	t.Run("trigger completo", func(t *testing.T) {
		got, err := driver.ListTriggers(ctx, schema, "customers")
		if err != nil {
			t.Fatal(err)
		}
		want := []Trigger{{Name: "customers_insert", Definition: "CREATE TRIGGER customers_insert BEFORE INSERT ON " + schema + ".customers FOR EACH ROW EXECUTE FUNCTION " + schema + ".customer_trigger()"}}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("triggers = %#v; esperados %#v", got, want)
		}
	})
	t.Run("funções com definição", func(t *testing.T) {
		got, err := driver.ListFunctions(ctx, schema)
		if err != nil {
			t.Fatal(err)
		}
		if len(got) != 2 {
			t.Fatalf("funções = %#v; esperadas 2", got)
		}
		for i, want := range []struct{ name, signature, result, language, body string }{
			{"customer_trigger", "customer_trigger()", "RETURNS trigger", "LANGUAGE plpgsql", "BEGIN RETURN NEW; END;"},
			{"double_value", "double_value(value integer)", "RETURNS integer", "LANGUAGE sql", "SELECT value * 2;"},
		} {
			if got[i].Name != want.name {
				t.Errorf("nome = %q; esperado %q", got[i].Name, want.name)
			}
			for _, fragment := range []string{"CREATE OR REPLACE FUNCTION " + schema + "." + want.signature, want.result, want.language, want.body} {
				if !strings.Contains(got[i].Definition, fragment) {
					t.Errorf("definição %q não contém %q", got[i].Definition, fragment)
				}
			}
		}
	})
}
