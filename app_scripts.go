package main

import (
	"fmt"

	"wisp/internal/store"
)

// --- Query History & Saved Scripts ---

// HistoryPage encapsulates a paginated list of history entries and total count.
type HistoryPage struct {
	Entries    []store.QueryHistoryEntry `json:"entries"`
	TotalCount int64                     `json:"totalCount"`
}

// GetQueryHistory returns the last N recorded executions (newest to oldest).
func (a *App) GetQueryHistory(limit int) ([]store.QueryHistoryEntry, error) {
	if a.store == nil {
		return nil, fmt.Errorf("store local indisponível")
	}
	return a.store.ListQueryHistory(limit)
}

// GetQueryHistoryPaged returns paginated query history with optional search filtering.
func (a *App) GetQueryHistoryPaged(search string, limit int, offset int) (*HistoryPage, error) {
	if a.store == nil {
		return nil, fmt.Errorf("store local indisponível")
	}
	entries, total, err := a.store.GetQueryHistoryPaged(search, limit, offset)
	if err != nil {
		return nil, err
	}
	return &HistoryPage{
		Entries:    entries,
		TotalCount: total,
	}, nil
}

// ClearQueryHistory removes all execution history from the local store.
func (a *App) ClearQueryHistory() error {
	if a.store == nil {
		return fmt.Errorf("store local indisponível")
	}
	return a.store.ClearQueryHistory()
}

// SaveScript saves a new named SQL script. It returns the generated id.
func (a *App) SaveScript(name string, queryText string) (string, error) {
	if a.store == nil {
		return "", fmt.Errorf("store local indisponível")
	}
	return a.store.SaveScript(name, queryText)
}

// ListScripts returns saved scripts, from most recently updated to oldest.
func (a *App) ListScripts() ([]store.SavedScript, error) {
	if a.store == nil {
		return nil, fmt.Errorf("store local indisponível")
	}
	return a.store.ListScripts()
}

// UpdateScript overwrites the name and/or text of an existing script.
func (a *App) UpdateScript(id string, name string, queryText string) error {
	if a.store == nil {
		return fmt.Errorf("store local indisponível")
	}
	return a.store.UpdateScript(id, name, queryText)
}

// DeleteScript permanently removes a saved script.
func (a *App) DeleteScript(id string) error {
	if a.store == nil {
		return fmt.Errorf("store local indisponível")
	}
	return a.store.DeleteScript(id)
}
