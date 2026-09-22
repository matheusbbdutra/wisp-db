# ADR 0015 — Query Cancellation Parity Across Dialects

**Status:** Accepted  
**Date:** 2026-09-22  

## Context

Wisp requires responsive, native query cancellation (`AGENTS.md` Rule #6).
Currently, the cancellation behaviors diverge across drivers:
- **PostgreSQL**: Implemented via `d.conn.PgConn().CancelRequest(ctx)`, sending an out-of-band cancellation packet to the server PID without dropping the client connection.
- **MySQL / MariaDB**: Implemented by closing the active `*sql.Conn` and acquiring a fresh connection from the pool, immediately severing the server socket and aborting execution.
- **SQLite**: In `internal/session/manager.go`, `Manager.Cancel` intentionally does not cancel the session context to prevent `pgx` from dropping connections. Because `SQLiteDriver.CancelRunningQuery` was a no-op, long-running queries in SQLite (such as Cartesian joins or recursive CTEs) could not be cancelled by the user.

## Decision

1. **Dialect-Specific Driver Cancellation**:
   - `DatabaseDriver.CancelRunningQuery(ctx context.Context)` remains the canonical entry point called by `sessions.Cancel()`.
   - In SQLite, utilize driver-level context cancellation or `sqlite3_interrupt` / handle cancellation directly on the active statement execution context so that running queries in SQLite immediately terminate with `context.Canceled`.
2. **Frontend Interruption Bypass**:
   - Confirm and preserve `tabApi.ts` design where `CancelQuery` bypasses the serialized `withQueue` call queue, ensuring cancellation requests are dispatched concurrently and immediately without being blocked behind running queries.

## Consequences

- **Pros**: Uniform, reliable query cancellation across all supported database engines (Postgres, MySQL, MariaDB, and SQLite).
