# Wisp — Architecture

A lightweight, native desktop SQL client. See formal decisions in `docs/adr/`.

## Overview

```
+-----------------------------------------------------------------------+
|                         Frontend (Webview)                            |
|  - Monaco Editor (IntelliSense, syntax highlight, multi-cursor)       |
|  - Virtualized Data Grid (Glide Data Grid, canvas rendering)          |
|  - Reactive panels: Schema sidebar, History, Cell details             |
+-----------------------------------------------------------------------+
                                  ▲
                                  │ IPC (Wails Bindings & Events)
                                  ▼
+-----------------------------------------------------------------------+
|                          Backend (Go Core)                            |
|  - Session Manager: tabId -> (*sql.Conn, context.CancelFunc)          |
|  - DatabaseDriver (Strategy): pgx, clickhouse-go, go-duckdb*, sqlite  |
|  - Streaming / Chunk Fetcher: {columns, types, rows}, no duplication  |
|  - Native SSH tunneling via crypto/ssh                                |
|  - Local Store: SQLite (modernc.org/sqlite) — encrypted credentials, |
|    history, schema_cache                                              |
+-----------------------------------------------------------------------+
```
`*` `go-duckdb` is the only CGO exception in the driver matrix — see ADR 0002.

Note: the diagram above describes the target architecture across all planned phases. As of this writing only the **Postgres** and **SQLite** drivers are implemented, and the SSH tunnel is not implemented yet (deliberately deferred — see `docs/ROADMAP.md`). Check `internal/db/driver.go` for the current `DatabaseDriver` implementations.

## Modules and responsibilities

| Module | Responsibility | Key decision |
|---|---|---|
| Session Manager | 1 `tabId` = 1 isolated `*sql.Conn` + 1 `context.CancelFunc` | No connection pool shared across tabs |
| DatabaseDriver (interface) | Abstracts execution/introspection per dialect | Strategy pattern, one implementation per database |
| Chunk Fetcher | Serializes results as `{columns, types, rows}` | Avoids `[]map[string]any` (JSON overhead) |
| Schema Cache | Two-tier catalog metadata (memory + SQLite) | TTL + manual invalidation + invalidation on detected DDL |
| Local Store | Connections, history, cache — all in SQLite | Never loose JSON on disk; never Turso (no sync use case) |
| SSH Tunnel | Local TCP tunnel via `crypto/ssh` | No external OS binary |
| Credential Vault | Encrypts credentials, master key in OS keychain | Never plaintext on disk |

## Query execution flow (real streaming, not all-at-once)

Implemented this way because running `SELECT *` on a multi-million-row table can't load everything into Go memory or ship it all to the frontend at once — it needs on-demand batched fetching, like the configurable "fetch size" of clients such as DBeaver (default 200 rows per batch, editable).

0. **Statement resolution at cursor**: In the frontend (`SqlEditor.tsx` / `sqlStatements.ts`), statements are isolated via a token scanner (supporting `;` and blank lines as delimiters, respecting `'...'` string literals and `--` / `/* ... */` comments). When executing without explicit text selection, only the single statement enclosing or immediately preceding the cursor offset is dispatched to the backend. Drivers (specifically PostgreSQL's `pgx` extended query protocol) expect exactly one command per query execution call — sending multiple statements together causes syntax errors.
1. The user triggers execution in a tab (`tabId`) → `RunQuery(tabId, sql)` binding.
2. The backend creates a new `QueryCtx` for that execution (derived from the session's `Ctx`, see `session.Manager.StartQuery`) and calls `driver.ExecuteStreaming(ctx, sql)`, which opens a cursor on the database (`*sql.Rows` for SQLite, `pgx.Rows` for Postgres) and returns only column names/types — no rows are fetched yet. The duration of this step (server-side execution) is already recorded in query history (`query_history`, initial `row_count` of 0).
3. The frontend calls `FetchRows(tabId, batchSize)` repeatedly — each call fetches up to `batchSize` rows from the open cursor (`driver.FetchNext`) and returns `{rows, hasMore}`. The first batch is automatic (same configured size); subsequent batches require an explicit "Load more" click — it never fetches everything on its own.
4. When the cursor is exhausted (`hasMore=false`) or errors mid-fetch, the history entry recorded in step 2 is updated (`store.FinishQuery`) with the actual total rows fetched and the final status.
5. The "Cancel" button (`CancelQuery`) cancels that specific query's `QueryCtx` (not the whole session — another query can run right after without reconnecting) **and** triggers the driver's native cancellation (`pgx`'s `CancelRequest`). Order matters: canceling on the server first, then closing the cursor locally, avoids the driver draining the remaining result set over the network before closing — measured in practice: closing the cursor alone for a 5-million-row query took ~1.5s; canceling on the server first and then closing took ~11ms.
6. `ExecuteStreaming` automatically closes any cursor still open on the same connection before opening a new one (never two live cursors at once in a tab).

## Metadata/schema flow

1. When a sidebar node is expanded (schema → tables → columns), the backend checks the `schema_cache` (SQLite) with a TTL.
2. Valid cache → returned directly, no round-trip to the external database.
3. Expired/missing cache → incremental fetch via the dialect's native catalog (`information_schema`, `pg_catalog`, `duckdb_tables()`, `system.tables`), written to cache.
4. DDL detected in the tab itself (parsing the first token: `CREATE|ALTER|DROP`) immediately invalidates that connection's cache.

## Security boundaries (see also CLAUDE.md)

- Every credential goes through the `Credential Vault` before touching disk.
- Inline editing is only allowed with a real primary key detected via the catalog — never a heuristic.
- SSH tunnel validates the host key by default; disabling it requires an explicit user action with a warning.

## What's out of scope (decisions dropped, with rationale)

- **Remote Turso/libSQL**: no multi-device sync use case in the current scope.
- **Vector search/embeddings**: schema search is exact or prefix-match; no need for semantic search.
- **GPU acceleration in the data pipeline**: no identified hot path outside grid rendering (which already uses canvas).
- **Custom SQL parser**: autocomplete relies on catalog metadata + Monaco typing events, not on custom parsing.
