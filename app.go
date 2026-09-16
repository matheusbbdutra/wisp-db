package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"wisp/internal/db"
	"wisp/internal/schemacache"
	"wisp/internal/session"
	"wisp/internal/store"
	"wisp/internal/vault"
)

// schemaCacheTTL é o tempo de validade do cache de schema (ver
// internal/schemacache e docs/ARCHITECTURE.md, "Fluxo de metadados").
const schemaCacheTTL = 15 * time.Minute

// App é o binding raiz exposto ao frontend via Wails. Mantém o Session
// Manager (isolamento por tabId, ver internal/session), o Store local
// (conexões/histórico/cache, ver internal/store e docs/adr/0003-storage.md)
// e o schema cache em duas camadas (ver internal/schemacache).
type App struct {
	ctx         context.Context
	sessions    *session.Manager
	store       *store.Store
	schemaCache *schemacache.Cache
	// canClose vira true só depois que o frontend confirma (via ConfirmQuit)
	// que nenhuma aba de console tem SQL não salvo — ver beforeClose.
	canClose bool
}

func NewApp() *App {
	return &App{sessions: session.NewManager()}
}

// startup é chamado pelo runtime do Wails ao iniciar a janela. Abre o store
// local em <config do usuário>/wisp/wisp.db, criando o schema se necessário.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	configDir, err := os.UserConfigDir()
	if err != nil {
		fmt.Printf("wisp: não foi possível resolver diretório de config: %v\n", err)
		return
	}

	dbDir := filepath.Join(configDir, "wisp")
	if err := os.MkdirAll(dbDir, 0o700); err != nil {
		fmt.Printf("wisp: não foi possível criar %s: %v\n", dbDir, err)
		return
	}

	v, err := vault.Open()
	if err != nil {
		fmt.Printf("wisp: não foi possível abrir credential vault: %v\n", err)
		return
	}

	s, err := store.Open(filepath.Join(dbDir, "wisp.db"), v)
	if err != nil {
		fmt.Printf("wisp: não foi possível abrir store local: %v\n", err)
		a.schemaCache = schemacache.New(schemaCacheTTL, nil)
		return
	}
	a.store = s

	// Cache em duas camadas (memória + Store); persistent fica nil se o
	// Store não abriu — o cache ainda funciona só em memória nesse caso.
	a.schemaCache = schemacache.New(schemaCacheTTL, s)
}

// shutdown fecha o store local ao encerrar o app.
func (a *App) shutdown(ctx context.Context) {
	if a.store != nil {
		a.store.Close()
	}
}

// beforeClose intercepta o fechamento da janela (registrado em main.go via
// options.App.OnBeforeClose) pra dar ao frontend a chance de perguntar "tem
// SQL não salvo?" em cada aba de console antes de sair de verdade — mesmo
// modal já usado pra fechar uma aba individual (ver ConsoleTab.tsx
// confirmClose), só que orquestrado pra todas as abas de uma vez.
//
// SEMPRE bloqueia o primeiro pedido de fechamento (prevent=true) e emite um
// evento pro frontend decidir. Quando o frontend termina de perguntar (nada
// pra salvar, ou o usuário confirmou/descartou em todas), ele chama
// ConfirmQuit — que marca canClose e pede runtime.Quit de novo; dessa vez
// beforeClose deixa passar (prevent=false), sem re-perguntar em loop.
func (a *App) beforeClose(ctx context.Context) bool {
	if a.canClose {
		return false
	}
	runtime.EventsEmit(ctx, "wisp:before-close")
	return true
}

// ConfirmQuit é chamado pelo frontend depois de resolver (salvar/descartar)
// o SQL não salvo de todas as abas de console — ou imediatamente, se nenhuma
// estava suja. Marca canClose e pede o fechamento de verdade (ver beforeClose).
func (a *App) ConfirmQuit() {
	a.canClose = true
	runtime.Quit(a.ctx)
}

