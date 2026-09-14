package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"wisp/internal/db"
	"wisp/internal/session"
	"wisp/internal/store"
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

	s, err := store.Open(filepath.Join(dbDir, "wisp.db"))
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
