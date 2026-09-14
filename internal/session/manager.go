// Package session implementa o isolamento de execução por aba (tabId), exigido
// em docs/ARCHITECTURE.md e CLAUDE.md: cada aba tem sua própria conexão e seu
// próprio context.CancelFunc, nunca compartilhados entre abas.
package session

import (
	"context"
	"fmt"
	"sync"
	"time"

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

	// Ctx vive enquanto a sessão estiver conectada (cancelado só em Close ou
	// numa reconexão que substitui a sessão) — usado para chamadas que não
	// fazem parte do fluxo de uma query específica (ListSchemas, ListTables).
	Ctx context.Context
	// QueryCtx é o ctx da execução de query em voo no momento (RunQuery/
	// FetchRows) — cancelado individualmente por Cancel(), sem invalidar a
	// sessão inteira (permite rodar uma query nova depois de cancelar uma
	// anterior, sem precisar reconectar).
	QueryCtx context.Context

	// Campos usados por App para registrar o histórico de uma query em
	// streaming (RunQuery grava a entrada, FetchRows atualiza o total de
	// linhas conforme busca e quando o cursor se esgota).
	QueryStartedAt   time.Time
	PendingQueryText string
	PendingHistoryID int64
	FetchedRowCount  int

	baseCancel  context.CancelFunc
	queryCancel context.CancelFunc
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
		if existing.queryCancel != nil {
			existing.queryCancel()
		}
		existing.baseCancel()
		_ = existing.Driver.Close()
	}

	ctx, cancel := context.WithCancel(context.Background())
	m.sessions[tabID] = &Session{
		TabID: tabID, Driver: driver, CacheKey: cacheKey, ConnectionID: connectionID,
		Ctx: ctx, baseCancel: cancel,
	}
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

// StartQuery prepara um QueryCtx novo (derivado do Ctx da sessão) para uma
// nova execução, cancelando qualquer query anterior ainda em voo na mesma
// aba — evita cursor vazando se o usuário disparar uma query nova sem
// esperar a anterior terminar ou cancelar explicitamente.
func (m *Manager) StartQuery(tabID string) (context.Context, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	s, ok := m.sessions[tabID]
	if !ok {
		return nil, fmt.Errorf("nenhuma sessão ativa para tabId %q", tabID)
	}
	if s.queryCancel != nil {
		s.queryCancel()
	}
	qctx, qcancel := context.WithCancel(s.Ctx)
	s.QueryCtx = qctx
	s.queryCancel = qcancel
	return qctx, nil
}

// Cancel interrompe a query em andamento da aba: cancela o QueryCtx (derruba
// a chamada local, incluindo um FetchNext em andamento) e dispara o
// cancelamento nativo do driver quando suportado. Não afeta a sessão em si
// — dá pra rodar outra query na mesma conexão logo em seguida.
func (m *Manager) Cancel(ctx context.Context, tabID string) error {
	s, err := m.Get(tabID)
	if err != nil {
		return err
	}
	if s.queryCancel != nil {
		s.queryCancel()
	}
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
	if s.queryCancel != nil {
		s.queryCancel()
	}
	s.baseCancel()
	delete(m.sessions, tabID)
	return s.Driver.Close()
}