// --- Bindings expostos ao frontend (Wails IPC) ---

// Connect abre uma conexão dedicada para a aba tabId, usando o dialeto
// driverName ("sqlite" ou "postgres") e a dsn fornecida. Qualquer conexão
// anterior da mesma aba é encerrada (ver session.Manager.Open).
func (a *App) Connect(tabID string, driverName string, dsn string) error {
	return a.connect(tabID, driverName, dsn, "")
}

// connect é o núcleo compartilhado por Connect (DSN direta) e ConnectSaved
// (conexão salva) — connectionID vazio significa "sem conexão salva
// associada" e é o que faz RecordQuery pular a gravação no histórico
// (ver internal/store.RecordQuery).
func (a *App) connect(tabID string, driverName string, dsn string, connectionID string) error {
	driver, err := db.New(db.DriverName(driverName))
	if err != nil {
		return err
	}

	ctx, err := a.sessions.Open(tabID, driver, schemacache.Key(driverName, dsn), connectionID)
	if err != nil {
		return err
	}
	if err := driver.Connect(ctx, dsn); err != nil {
		return fmt.Errorf("conectando (tabId=%s): %w", tabID, err)
	}
	return nil
}

// QueryMetadata é o retorno de RunQuery: colunas/tipos da query iniciada e
// a duração da execução inicial (não inclui o tempo de buscar as linhas em
// si, que é medido por fora no FetchRows). Uma struct em vez de múltiplos
// retornos porque bindings Wails não lidam bem com mais de um valor além
// do error (ver ADR pattern já usado em db.QueryResult/store.SavedConnection).
type QueryMetadata struct {
	Columns    []string
	Types      []string
	DurationMs int64
}

// FetchBatch é o retorno de FetchRows: um lote de linhas e se ainda há mais
// disponível no cursor.
type FetchBatch struct {
	Rows    [][]any
	HasMore bool
}

// RunQuery inicia a execução de uma query na conexão da aba tabId em modo
// streaming — só os metadados de coluna voltam aqui; as linhas são buscadas
// sob demanda via FetchRows, em lotes, para não carregar resultados grandes
// inteiros em memória (equivalente ao "fetch size" configurável de clientes
// como o DBeaver, em vez de trazer tudo de uma vez).
//
// Cria um QueryCtx novo pra essa execução (ver session.Manager.StartQuery)
// — assim o botão Cancelar consegue abortar só esta query (via ctx e via
// cancelamento nativo do driver), sem invalidar a sessão/conexão inteira.
func (a *App) RunQuery(tabID string, query string) (*QueryMetadata, error) {
	s, err := a.sessions.Get(tabID)
	if err != nil {
		return nil, err
	}

	qctx, err := a.sessions.StartQuery(tabID)
	if err != nil {
		return nil, err
	}

	s.QueryStartedAt = time.Now()
	s.PendingQueryText = query
	s.FetchedRowCount = 0
	s.PendingHistoryID = 0

	columns, types, err := s.Driver.ExecuteStreaming(qctx, query)
	duration := time.Since(s.QueryStartedAt).Milliseconds()

	// DDL detectado na própria aba invalida o schema cache dessa conexão
	// imediatamente (ver docs/ARCHITECTURE.md, "Fluxo de metadados") — não
	// espera o TTL expirar sozinho.
	if err == nil && a.schemaCache != nil && isDDL(query) {
		a.schemaCache.Invalidate(s.CacheKey)
	}

	if a.store != nil {
		status := "ok"
		if err != nil {
			status = "error"
		}
		id, recErr := a.store.RecordQuery(s.ConnectionID, tabID, query, status, duration, 0)
		if recErr != nil {
			fmt.Printf("wisp: não foi possível gravar histórico de query: %v\n", recErr)
		} else {
			s.PendingHistoryID = id
		}
	}

	if err != nil {
		return nil, err
	}
	return &QueryMetadata{Columns: columns, Types: types, DurationMs: duration}, nil
}

