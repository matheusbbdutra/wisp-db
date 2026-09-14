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

	// Execute roda uma query e retorna o resultado inteiro já escaneado no
	// formato de transporte. Uso geral (introspecção interna, scripts); o
	// fluxo interativo do editor usa ExecuteStreaming/FetchNext em vez
	// disso, para não carregar resultados grandes inteiros em memória.
	// ctx deve ser derivado do context.CancelFunc da sessão (tabId), para que
	// cancelar a aba cancele a query no servidor de fato, não só localmente.
	Execute(ctx context.Context, query string) (*QueryResult, error)

	// ExecuteStreaming inicia uma query e retorna metadados de coluna sem
	// buscar linhas ainda — pareado com FetchNext (busca sob demanda, em
	// lotes) e CloseCursor (libera o cursor aberto). Uma nova chamada a
	// ExecuteStreaming fecha automaticamente qualquer cursor anterior ainda
	// aberto na mesma conexão (só um resultado em voo por vez, como Connect
	// já faz com sessões).
	ExecuteStreaming(ctx context.Context, query string) (columns []string, types []string, err error)

	// FetchNext retorna até n linhas do cursor aberto por ExecuteStreaming.
	// hasMore=false indica que o cursor se esgotou (e já foi fechado
	// internamente); chamar FetchNext sem um ExecuteStreaming anterior
	// retorna (nil, false, nil), não erro.
	FetchNext(ctx context.Context, n int) (rows [][]any, hasMore bool, err error)

	// CloseCursor fecha o cursor aberto por ExecuteStreaming, se houver
	// (idempotente — chamar sem cursor aberto não é erro). Usado ao
	// cancelar/reconectar/desconectar a aba antes do cursor se esgotar
	// sozinho via FetchNext.
	CloseCursor() error

	// CancelRunningQuery dispara o cancelamento nativo do dialeto (ex.
	// pgx.CancelQuery), quando disponível, além do cancelamento via ctx.
	CancelRunningQuery(ctx context.Context) error

	// ListSchemas, ListTables e Introspect implementam a introspecção lazy
	// usada pela sidebar (ver docs/ARCHITECTURE.md, "Fluxo de metadados").
	ListSchemas(ctx context.Context) ([]string, error)
	ListTables(ctx context.Context, schema string) ([]Table, error)
	Introspect(ctx context.Context, schema, table string) (*Table, error)
}
