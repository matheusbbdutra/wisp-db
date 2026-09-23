package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"wisp/internal/errlog"
	"wisp/internal/schemacache"
	"wisp/internal/session"
	"wisp/internal/store"
	"wisp/internal/vault"
)

// schemaCacheTTL is the schema cache lifetime (see internal/schemacache and
// docs/ARCHITECTURE.md, "Fluxo de metadados").
const schemaCacheTTL = 15 * time.Minute

// App is the root binding exposed to the frontend through Wails. It holds the Session
// Manager (tabId isolation, see internal/session), the local Store
// (connections/history/cache, see internal/store and docs/adr/0003-storage.md), and the
// two-layer schema cache (see internal/schemacache).
type App struct {
	ctx         context.Context
	sessions    *session.Manager
	store       *store.Store
	schemaCache *schemacache.Cache
	// canClose becomes true only after the frontend confirms (via ConfirmQuit) that no
	// console tab has unsaved SQL — see beforeClose.
	canClose bool
}

func NewApp() *App {
	return &App{sessions: session.NewManager()}
}

// startup is called by the Wails runtime when the window starts. It opens the local
// store at <user config>/wisp/wisp.db, creating the schema if needed.
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

	if err := errlog.Init(dbDir); err != nil {
		fmt.Printf("wisp: não foi possível abrir log local: %v\n", err)
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

	// Two-layer cache (memory + Store); persistent remains nil if the Store failed to open
	// — the cache still works in memory only in that case.
	a.schemaCache = schemacache.New(schemaCacheTTL, s)
}

// shutdown closes the local store when the app exits.
func (a *App) shutdown(ctx context.Context) {
	if a.store != nil {
		a.store.Close()
	}
	_ = errlog.Close()
}

// beforeClose intercepts window closure (registered in main.go via
// options.App.OnBeforeClose) to let the frontend ask "is there unsaved SQL?" in each
// console tab before actually exiting — the same modal already used to close an
// individual tab (see ConsoleTab.tsx confirmClose), orchestrated for all tabs at once.
//
// It ALWAYS blocks the first close request (prevent=true) and emits an event for the
// frontend to decide. When the frontend finishes asking (nothing to save, or the user
// confirmed/discarded in every tab), it calls ConfirmQuit — which sets canClose and
// requests runtime.Quit again; this time beforeClose allows it (prevent=false), without
// repeatedly asking in a loop.
func (a *App) beforeClose(ctx context.Context) bool {
	if a.canClose {
		return false
	}
	runtime.EventsEmit(ctx, "wisp:before-close")
	return true
}

// ConfirmQuit is called by the frontend after resolving (saving/discarding) unsaved SQL
// in all console tabs — or immediately if none were dirty. It sets canClose and requests
// the actual shutdown (see beforeClose).
func (a *App) ConfirmQuit() {
	a.canClose = true
	runtime.Quit(a.ctx)
}

// ReportFrontendError records an uncaught frontend error (React ErrorBoundary,
// window.onerror or unhandledrejection — see frontend/src/lib/errorReporting.ts) in the
// same local log used for Go-side panics (internal/errlog). Nothing is sent anywhere:
// this only persists locally for the user to review later in a "Report problem" flow.
func (a *App) ReportFrontendError(source string, message string, stack string) {
	errlog.Error("frontend-"+source, message, slog.String("stack", errlog.Scrub(stack)))
}
