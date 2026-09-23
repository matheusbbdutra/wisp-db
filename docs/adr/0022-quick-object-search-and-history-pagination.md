# ADR 0022 — Quick Object Search (Quick Open) & Query History Pagination

**Status:** Accepted  
**Date:** 2026-09-22  

## Context

Two search and navigation limitations hinder fast developer workflows:
1. **No Quick Object Search (`Ctrl+P`)**: Finding a table in a database with hundreds of tables across multiple schemas requires expanding the sidebar and typing in the sidebar search. Modern developer tools (VS Code, TablePlus, DataGrip) allow pressing `Ctrl+P` (or `Cmd+P`) to fuzzy-search any table/view and immediately open it.
2. **Hardcoded Query History**: In `frontend/src/components/QueryHistory.tsx`, history fetching is hardcoded to `GetQueryHistory(20)` without search filtering, pagination, or date filtering. If a query was executed 30 minutes ago and 20 subsequent queries ran, it is inaccessible from the UI.

## Decision

Implement a global Quick Open command palette (`QuickOpenModal.tsx`) and add search/pagination to Query History.

### 1. Quick Open Palette (`frontend/src/components/QuickOpenModal.tsx`)

1. **Global Shortcut**: Listen to `Ctrl+P` (and `Cmd+P` on macOS) globally in `App.tsx`.
2. **Catalog Search**:
   - Ingest cached tables from `useConnection` or `GetCachedCatalog`.
   - Perform prefix/fuzzy matching on `<schema>.<table>` and `<table>`.
   - Display results with type badges (`table`, `view`) and schema labels.
3. **Key Navigation**:
   - `ArrowDown` / `ArrowUp` to navigate list.
   - `Enter`:
     - Default: Opens the selected table in `TableTab`.
     - `Shift+Enter`: Inserts `SELECT * FROM <qualified> LIMIT 50;` into the active console editor.
   - `Escape`: Closes modal.

### 2. Query History Search & Pagination

1. **Store Query (`internal/store/store.go`)**:
   Update `GetQueryHistory` to support search and offset:
   ```go
   func (s *Store) GetQueryHistoryPaged(search string, limit int, offset int) ([]QueryHistoryEntry, int64, error)
   ```
   - If `search` is provided, filters with `WHERE query_text LIKE '%' || ? || '%'`.
   - Returns entries and total matching count.

2. **Backend Binding (`app_scripts.go`)**:
   ```go
   type HistoryPage struct {
       Entries    []store.QueryHistoryEntry `json:"entries"`
       TotalCount int64                     `json:"totalCount"`
   }
   func (a *App) GetQueryHistoryPaged(search string, limit int, offset int) (*HistoryPage, error)
   ```

3. **Frontend UI (`QueryHistory.tsx`)**:
   - Add a search input at the top of the history panel (debounced 200ms).
   - Show row count and execution timestamp with relative formatting ("5m ago", "1h ago").
   - Add "Carregar mais histórico" button when `entries.length < totalCount`.
   - Add "Limpar histórico" button with confirmation.

## Consequences

- **Pros**:
  - Blazing fast keyboard-first table navigation (`Ctrl+P` -> type table -> `Enter`).
  - Searchable, unconstrained query history supporting months of developer activity.
- **Cons**:
  - Modal key events must be isolated from Monaco Editor key traps.

## Acceptance Criteria

1. Pressing `Ctrl+P` opens the Quick Open palette with auto-focused input.
2. Typing a partial table name filters the list in < 10ms.
3. Pressing `Enter` immediately opens the selected table in `TableTab`.
4. In Query History, typing a search term filters the history list by SQL content.
