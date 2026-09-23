// Package session implements per-tab (tabId) execution isolation, required by
// docs/ARCHITECTURE.md and AGENTS.md: each tab has its own connection and its own
// context.CancelFunc, never shared between tabs.
package session

import (
	"context"
	"fmt"
	"io"
	"strings"
	"sync"
	"time"

	"wisp/internal/db"
)

// SessionMetadata stores driver, dialect, and server version information for a session.
type SessionMetadata struct {
	TabID         string `json:"tabId"`
	Driver        string `json:"driver"`        // "postgres", "sqlite", "mysql", "mariadb"
	Dialect       string `json:"dialect"`       // "postgres", "sqlite", "mysql"
	ServerVersion string `json:"serverVersion"` // e.g. "PostgreSQL 16.1", "MySQL 8.4.0", "SQLite 3.45.1"
}

// DialectForDriver normalizes a driver name to its SQL dialect.
func DialectForDriver(driver string) string {
	switch strings.ToLower(strings.TrimSpace(driver)) {
	case "mysql", "mariadb":
		return "mysql"
	case "sqlite":
		return "sqlite"
	default:
		return "postgres"
	}
}

// Session groups a tab's active connection with its associated cancellation.
type Session struct {
	TabID  string
	Driver db.DatabaseDriver
	// MetadataDriver is a second connection used only for schema/table introspection.
	// Keeping metadata off Driver ensures a slow catalog query never blocks the console's
	// streaming cursor or native cancellation path.
	MetadataDriver db.DatabaseDriver
	// Tunnel represents an active SSH bastion connection associated with this session, if any.
	Tunnel io.Closer
	// CacheKey stably identifies the connection (driver+DSN) for the schema cache (see
	// internal/schemacache) — never the plaintext DSN.
	CacheKey string
	// ConnectionID is the associated saved connection id (store.SavedConnection), or ""
	// when the session was opened with a direct DSN without SaveConnection — used to record
	// query history (query_history) linked to the correct connection.
	ConnectionID string
	// Metadata caches session metadata (driver, dialect, server version).
	Metadata SessionMetadata

	// Ctx lives as long as the session is connected (canceled only in Close or on
	// reconnection that replaces the session) — used for calls outside a specific query
	// flow (ListSchemas, ListTables).
	Ctx context.Context
	// QueryCtx is the ctx of the currently in-flight query execution (RunQuery/FetchRows) —
	// canceled individually by Cancel(), without invalidating the entire session (allows
	// running a new query after canceling a previous one without reconnecting).
	QueryCtx context.Context

	// Fields used by App to record streaming query history (RunQuery writes the entry,
	// FetchRows updates the row total as it fetches and when the cursor is exhausted).
	QueryStartedAt   time.Time
	PendingQueryText string
	PendingHistoryID int64
	FetchedRowCount  int

	baseCancel  context.CancelFunc
	queryCancel context.CancelFunc
}

// Manager maintains the tabId -> Session mapping. Safe for concurrent use: multiple tabs
// can open/close/cancel sessions at the same time.
type Manager struct {
	mu       sync.Mutex
	sessions map[string]*Session
}

func NewManager() *Manager {
	return &Manager{sessions: make(map[string]*Session)}
}

// Open registers a new session for tabId, closing any previous session with the same id
// (reconnecting the same tab). cacheKey identifies the connection for the schema cache
// (see internal/schemacache); connectionID is the associated saved connection id, or ""
// for a direct DSN connection. An optional metadata argument initializes session metadata.
func (m *Manager) Open(tabID string, driver db.DatabaseDriver, metadataDriver db.DatabaseDriver, cacheKey string, connectionID string, metadata ...SessionMetadata) (context.Context, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if existing, ok := m.sessions[tabID]; ok {
		if existing.queryCancel != nil {
			existing.queryCancel()
		}
		existing.baseCancel()
		_ = existing.Driver.Close()
		if existing.MetadataDriver != nil {
			_ = existing.MetadataDriver.Close()
		}
		if existing.Tunnel != nil {
			_ = existing.Tunnel.Close()
		}
	}

	var meta SessionMetadata
	if len(metadata) > 0 {
		meta = metadata[0]
	}

	ctx, cancel := context.WithCancel(context.Background())
	m.sessions[tabID] = &Session{
		TabID: tabID, Driver: driver, MetadataDriver: metadataDriver, CacheKey: cacheKey, ConnectionID: connectionID,
		Metadata: meta,
		Ctx: ctx, baseCancel: cancel,
	}
	return ctx, nil
}

