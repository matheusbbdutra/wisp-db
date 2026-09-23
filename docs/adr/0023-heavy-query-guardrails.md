# ADR 0023 — Heavy Query Guardrails: Row Caps, Timeouts, and Connection Discipline

**Status:** Accepted
**Date:** 2026-09-23

## Context

Wisp's interactive query flow already mitigates large results through on-demand batch fetching (`ExecuteStreaming` + `FetchNext`, default 200 rows per batch, configurable via the ConsoleRunBar — see `ARCHITECTURE.md` and the `DatabaseDriver` interface in `internal/db/driver.go:182-193`). Per-tab session isolation ensures one slow query cannot starve other tabs (`internal/session/manager.go`), and native driver-level cancellation is uniform across Postgres, MySQL, MariaDB, and SQLite (ADR 0015). Together, these provide streaming, cancellation, and isolation.

Three gaps remain that can degrade or break the app on hostile or pathological workloads:

1. **No hard row cap.** A user can issue `SELECT * FROM huge_table` without `LIMIT`, then click "Load more" repeatedly. Each click triggers `FetchRows(tabID, batchSize)`. The frontend validates only the configured batch size; there is no enforced ceiling across the cumulative session (server-side `LIMIT` is not injected). With a configured batch size of 1,000,000 rows, a single misclick could request a buffer that blows the RAM budget (target: <500MB idle — see `AGENTS.md`).

2. **No query timeout.** `ExecuteStreaming` and `FetchNext` propagate the session `QueryCtx`, but neither derives it from `context.WithTimeout`. Cancellation is purely manual via the Cancel button (ADR 0015). A query that hangs in the server (lock contention, runaway planner, network stall mid-stream) sits indefinitely consuming server-side resources until the user notices — silent degradation. Confirmed by inspection: `grep -n "context.WithTimeout" internal/db/*.go` (excluding `_test.go`) returns zero hits; only `PRAGMA busy_timeout = 5000` exists in `internal/db/sqlite.go:71`, which is lock-contention specific, not query timeout.

3. **No connection pool hygiene.** `internal/db/postgres.go` and `internal/db/mysql.go` do not call `SetMaxOpenConns`, `SetMaxIdleConns`, `SetConnMaxLifetime`, or `SetConnMaxIdleTime`. Although the Session Manager enforces "one connection per tab" (so pool size scales with tab count, not request concurrency), no idle or max-lifetime timeout exists — a tab closed by the OS or a forgotten UI state can leave stale connections indefinitely, defeating AGENTS.md's "tab close cancels the session" guarantee at the network layer.

## Decision

Introduce three guardrails layered on top of the existing streaming infrastructure. Each is configurable per connection in the Connection modal; defaults match the `AGENTS.md` performance targets.

### 1. Server-Side Hard Row Cap (`MaxRows`)

**Default: 1,000,000 rows per result** (configurable 100,000 – 10,000,000 per connection).

When `FetchNext` reaches this cumulative threshold for the current cursor, the driver stops fetching and returns `hasMore=false` along with a new `truncated: true` flag on `FetchBatch`. The frontend displays a "truncated at N rows" banner and disables further "Load more" clicks for that cursor. The cap is enforced **server-side** by wrapping the open cursor with a subquery `LIMIT` (when the underlying driver does not enforce it natively), not only in the frontend — a misbehaving frontend cannot bypass it.

Rationale: 1M rows × ~10 columns × ~50 bytes/cell ≈ 500MB worst case (the upper bound of the RAM budget). For most realistic workloads, the cap is never reached; the goal is to **fail visibly**, not to optimize the median case.

Implementation surface:

- `db.DatabaseDriver.FetchNext(ctx, n int, remaining int)` — signature change: add `remaining` budget.
- `internal/db/postgres.go` and `internal/db/mysql.go`: when remaining <= 0, close cursor and return `(nil, false, nil)`; the upstream `ExecuteStreaming` then re-wraps with `SELECT * FROM (<original>) LIMIT <cap>` on the next query start (avoids per-fetch wrapping overhead).
- `internal/db/sqlite.go` already buffers the entire result into memory; cap is enforced by counting returned rows and short-circuiting `rows.Next()`.
- `app_query.go`: `FetchBatch` gains `Truncated bool`.
- `app.go`: expose `MaxRows` as a connection option in `ConnectionModal`.
- Frontend (`ConsoleTab.tsx` / `useResultExecution.ts`): show banner and disable Load more when `Truncated`.

### 2. Query Timeout (`QueryTimeout`)

**Default: 60 seconds** (configurable 5s – 1h per connection).

