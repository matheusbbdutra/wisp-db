// Package session implementa o isolamento de execução por aba (tabId), exigido
// em docs/ARCHITECTURE.md e CLAUDE.md: cada aba tem sua própria conexão e seu
// próprio context.CancelFunc, nunca compartilhados entre abas.
package session

import (
	"context"
	"fmt"
	"sync"

	"wisp/internal/db"
)

// Session agrupa a conexão ativa de uma aba com o cancelamento associado a ela.
type Session struct {
	TabID  string
	Driver db.DatabaseDriver
	// CacheKey identifica a conexão (driver+DSN) de forma estável para o
	// schema cache (ver internal/schemacache) — nunca a DSN em texto puro.
	CacheKey string
	// ConnectionID é o id da conexão salva associada (store.SavedConnection),
	// ou "" quando a sessão foi aberta por DSN direta sem SaveConnection —
	// usado para registrar o histórico de queries (query_history) ligado à
	// conexão certa.
	ConnectionID string
	cancel       context.CancelFunc
}

// Manager mantém o mapeamento tabId -> Session. Seguro para uso concorrente:
// múltiplas abas podem abrir/fechar/cancelar sessões ao mesmo tempo.
type Manager struct {
	mu       sync.Mutex
	sessions map[string]*Session
}

func NewManager() *Manager {
	return &Manager{sessions: make(map[string]*Session)}
}

// Open registra uma nova sessão para tabId, encerrando qualquer sessão
// anterior com o mesmo id (reconexão da mesma aba). cacheKey identifica a
// conexão para o schema cache (ver internal/schemacache); connectionID é o
// id da conexão salva associada, ou "" para conexão por DSN direta.
func (m *Manager) Open(tabID string, driver db.DatabaseDriver, cacheKey string, connectionID string) (context.Context, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if existing, ok := m.sessions[tabID]; ok {
		existing.cancel()
		_ = existing.Driver.Close()
	}

	ctx, cancel := context.WithCancel(context.Background())
	m.sessions[tabID] = &Session{TabID: tabID, Driver: driver, CacheKey: cacheKey, ConnectionID: connectionID, cancel: cancel}
	return ctx, nil
}

// Get retorna a sessão ativa de uma aba, ou erro se não houver conexão aberta.
func (m *Manager) Get(tabID string) (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	s, ok := m.sessions[tabID]
	if !ok {
		return nil, fmt.Errorf("nenhuma sessão ativa para tabId %q", tabID)
	}
	return s, nil
}

// Cancel interrompe a query em andamento da aba: cancela o context (derruba
// a chamada local) e dispara o cancelamento nativo do driver quando suportado.
func (m *Manager) Cancel(ctx context.Context, tabID string) error {
	s, err := m.Get(tabID)
	if err != nil {
		return err
	}
	s.cancel()
	return s.Driver.CancelRunningQuery(ctx)
}

// Close encerra e remove a sessão de uma aba (ex.: aba fechada pelo usuário).
func (m *Manager) Close(tabID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	s, ok := m.sessions[tabID]
	if !ok {
		return nil
	}
	s.cancel()
	delete(m.sessions, tabID)
	return s.Driver.Close()
}