// GetMetadata returns the cached SessionMetadata for a tab session.
func (m *Manager) GetMetadata(tabID string) (SessionMetadata, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	s, ok := m.sessions[tabID]
	if !ok {
		return SessionMetadata{}, fmt.Errorf("nenhuma sessão ativa para tabId %q", tabID)
	}
	return s.Metadata, nil
}

// SetMetadata updates the SessionMetadata for an existing session.
func (m *Manager) SetMetadata(tabID string, meta SessionMetadata) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	s, ok := m.sessions[tabID]
	if !ok {
		return fmt.Errorf("nenhuma sessão ativa para tabId %q", tabID)
	}
	s.Metadata = meta
	return nil
}

// SetTunnel assigns an active SSH tunnel to the session, to be closed when the session closes.
func (m *Manager) SetTunnel(tabID string, tunnel io.Closer) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if s, ok := m.sessions[tabID]; ok {
		s.Tunnel = tunnel
	}
}

// Get returns a tab's active session, or an error if there is no open connection.
func (m *Manager) Get(tabID string) (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	s, ok := m.sessions[tabID]
	if !ok {
		return nil, fmt.Errorf("nenhuma sessão ativa para tabId %q", tabID)
	}
	return s, nil
}

// StartQuery prepares a new QueryCtx (derived from the session's Ctx) for a new
// execution. It does NOT automatically cancel the QueryCtx of a previous query —
// discovered in practice (real pgx, not an assumption) that canceling the ctx of a query
// whose cursor is still open (hasMore=true, user ran another query without exhausting
// the previous one) makes pgx close the entire connection as a protocol safety side
// effect, breaking the session without the user requesting it. ExecuteStreaming safely
// releases the previous cursor (via internal CloseCursor, at the SQL level, without
// touching ctx) — called automatically on each new execution. Cancellation via ctx is
// reserved for Cancel() only (explicit user action), which accepts this side effect as
// part of the cost of actually interrupting execution.
func (m *Manager) StartQuery(tabID string) (context.Context, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	s, ok := m.sessions[tabID]
	if !ok {
		return nil, fmt.Errorf("nenhuma sessão ativa para tabId %q", tabID)
	}
	qctx, qcancel := context.WithCancel(s.Ctx)
	s.QueryCtx = qctx
	s.queryCancel = qcancel
	return qctx, nil
}

// Cancel interrupts the tab's running query through native driver cancellation (e.g. pgx
// CancelRequest for Postgres, dataConn reconnect for MySQL, statement context cancel +
// CloseCursor for SQLite — see ADR 0015). It does NOT cancel QueryCtx on the session level —
// verified in practice (real pgx) that driver-level cancellation alone unblocks in-flight
// execution without the side effect of breaking the session or dropping connections.
func (m *Manager) Cancel(ctx context.Context, tabID string) error {
	s, err := m.Get(tabID)
	if err != nil {
		return err
	}
	return s.Driver.CancelRunningQuery(ctx)
}

// Close closes and removes a tab's session (e.g. tab closed by the user).
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
	err := s.Driver.Close()
	if s.MetadataDriver != nil {
		if metadataErr := s.MetadataDriver.Close(); err == nil {
			err = metadataErr
		}
	}
	if s.Tunnel != nil {
		if tunErr := s.Tunnel.Close(); err == nil {
			err = tunErr
		}
	}
	return err
}