// FetchRows busca o próximo lote de até batchSize linhas do cursor aberto
// por RunQuery. hasMore=false indica que o resultado terminou — nesse
// momento (ou em caso de erro no meio do fetch) o histórico gravado por
// RunQuery é atualizado com o total real de linhas buscadas.
func (a *App) FetchRows(tabID string, batchSize int) (*FetchBatch, error) {
	s, err := a.sessions.Get(tabID)
	if err != nil {
		return nil, err
	}

	rows, hasMore, err := s.Driver.FetchNext(s.QueryCtx, batchSize)
	s.FetchedRowCount += len(rows)

	if a.store != nil && s.PendingHistoryID != 0 {
		if err != nil {
			_ = a.store.FinishQuery(s.PendingHistoryID, "error", s.FetchedRowCount)
			s.PendingHistoryID = 0
		} else if !hasMore {
			_ = a.store.FinishQuery(s.PendingHistoryID, "ok", s.FetchedRowCount)
			s.PendingHistoryID = 0
		}
	}

	if err != nil {
		return nil, err
	}
	return &FetchBatch{Rows: rows, HasMore: hasMore}, nil
}

// isDDL detecta, pelo primeiro token da query, se ela é uma alteração de
// schema (CREATE/ALTER/DROP) — checagem léxica simples, não um parser SQL
// (ver docs/ARCHITECTURE.md, "sem parser SQL customizado").
func isDDL(query string) bool {
	fields := strings.Fields(query)
	if len(fields) == 0 {
		return false
	}
	switch strings.ToUpper(fields[0]) {
	case "CREATE", "ALTER", "DROP", "TRUNCATE":
		return true
	default:
		return false
	}
}

// CancelQuery interrompe a execução em andamento na aba tabId, cancelando o
// context local e disparando o cancelamento nativo do driver quando suportado.
func (a *App) CancelQuery(tabID string) error {
	return a.sessions.Cancel(a.ctx, tabID)
}

// Disconnect encerra e remove a sessão da aba tabId.
func (a *App) Disconnect(tabID string) error {
	return a.sessions.Close(tabID)
}

// ListSchemas retorna os schemas visíveis na conexão da aba tabId (usado
// pela sidebar — introspecção lazy, ver docs/ARCHITECTURE.md). Consulta o
// schema cache antes de ir ao banco; grava no cache após um fetch real.
func (a *App) ListSchemas(tabID string) ([]string, error) {
	s, err := a.sessions.Get(tabID)
	if err != nil {
		return nil, err
	}

	if a.schemaCache != nil {
		if catalog, ok := a.schemaCache.Get(s.CacheKey); ok && catalog.Schemas != nil {
			return catalog.Schemas, nil
		}
	}

	schemas, err := s.Driver.ListSchemas(s.Ctx)
	if err != nil {
		return nil, err
	}

	if a.schemaCache != nil {
		catalog, _ := a.schemaCache.Get(s.CacheKey)
		catalog.Schemas = schemas
		if catalog.Tables == nil {
			catalog.Tables = make(map[string][]db.Table)
		}
		_ = a.schemaCache.Set(s.CacheKey, catalog)
	}
	return schemas, nil
}

// ListTables retorna as tabelas de um schema na conexão da aba tabId.
// Mesma lógica de cache de ListSchemas, por schema individual.
func (a *App) ListTables(tabID string, schema string) ([]db.Table, error) {
	s, err := a.sessions.Get(tabID)
	if err != nil {
		return nil, err
	}

	if a.schemaCache != nil {
		if catalog, ok := a.schemaCache.Get(s.CacheKey); ok {
			if tables, ok := catalog.Tables[schema]; ok {
				return tables, nil
			}
		}
	}

	tables, err := s.Driver.ListTables(s.Ctx, schema)
	if err != nil {
		return nil, err
	}

	if a.schemaCache != nil {
		catalog, _ := a.schemaCache.Get(s.CacheKey)
		if catalog.Tables == nil {
			catalog.Tables = make(map[string][]db.Table)
		}
		catalog.Tables[schema] = tables
		_ = a.schemaCache.Set(s.CacheKey, catalog)
	}
	return tables, nil
}

