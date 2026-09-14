// Package db define o contrato comum entre bancos suportados (Strategy pattern).
// Cada dialeto (Postgres, DuckDB, ClickHouse, MySQL, SQLite) implementa DatabaseDriver
// em seu próprio arquivo/pacote; nenhum código de negócio deve fazer switch por tipo
// de banco fora desta camada. Ver docs/ARCHITECTURE.md e docs/adr/0002-cgo-policy.md.
package db

import "context"

// QueryResult é o formato único de transporte de resultado na ponte IPC com o
// frontend: colunas/tipos planos + matriz de linhas, sem duplicar chaves por
// linha (evita o overhead de []map[string]any em JSON).
type QueryResult struct {
	Columns []string
	Types   []string
	Rows    [][]any
}

// Column descreve uma coluna de tabela para fins de introspecção de schema e
// de decisão de editabilidade (ver docs/adr/0004-inline-edit-safety.md).
type Column struct {
	Name         string
	Type         string
	IsPrimaryKey bool
	IsGenerated  bool
	Nullable     bool
}

// Table é o nó de metadados retornado pela introspecção de schema.
type Table struct {
	Schema  string
	Name    string
	Columns []Column
}

// DatabaseDriver é o contrato que todo dialeto suportado deve implementar.
// Uma instância representa uma única conexão viva, isolada por tabId no
// Session Manager — nunca compartilhada entre abas.
type DatabaseDriver interface {
	// Connect abre a conexão com o banco usando a string/config fornecida.
	Connect(ctx context.Context, dsn string) error

	// Close encerra a conexão.
	Close() error

	// Execute roda uma query e retorna o resultado já no formato de transporte.
	// ctx deve ser derivado do context.CancelFunc da sessão (tabId), para que
	// cancelar a aba cancele a query no servidor de fato, não só localmente.
	Execute(ctx context.Context, query string) (*QueryResult, error)

	// CancelRunningQuery dispara o cancelamento nativo do dialeto (ex.
	// pgx.CancelQuery), quando disponível, além do cancelamento via ctx.
	CancelRunningQuery(ctx context.Context) error

	// ListSchemas, ListTables e Introspect implementam a introspecção lazy
	// usada pela sidebar (ver docs/ARCHITECTURE.md, "Fluxo de metadados").
	ListSchemas(ctx context.Context) ([]string, error)
	ListTables(ctx context.Context, schema string) ([]Table, error)
	Introspect(ctx context.Context, schema, table string) (*Table, error)
}