`session.Manager.StartQuery` derives the `QueryCtx` with `context.WithTimeout(s.Ctx, s.QueryTimeout)`. On timeout, the driver's `FetchNext` and `ExecuteStreaming` propagate `context.DeadlineExceeded`. The frontend displays "Tempo esgotado após Xs" and clears the cursor.

For defense-in-depth (Go ctx propagation occasionally misses blocking native calls in pgx/`go-sql-driver`), additionally enforce server-side:

- **Postgres**: `SET statement_timeout = '<ms>ms'` on connect.
- **MySQL/MariaDB**: `SET SESSION MAX_EXECUTION_TIME = <ms>` on connect (available since MySQL 5.7.8 / MariaDB 10.1.1).
- **SQLite**: no native statement timeout; Go ctx timeout suffices.

Rationale: 60s is generous enough for analytical queries without making the user wait indefinitely on stuck queries. Server-side enforcement ensures the timer applies even if Go ctx propagation misses a native call (documented in pgx issues).

Implementation surface:

- `session.Session`: gain `QueryTimeout time.Duration` (default 60s).
- `internal/session/manager.go:181` `StartQuery`: derive `context.WithTimeout(s.Ctx, s.QueryTimeout)`.
- `internal/db/postgres.go:Connect`: run `SET statement_timeout = '<ms>ms'` after `Ping`.
- `internal/db/mysql.go:Connect`: run `SET SESSION MAX_EXECUTION_TIME = <ms>` after `Ping`.
- `app.go` `ConnectionModal`: expose `QueryTimeout` (number input, default 60, unit seconds).

### 3. Connection Pool Hygiene (`ConnMaxLifetime` / `ConnMaxIdleTime`)

**Defaults: ConnMaxLifetime = 30 minutes, ConnMaxIdleTime = 5 minutes**.

Applied at `Connect` time on the underlying `*sql.DB` for Postgres/MySQL/SQLite. Pool sizing remains implicit (one conn per tab, no shared pool — already enforced by the Session Manager), but idle and stale connections are recycled.

Rationale: 30 minutes is a reasonable upper bound for connections sitting through network changes (DHCP renewals, VPN reconnects, NAT timeouts). 5 minutes idle ensures forgotten tabs do not accumulate stale sockets.

Implementation surface:

- `internal/db/postgres.go:Connect`: after pool creation, `pool.Config().ConnConfig.ConnectTimeout` is implicit via ctx; add explicit `db.SetConnMaxLifetime(30 * time.Minute)` and `db.SetConnMaxIdleTime(5 * time.Minute)`.
- `internal/db/mysql.go:Connect`: same on the `*sql.DB` returned by `sql.Open`.
- `internal/db/sqlite.go`: `SetConnMaxLifetime` is a no-op for in-memory/file SQLite; safe to call defensively.
- `app.go` `ConnectionModal`: expose both values as advanced settings.

## Alternatives considered

- **Eject the entire result client-side and discard**: rejected — wastes network bandwidth and server-side memory for a query the user did not intend to run.
- **Force-inject `LIMIT` into every SELECT without explicit user opt-in**: rejected — silently changing user queries is worse than failing visibly; the right UX is a warning plus an explicit "I know what I am doing" override.
- **Go `context.WithTimeout` only, without server-side `statement_timeout` / `MAX_EXECUTION_TIME`**: accepted as a baseline, but Postgres/MySQL native driver calls occasionally miss ctx propagation in blocking code paths (documented in pgx issue tracker); server-side enforcement is cheap insurance.
- **Honour `idle_in_transaction_session_timeout`**: orthogonal, set per-server, not client-tunable here — out of scope.

## Consequences

**Pros**:

- Visible, predictable failures on pathological queries (truncation banner, deadline-exceeded message) instead of silent RAM growth.
- Bounded memory footprint aligned with `AGENTS.md`'s <500MB idle target.
- Stale connections from closed tabs are recycled, freeing server-side resources.

**Cons**:

- Four new fields in the Connection modal (`MaxRows`, `QueryTimeout`, `ConnMaxLifetime`, `ConnMaxIdleTime`) — minor UI complexity.
- `FetchNext` signature change ripples to all driver implementations and tests; mitigated by updating tests in the same PR.

## Acceptance Criteria

1. A query returning >1M rows against the configured cap completes with `truncated: true` on `FetchBatch`; the frontend banner reads "Resultado truncado em 1.000.000 linhas (use LIMIT para resultados menores)".
2. A `SELECT pg_sleep(120)` against a real Postgres server triggers `context.DeadlineExceeded` returned to the frontend within 60s ± 2s of `RunQuery` returning.
3. Closing tab A while its connection is idle for >5 minutes causes the underlying connection to be closed and reopened on the next query (verified via server-side `pg_stat_activity` / `SHOW PROCESSLIST`).
4. `go test ./...` passes; `npm run build` is clean.