package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

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
