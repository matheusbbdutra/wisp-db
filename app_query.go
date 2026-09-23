package main

import (
	"fmt"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"wisp/internal/db"
)

// QueryMetadata is the return value of RunQuery: columns/types of the started query and
// the initial execution duration (excluding the time spent fetching the rows themselves,
// measured separately in FetchRows). A struct is used instead of multiple return values
// because Wails bindings do not handle more than one value besides error well (see the
// ADR pattern already used in db.QueryResult/store.SavedConnection).
type QueryMetadata struct {
	Columns    []string
	Types      []string
	DurationMs int64
}

// FetchBatch is the return value of FetchRows: a batch of rows and whether more are
// available in the cursor.
type FetchBatch struct {
	Rows    [][]any
	HasMore bool
	// Truncated is true when the cumulative row count for the current cursor has
	// hit the session's MaxRows cap (ADR 0023). HasMore is also false in this case,
	// and the underlying driver cursor has been closed so no more "Load more" is
	// possible — the user sees a "Resultado truncado em N linhas" banner instead.
	Truncated bool
}

// RunQuery starts executing a query on tab tabId's connection in streaming mode — only
// column metadata is returned here; rows are fetched on demand via FetchRows, in
// batches, to avoid loading entire large results into memory (equivalent to the
// configurable "fetch size" in clients such as DBeaver, instead of fetching everything
// at once).
//
// It creates a new QueryCtx for this execution (see session.Manager.StartQuery) —
// allowing the Cancel button to abort only this query (via ctx and native driver
// cancellation), without invalidating the entire session/connection.
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

	// DDL detected in the tab itself immediately invalidates this connection's schema cache
	// (see docs/ARCHITECTURE.md, "Fluxo de metadados") — without waiting for the TTL to
	// expire on its own.
	if err == nil && a.schemaCache != nil && isDDL(query) {
		a.schemaCache.Invalidate(s.CacheKey)
		if a.ctx != nil {
			runtime.EventsEmit(a.ctx, "wisp:catalog-invalidated", map[string]any{"tabId": tabID})
		}
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

// FetchRows fetches the next batch of up to batchSize rows from the cursor opened by
// RunQuery. hasMore=false means the result is exhausted — at that point (or on an error
// during fetching), the history recorded by RunQuery is updated with the actual total
// number of rows fetched.
//
// ADR 0023: when the cumulative FetchedRowCount for this cursor reaches the session's
// MaxRows cap, the function returns Truncated=true (with HasMore=false and Rows=nil),
// closes the underlying driver cursor (to release server-side resources), and records
// the actual row count in history. The frontend surfaces this as a "Resultado
// truncado em N linhas" banner.
func (a *App) FetchRows(tabID string, batchSize int) (*FetchBatch, error) {
	s, err := a.sessions.Get(tabID)
	if err != nil {
		return nil, err
	}

	// Cap check BEFORE calling the driver: avoid wasting a round-trip on rows we will
	// discard. A cap <= 0 means "no cap" (defensive — defaults applied in connect).
	if s.MaxRows > 0 && s.FetchedRowCount >= s.MaxRows {
		_ = s.Driver.CloseCursor()
		if a.store != nil && s.PendingHistoryID != 0 {
			_ = a.store.FinishQuery(s.PendingHistoryID, "ok", s.FetchedRowCount)
			s.PendingHistoryID = 0
		}
		return &FetchBatch{HasMore: false, Truncated: true}, nil
	}

	// Compute the per-call request size: if asking for more than the remaining budget,
	// trim it so the driver itself never sees an over-budget fetch. Defense-in-depth:
	// the post-fetch check below also enforces the cap, but trimming avoids pulling
	// rows we're going to throw away.
	remaining := batchSize
	if s.MaxRows > 0 {
		left := s.MaxRows - s.FetchedRowCount
		if left < remaining {
			remaining = left
		}
	}

	rows, hasMore, err := s.Driver.FetchNext(s.QueryCtx, remaining)
	s.FetchedRowCount += len(rows)

	// Post-fetch enforcement: a driver that returned more than `remaining` (which
	// should not happen, but defend against it) gets clipped and marked truncated.
	truncated := false
	if s.MaxRows > 0 && s.FetchedRowCount >= s.MaxRows {
		keep := s.MaxRows - (s.FetchedRowCount - len(rows))
		if keep < 0 {
			keep = 0
		}
		if keep < len(rows) {
			rows = rows[:keep]
			s.FetchedRowCount = s.MaxRows
			hasMore = false
			truncated = true
			_ = s.Driver.CloseCursor()
		}
	}

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
	return &FetchBatch{Rows: rows, HasMore: hasMore, Truncated: truncated}, nil
}

// isDDL detects whether a query changes the schema (CREATE/ALTER/DROP) from its first
// token — a simple lexical check, not a SQL parser (see docs/ARCHITECTURE.md, "sem
// parser SQL customizado").
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

// CancelQuery interrupts the execution in progress in tab tabId, canceling the local
// context and triggering native driver cancellation when supported.
func (a *App) CancelQuery(tabID string) error {
	return a.sessions.Cancel(a.ctx, tabID)
}

// UpdateCell updates a single cell through a parameterized UPDATE with optimistic
// concurrency checking (see db.DatabaseDriver.UpdateCell and
// docs/adr/0004-inline-edit-safety.md). It returns the affected rows — 0 means another
// process changed the row between fetch and save (not an error); the frontend warns the
// user and reverts the cell. It resolves the session by tabID just like the other
// bindings (RunQuery/IntrospectTable).
func (a *App) UpdateCell(tabID string, schema string, table string, pkColumns []string, pkValues []any, column string, oldValue any, newValue any) (int64, error) {
	s, err := a.sessions.Get(tabID)
	if err != nil {
		return 0, err
	}
	return s.Driver.UpdateCell(s.Ctx, schema, table, pkColumns, pkValues, column, oldValue, newValue)
}

// InsertRow inserts a new row on tab tabId's connection. It resolves the session by
// tabID just like UpdateCell.
func (a *App) InsertRow(tabID string, schema string, table string, columns []string, values []any) error {
	s, err := a.sessions.Get(tabID)
	if err != nil {
		return err
	}
	return s.Driver.InsertRow(s.Ctx, schema, table, columns, values)
}

// DeleteRow deletes a row (by its real PK) on tab tabId's connection. It resolves the
// session by tabID just like UpdateCell.
func (a *App) DeleteRow(tabID string, schema string, table string, pkColumns []string, pkValues []any) (int64, error) {
	s, err := a.sessions.Get(tabID)
	if err != nil {
		return 0, err
	}
	return s.Driver.DeleteRow(s.Ctx, schema, table, pkColumns, pkValues)
}

// ExecuteBatch runs every staged INSERT/DELETE from the grid's "review changes" screen
// in a single transaction on tab tabId's connection — all-or-nothing. It resolves the
// session by tabID just like UpdateCell.
func (a *App) ExecuteBatch(tabID string, ops []db.BatchOp) error {
	s, err := a.sessions.Get(tabID)
	if err != nil {
		return err
	}
	return s.Driver.ExecuteBatch(s.Ctx, ops)
}