// IntrospectTable retorna uma tabela com Columns populado (usado pelo
// autocomplete de colunas — ListTables só traz Schema/Name, ver
// internal/db.DatabaseDriver.Introspect). Consulta o schema cache antes de
// ir ao banco; grava/atualiza a entrada correspondente no cache após um
// fetch real (mesmo padrão de ListSchemas/ListTables acima).
func (a *App) IntrospectTable(tabID string, schema string, tableName string) (*db.Table, error) {
	s, err := a.sessions.Get(tabID)
	if err != nil {
		return nil, err
	}

	if a.schemaCache != nil {
		if catalog, ok := a.schemaCache.Get(s.CacheKey); ok {
			if tables, ok := catalog.Tables[schema]; ok {
				for _, t := range tables {
					if t.Name == tableName && len(t.Columns) > 0 {
						cached := t
						return &cached, nil
					}
				}
			}
		}
	}

	full, err := s.Driver.Introspect(s.Ctx, schema, tableName)
	if err != nil {
		return nil, err
	}

	if a.schemaCache != nil {
		catalog, _ := a.schemaCache.Get(s.CacheKey)
		if catalog.Tables == nil {
			catalog.Tables = make(map[string][]db.Table)
		}
		tables := catalog.Tables[schema]
		replaced := false
		for i, t := range tables {
			if t.Name == tableName {
				tables[i] = *full
				replaced = true
				break
			}
		}
		if !replaced {
			tables = append(tables, *full)
		}
		catalog.Tables[schema] = tables
		_ = a.schemaCache.Set(s.CacheKey, catalog)
	}
	return full, nil
}

// IntrospectSchemaTables retorna todas as tabelas de um schema já com
// Columns populado, numa única consulta batched (ver
// internal/db.DatabaseDriver.IntrospectSchema) — usado pelo catálogo de
// autocomplete do console (ConsoleTab) em vez de um IntrospectTable por
// tabela, que virava fila lenta em schemas com muitas tabelas. Mesmo padrão
// de cache de IntrospectTable: cache-hit não vai ao banco.
func (a *App) IntrospectSchemaTables(tabID string, schema string) ([]db.Table, error) {
	s, err := a.sessions.Get(tabID)
	if err != nil {
		return nil, err
	}

	if a.schemaCache != nil {
		if catalog, ok := a.schemaCache.Get(s.CacheKey); ok {
			if tables, ok := catalog.Tables[schema]; ok {
				allDetailed := len(tables) > 0
				for _, t := range tables {
					if len(t.Columns) == 0 {
						allDetailed = false
						break
					}
				}
				if allDetailed {
					return tables, nil
				}
			}
		}
	}

	tables, err := s.Driver.IntrospectSchema(s.Ctx, schema)
	if err != nil {
		return nil, err
	}

	if a.schemaCache != nil {
		catalog, _ := a.schemaCache.Get(s.CacheKey)
		if catalog.Tables == nil {
			catalog.Tables = make(map[string][]db.Table)
		}
		catalog.Tables[schema] = tables
		_ = a.schemaCache.Set(s.CacheKey, catalog)
	}
	return tables, nil
}

// RefreshSchema invalida o cache da conexão da aba tabId — usado pelo botão
// "Atualizar" da sidebar para forçar um fetch real em vez de esperar o TTL.
func (a *App) RefreshSchema(tabID string) error {
	s, err := a.sessions.Get(tabID)
	if err != nil {
		return err
	}
	if a.schemaCache != nil {
		a.schemaCache.Invalidate(s.CacheKey)
	}
	return nil
}

