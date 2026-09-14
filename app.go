package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

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

// Execute roda uma query na conexão da aba tabId e retorna o resultado no
// formato de transporte {columns, types, rows} (ver internal/db.QueryResult).
// A execução é registrada no histórico via Store.RecordQuery sem alterar o
// retorno: falha ao gravar o histórico é só logada, nunca propagada.
func (a *App) Execute(tabID string, query string) (*db.QueryResult, error) {
	s, err := a.sessions.Get(tabID)
	if err != nil {
		return nil, err
	}
	start := time.Now()
	result, err := s.Driver.Execute(a.ctx, query)

	// DDL detectado na própria aba invalida o schema cache dessa conexão
	// imediatamente (ver docs/ARCHITECTURE.md, "Fluxo de metadados") — não
	// espera o TTL expirar sozinho.
	if err == nil && a.schemaCache != nil && isDDL(query) {
		a.schemaCache.Invalidate(s.CacheKey)
	}

	if a.store != nil {
		status := "ok"
		rowCount := 0
		if err != nil {
			status = "error"
		} else if result != nil {
			rowCount = len(result.Rows)
		}
		// connectionID vem da sessão (associado em ConnectSaved); vazio para
		// conexão por DSN direta — RecordQuery ignora connectionID vazio.
		if recErr := a.store.RecordQuery(s.ConnectionID, tabID, query, status, time.Since(start).Milliseconds(), rowCount); recErr != nil {
			fmt.Printf("wisp: não foi possível gravar histórico de query: %v\n", recErr)
		}
	}
	return result, err
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

	schemas, err := s.Driver.ListSchemas(a.ctx)
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

	tables, err := s.Driver.ListTables(a.ctx, schema)
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
