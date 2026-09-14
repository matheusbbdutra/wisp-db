package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"wisp/internal/db"
	"wisp/internal/session"
	"wisp/internal/store"
	"wisp/internal/vault"
)

// App é o binding raiz exposto ao frontend via Wails. Mantém o Session
// Manager (isolamento por tabId, ver internal/session) e o Store local
// (conexões/histórico/cache, ver internal/store e docs/adr/0003-storage.md).
type App struct {
	ctx      context.Context
	sessions *session.Manager
	store    *store.Store
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
		return
	}
	a.store = s
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
	driver, err := db.New(db.DriverName(driverName))
	if err != nil {
		return err
	}

	ctx, err := a.sessions.Open(tabID, driver)
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
func (a *App) Execute(tabID string, query string) (*db.QueryResult, error) {
	s, err := a.sessions.Get(tabID)
	if err != nil {
		return nil, err
	}
	return s.Driver.Execute(a.ctx, query)
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
// pela sidebar — introspecção lazy, ver docs/ARCHITECTURE.md).
func (a *App) ListSchemas(tabID string) ([]string, error) {
	s, err := a.sessions.Get(tabID)
	if err != nil {
		return nil, err
	}
	return s.Driver.ListSchemas(a.ctx)
}

// ListTables retorna as tabelas de um schema na conexão da aba tabId.
func (a *App) ListTables(tabID string, schema string) ([]db.Table, error) {
	s, err := a.sessions.Get(tabID)
	if err != nil {
		return nil, err
	}
	return s.Driver.ListTables(a.ctx, schema)
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
	return a.Connect(tabID, driverName, dsn)
}

// DeleteSavedConnection remove uma conexão salva permanentemente.
func (a *App) DeleteSavedConnection(connectionID string) error {
	if a.store == nil {
		return fmt.Errorf("store local indisponível")
	}
	return a.store.DeleteConnection(connectionID)
}