// UpdateCell atualiza uma única célula via UPDATE parametrizado com
// checagem otimista de concorrência (ver db.DatabaseDriver.UpdateCell e
// docs/adr/0004-inline-edit-safety.md). Retorna as linhas afetadas — 0
// significa que outro processo alterou a linha entre o fetch e o save
// (não erro); o frontend avisa o usuário e reverte a célula. Resolve a
// sessão pelo tabID igual aos outros bindings (RunQuery/IntrospectTable).
func (a *App) UpdateCell(tabID string, schema string, table string, pkColumns []string, pkValues []any, column string, oldValue any, newValue any) (int64, error) {
	s, err := a.sessions.Get(tabID)
	if err != nil {
		return 0, err
	}
	return s.Driver.UpdateCell(s.Ctx, schema, table, pkColumns, pkValues, column, oldValue, newValue)
}

// InsertRow insere uma linha nova na conexão da aba tabId. Resolve a sessão
// pelo tabID igual a UpdateCell.
func (a *App) InsertRow(tabID string, schema string, table string, columns []string, values []any) error {
	s, err := a.sessions.Get(tabID)
	if err != nil {
		return err
	}
	return s.Driver.InsertRow(s.Ctx, schema, table, columns, values)
}

// DeleteRow apaga uma linha (por PK real) na conexão da aba tabId. Resolve
// a sessão pelo tabID igual a UpdateCell.
func (a *App) DeleteRow(tabID string, schema string, table string, pkColumns []string, pkValues []any) (int64, error) {
	s, err := a.sessions.Get(tabID)
	if err != nil {
		return 0, err
	}
	return s.Driver.DeleteRow(s.Ctx, schema, table, pkColumns, pkValues)
}

// GetTableDDL retorna o DDL de criação da tabela na conexão da aba tabId.
// Resolve a sessão pelo tabID igual a IntrospectTable.
func (a *App) GetTableDDL(tabID string, schema string, table string) (string, error) {
	s, err := a.sessions.Get(tabID)
	if err != nil {
		return "", err
	}
	return s.Driver.TableDDL(s.Ctx, schema, table)
}

// ListTriggers lista triggers da tabela na conexão da aba tabId.
// Resolve a sessão pelo tabID igual a IntrospectTable.
func (a *App) ListTriggers(tabID string, schema string, table string) ([]db.Trigger, error) {
	s, err := a.sessions.Get(tabID)
	if err != nil {
		return nil, err
	}
	return s.Driver.ListTriggers(s.Ctx, schema, table)
}

// ListFunctions lista funções do schema na conexão da aba tabId (nível de
// schema, não filtrado por tabela). Resolve a sessão pelo tabID igual a
// IntrospectTable.
func (a *App) ListFunctions(tabID string, schema string) ([]db.Function, error) {
	s, err := a.sessions.Get(tabID)
	if err != nil {
		return nil, err
	}
	return s.Driver.ListFunctions(s.Ctx, schema)
}

// ListIndexes lista índices da tabela na conexão da aba tabId. Resolve a
// sessão pelo tabID igual a IntrospectTable.
func (a *App) ListIndexes(tabID string, schema string, table string) ([]db.Index, error) {
	s, err := a.sessions.Get(tabID)
	if err != nil {
		return nil, err
	}
	return s.Driver.ListIndexes(s.Ctx, schema, table)
}

// ListForeignKeys lista as FKs de saída da tabela na conexão da aba tabId.
// Resolve a sessão pelo tabID igual a IntrospectTable.
func (a *App) ListForeignKeys(tabID string, schema string, table string) ([]db.ForeignKey, error) {
	s, err := a.sessions.Get(tabID)
	if err != nil {
		return nil, err
	}
	return s.Driver.ListForeignKeys(s.Ctx, schema, table)
}

// --- Conexões salvas (persistidas cifradas, ver internal/vault) ---

// SaveConnection cifra e persiste uma conexão para reuso futuro (nome amigável
// + driver + DSN completa). Nunca grava a DSN em texto puro (ver internal/vault).
func (a *App) SaveConnection(name string, driverName string, dsn string) (string, error) {
	if a.store == nil {
		return "", fmt.Errorf("store local indisponível")
	}
	return a.store.SaveConnection(name, driverName, dsn)
}

