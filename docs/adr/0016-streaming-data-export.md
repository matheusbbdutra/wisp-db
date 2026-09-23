# ADR 0016 — Streaming Data Export to Disk (CSV, JSON, SQL)

**Status:** Accepted  
**Date:** 2026-09-22  

## Context

Currently, Wisp only supports copying query results to the clipboard via `useGridCopy.ts` (formats: TSV, CSV, Markdown, SQL INSERT). This has significant limitations for daily workflows:
1. **Memory constraints**: Large datasets (>5,000 rows) transferred to the frontend and copied to the OS clipboard can freeze the Webview or exhaust memory.
2. **Lack of file output**: Users frequently need to export query results or entire tables directly to disk as `.csv`, `.json`, or `.sql` dump files for sharing, reporting, or backups.
3. **Truncated results**: Results fetched in the grid are paginated by batch size (default 200 rows). Exporting via clipboard only exports what is currently fetched or visible.

## Decision

Implement backend streaming data export directly to disk files, using native OS file dialogs and cursor-based batching.

### 1. Backend IPC Bindings (`app_export.go` / `app.go`)

Expose two streaming export methods in `App`:

```go
type ExportOptions struct {
    TabID      string `json:"tabId"`
    Query      string `json:"query,omitempty"`      // If exporting query result
    Schema     string `json:"schema,omitempty"`     // If exporting full table
    Table      string `json:"table,omitempty"`      // If exporting full table
    FilePath   string `json:"filePath"`             // Absolute path selected by user
    Format     string `json:"format"`               // "csv", "json", "sql"
    BatchSize  int    `json:"batchSize,omitempty"`  // Default: 1000 rows per cursor fetch
}

type ExportResult struct {
    TotalRows   int64  `json:"totalRows"`
    DurationMs  int64  `json:"durationMs"`
    FileSizeBytes int64 `json:"fileSizeBytes"`
}

func (a *App) PickExportFile(defaultName string, format string) (string, error)
func (a *App) ExportToFile(opts ExportOptions) (*ExportResult, error)
```

- `PickExportFile` calls Wails runtime `runtime.SaveFileDialog` with proper extension filters (`*.csv`, `*.json`, `*.sql`).
- `ExportToFile`:
  - Validates that session exists for `TabID`.
  - Derives context from session, supporting query cancellation via `CancelQuery(tabId)`.
  - Opens/creates `FilePath` with `os.Create` wrapped in `bufio.NewWriterSize(file, 64*1024)`.
  - Executes query via `driver.ExecuteStreaming(ctx, query)`.
  - Loops `driver.FetchNext(ctx, batchSize)` until `hasMore == false`.
  - Streams formatted rows directly to disk without accumulating rows in Go memory.
  - Flushes buffer and closes file.

### 2. Format Writers (`internal/export/`)

Create `internal/export/writer.go`:
- **CSV Writer**: Uses Go standard `encoding/csv.Writer`. Writes column headers first, then converts row values to string. Enforces UTF-8 with optional BOM or standard RFC 4180 escaping.
- **JSON Writer**: Streams an array of objects `[{"col1": val1, ...}, ...]`. Writes `[` at start, objects separated by `,\n`, and `]` at end.
- **SQL Writer**: Generates `INSERT INTO <quoted_table> (<columns>) VALUES (<values>);` statements in chunks of 100 rows per INSERT to balance file size and compatibility.

### 3. Frontend Integration

1. **Toolbar & Context Menu Buttons**:
   - `ResultGridToolbar.tsx`: Add "Exportar..." button with download icon.
   - `TableTab.tsx`: Add "Exportar tabela..." in the "Dados" sub-tab toolbar.
2. **Export Modal (`ExportModal.tsx`)**:
   - Selector for Format: `CSV`, `JSON`, `SQL INSERT`.
   - Option: "Resultados da consulta atual" or "Tabela inteira".
   - File picker triggering `PickExportFile`.
   - Progress indicator with cancel button calling `CancelQuery(tabId)`.

## Consequences

- **Pros**:
  - Memory-safe export for tables with hundreds of thousands of rows ($O(1)$ memory consumption in both Go backend and React frontend).
  - Direct file saving without clipboard intermediary.
  - Native file save dialog integrated with OS file manager.
- **Cons**:
  - Requires dedicated session execution while export is in progress (serialized via `withQueue`).

## Acceptance Criteria

1. Exporting a 50,000-row table to CSV completes under 5 seconds with Go memory usage remaining below 50MB.
2. Canceling an ongoing export cleanly stops the database cursor, flushes/closes the file, and marks the file as partial or deletes it.
3. CSV correctly escapes newlines, quotes (`""`), and commas according to RFC 4180.
