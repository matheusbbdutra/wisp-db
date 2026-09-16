// Package db define o contrato comum entre bancos suportados (Strategy pattern).
// Cada dialeto (Postgres, DuckDB, ClickHouse, MySQL, SQLite) implementa DatabaseDriver
// em seu próprio arquivo/pacote; nenhum código de negócio deve fazer switch por tipo
// de banco fora desta camada. Ver docs/ARCHITECTURE.md e docs/adr/0002-cgo-policy.md.
package db

import "context"

// normalizeCellValue converte []byte pra string antes da linha virar
// QueryResult.Rows — Go serializa []byte pra base64 em JSON (é assim que
// json.Marshal trata o tipo), e a ponte IPC do Wails serializa QueryResult
// como JSON puro. Bug real de produção: pgx v5 não tem um codec nativo pro
// tipo XML do Postgres (diferente de JSON/JSONB, que ele decodifica pra
// string), então rows.Values() devolve o valor cru do wire como []byte — sem
// essa conversão, uma coluna XML aparecia como base64 ilegível no grid em
// vez do texto real. Aplica-se a QUALQUER []byte não tratado por um driver
// (não só XML), então normaliza de forma genérica em vez de listar tipos
// específicos.
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

// normalizeRowSkipping é normalizeRow, mas preserva []byte como está nas
// colunas marcadas por `binary` (mesmo índice) — usado pra bytea real do
// Postgres. Bug real achado em revisão de código: normalizeRow convertia
// bytea genuíno pra string, e string com bytes que não formam UTF-8 válido
// vira U+FFFD (replacement character) na serialização JSON — perde os bytes
// originais de forma irrecuperável (copiar/exportar não recupera o valor
// real). bytea sem conversão continua virando base64 em JSON (comportamento
// de antes desta sessão para esse tipo) — não é bonito na grade, mas é
// reversível; xml/outros tipos de texto sem codec continuam sendo
// convertidos pra string legível.
func normalizeRowSkipping(row []any, binary []bool) []any {
	for i, v := range row {
		if i < len(binary) && binary[i] {
			continue
		}
		row[i] = normalizeCellValue(v)
	}
	return row
}

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
	// Kind distingue tabela de view na exploração de schema — sempre
	// "table" ou "view", nunca vazio (ver ListTables/IntrospectSchema em
	// cada driver). Views não aceitam UpdateCell/edição inline.
	Kind string
}

// Index descreve um índice de tabela com sua definição DDL completa,
// verbatim, e as colunas cobertas (na ordem do índice).
type Index struct {
	Name       string
	Columns    []string
	Unique     bool
	Definition string
}

// ForeignKey descreve uma FK de saída de uma tabela (a tabela referenciada
// é RefSchema/RefTable) com a definição DDL completa, verbatim.
type ForeignKey struct {
	Name       string
	Columns    []string
	RefSchema  string
	RefTable   string
	RefColumns []string
	Definition string
}

// Trigger descreve um trigger de tabela com seu DDL completo, verbatim.
type Trigger struct {
	Name       string
	Definition string
}

// Function descreve uma função do schema com seu DDL completo, verbatim.
type Function struct {
	Name       string
	Definition string
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

	// IntrospectSchema retorna TODAS as tabelas de um schema já com Columns
	// populado, em uma única consulta batched — evita N+1 round-trips (um
	// Introspect por tabela) ao montar o catálogo de autocomplete pro schema
	// inteiro de uma vez (ver App.IntrospectSchemaTables). Bug real de
	// produção corrigido: com schemas de muitas tabelas, o loop de Introspect
	// sequencial travava a fila da aba (mesma conexão exclusiva) por tempo
	// suficiente pra parecer que a query do usuário tinha "sumido".
	IntrospectSchema(ctx context.Context, schema string) ([]Table, error)

	// UpdateCell gera e executa um UPDATE parametrizado de uma única
	// célula, com checagem otimista de concorrência (WHERE pk... AND
	// coluna_antiga = ?, ver docs/adr/0004-inline-edit-safety.md).
	// Retorna rowsAffected — 0 significa que a linha mudou entre o fetch
	// e o save (outro processo alterou), não erro; o caller deve avisar
	// o usuário em vez de assumir sucesso.
	UpdateCell(ctx context.Context, schema, table string, pkColumns []string, pkValues []any, column string, oldValue any, newValue any) (rowsAffected int64, err error)

	// InsertRow insere uma linha nova, sempre com lista explícita de colunas
	// (nunca posicional) — parametrizado, mesmo padrão de segurança do
	// UpdateCell. columns/values devem estar na mesma ordem.
	InsertRow(ctx context.Context, schema, table string, columns []string, values []any) error

	// DeleteRow apaga a linha identificada pela PK real (nunca por todas as
	// colunas visíveis). Retorna rowsAffected — 0 significa que a linha já
	// não existia mais (outro processo apagou antes), não erro; o caller
	// deve avisar o usuário em vez de assumir sucesso (mesmo padrão de
	// UpdateCell/checagem otimista).
	DeleteRow(ctx context.Context, schema, table string, pkColumns []string, pkValues []any) (rowsAffected int64, err error)

	// TableDDL retorna o DDL de criação da tabela.
	TableDDL(ctx context.Context, schema, table string) (string, error)
	// ListTriggers lista triggers de uma tabela, com DDL completo.
	ListTriggers(ctx context.Context, schema, table string) ([]Trigger, error)
	// ListFunctions lista funções do schema (não é por tabela).
	ListFunctions(ctx context.Context, schema string) ([]Function, error)
	// ListIndexes lista índices de uma tabela, com DDL completo.
	ListIndexes(ctx context.Context, schema, table string) ([]Index, error)
	// ListForeignKeys lista as FKs de saída de uma tabela, com DDL completo.
	ListForeignKeys(ctx context.Context, schema, table string) ([]ForeignKey, error)
}