// ListSavedConnections retorna as conexões salvas sem expor a DSN/segredo.
func (a *App) ListSavedConnections() ([]store.SavedConnection, error) {
	if a.store == nil {
		return nil, fmt.Errorf("store local indisponível")
	}
	return a.store.ListConnections()
}

// ConnectSaved decifra a DSN de uma conexão salva e abre a sessão da aba
// tabId com ela — a DSN decifrada nunca é retornada ao frontend.
func (a *App) ConnectSaved(tabID string, connectionID string) error {
	if a.store == nil {
		return fmt.Errorf("store local indisponível")
	}
	driverName, dsn, err := a.store.ResolveConnection(connectionID)
	if err != nil {
		return err
	}
	return a.connect(tabID, driverName, dsn, connectionID)
}

// TestConnection tenta conectar e imediatamente fecha, sem persistir nada
// nem abrir sessão de aba — usado pelo modal de conexão para validar antes
// de salvar (evita salvar uma conexão com erro de digitação, ex. nome de
// banco errado). Timeout de 10s para não travar em host inalcançável.
func (a *App) TestConnection(driverName string, dsn string) error {
	driver, err := db.New(db.DriverName(driverName))
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := driver.Connect(ctx, dsn); err != nil {
		return err
	}
	return driver.Close()
}

// DeleteSavedConnection remove uma conexão salva permanentemente.
func (a *App) DeleteSavedConnection(connectionID string) error {
	if a.store == nil {
		return fmt.Errorf("store local indisponível")
	}
	return a.store.DeleteConnection(connectionID)
}

// GetQueryHistory retorna as últimas N execuções registradas (da mais
// recente para a mais antiga).
func (a *App) GetQueryHistory(limit int) ([]store.QueryHistoryEntry, error) {
	if a.store == nil {
		return nil, fmt.Errorf("store local indisponível")
	}
	return a.store.ListQueryHistory(limit)
}

// --- Scripts SQL salvos (nomeados, editáveis — diferente do histórico) ---

// SaveScript grava um novo script SQL nomeado. Retorna o id gerado.
func (a *App) SaveScript(name string, queryText string) (string, error) {
	if a.store == nil {
		return "", fmt.Errorf("store local indisponível")
	}
	return a.store.SaveScript(name, queryText)
}

// ListScripts retorna os scripts salvos, do mais recentemente atualizado
// para o mais antigo.
func (a *App) ListScripts() ([]store.SavedScript, error) {
	if a.store == nil {
		return nil, fmt.Errorf("store local indisponível")
	}
	return a.store.ListScripts()
}

// UpdateScript sobrescreve nome e/ou texto de um script existente.
func (a *App) UpdateScript(id string, name string, queryText string) error {
	if a.store == nil {
		return fmt.Errorf("store local indisponível")
	}
	return a.store.UpdateScript(id, name, queryText)
}

// DeleteScript remove um script salvo permanentemente.
func (a *App) DeleteScript(id string) error {
	if a.store == nil {
		return fmt.Errorf("store local indisponível")
	}
	return a.store.DeleteScript(id)
}

// PickSQLiteFile abre o diálogo nativo do sistema para selecionar um arquivo
// de banco SQLite existente (.db, .sqlite, .sqlite3). Retorna o caminho absoluto
// ou string vazia se o usuário cancelou o diálogo.
func (a *App) PickSQLiteFile() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Selecionar banco de dados SQLite",
		Filters: []runtime.FileFilter{
			{
				DisplayName: "Bancos SQLite (*.db;*.sqlite;*.sqlite3)",
				Pattern:     "*.db;*.sqlite;*.sqlite3",
			},
			{
				DisplayName: "Todos os arquivos (*.*)",
				Pattern:     "*.*",
			},
		},
	})
}
