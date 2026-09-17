# ADR 0007 — MySQL/MariaDB driver via `go-sql-driver/mysql`

**Status:** Accepted
**Date:** 2026-09-16

## Context

Wisp today supports only SQLite (`modernc.org/sqlite`) and Postgres (`jackc/pgx/v5`) — see ADR 0001 (stack) and ADR 0002 (CGO policy). The maintainer needs MySQL and MariaDB support in production use (multi-environment setups where dev/staging/prod all share schema/user but differ in host/IP). Phase 4 candidates (sync, SSH, DuckDB) were already cut from the roadmap; the new focus is broadening driver coverage to the most common SQL engines the maintainer actually touches day to day.

Cross-cutting constraints inherited from the existing project rules:
- ADR 0002 forbids CGO except for DuckDB (which has no mature pure-Go driver). New drivers MUST be pure Go.
- Strategy pattern: every dialect implements `internal/db.DatabaseDriver` (see `internal/db/driver.go:141`). No dialect-specific switches outside this package.
- Cancellation must be real at the server side (`pgx.CancelRequest` is the reference). Per-tab isolation via `internal/session.Manager` is unchanged.
- Credentials are stored encrypted as a single DSN string (see ADR 0003 and `internal/store/store.go:5-11`). The driver does not need to know about field-level credential storage.

## Decision

- **Driver library**: `github.com/go-sql-driver/mysql` v1.10.1 (puro Go, MPL-2.0; supports MySQL 8.0+ and MariaDB 10.11+ per the upstream README). License is a weak copyleft (file-level) — compatible with Wisp's open-source distribution model; the obligation is to publish modifications to the driver itself, not to Wisp.
- **MariaDB via the same driver** (`factory.go` maps both `DriverMySQL` and `DriverMariaDB` to `NewMySQLDriver()`). MariaDB's wire protocol is compatible with MySQL's on the application level; the `mariadb:11` image maintains that contract. Driver-level quirks specific to MariaDB (sequences, `SHOW CREATE SEQUENCE`, `INFORMATION_SCHEMA.ROUTINES` returning procedures and functions mixed) are noted as accepted limitations — the MVP coverage is enough to connect and run the standard query/introspection flow.
- **Connection model**: two pools per driver instance — `dataDB *sql.DB` (queries) and `controlDB *sql.DB` (cancellation). Opened with the same DSN during `Connect` (single round-trip auth, two logical connections).
- **DSN**: the `database/sql` driver format, not a URL: `user:pass@tcp(host:port)/db?parseTime=true&tls=...`. `parseTime=true` is mandatory in the DSN we build (default in `ConnectionModal.buildDsn()` and recommended in raw-DSN UI hints); without it, `DATE`/`DATETIME`/`TIMESTAMP` columns arrive as `[]byte` and the existing `normalizeCellValue` converts them to unreadable base64-on-the-wire-style strings in the JSON IPC payload.
- **Schema listing**: MySQL calls them "databases" (`SHOW DATABASES`), filtered to exclude `information_schema`, `mysql`, `performance_schema`, `sys`. The `DatabaseDriver.ListSchemas` contract is preserved.
- **TableDDL**: `SHOW CREATE TABLE \`schema\`.\`table\`` returns the verbatim DDL — significantly simpler than the Postgres reconstruction in `internal/db/postgres.go` (which assembles columns, constraints, and indexes from `information_schema`). Triggers and functions follow the same pattern (`SHOW TRIGGERS` / `SHOW FUNCTION STATUS` / `SHOW CREATE FUNCTION`).
- **Index introspection**: `SHOW INDEX FROM \`schema\`.\`table\``; `Non_unique = 0` marks UNIQUE. Mirrors the SQLite path, returning the same `[]db.Index` shape.
- **Foreign keys**: queried via `information_schema.KEY_COLUMN_USAGE` + `REFERENTIAL_CONSTRAINTS` + `KEY_COLUMN_USAGE` join. Regex-parsing `SHOW CREATE TABLE` was considered and rejected — fragile and dialect-version-sensitive.
- **Binary columns**: identified via `DatabaseTypeName()` on the result columns — `BLOB`, `MEDIUMBLOB`, `LONGBLOB`, `BINARY`, `VARBINARY`. MySQL has no OID concept (unlike Postgres), so the `binaryColumnMask` pattern from the SQLite driver applies directly.
- **Native cancellation via `KILL QUERY <conn_id>`**: the driver does not expose connection IDs, but the cancel can be done manually. Before each query (`Execute`/`ExecuteStreaming`), `SELECT CONNECTION_ID()` runs on `dataDB` and stores the ID in a mutex-protected field. `CancelRunningQuery` reads that ID and runs `KILL QUERY <id>` on `controlDB`. Race window between ID capture and the actual query running is minimized by the mutex but not eliminated; fallback if the ID has been recycled is to close and reopen `dataDB`. This is documented in `internal/db/mysql.go` next to the implementation. **Update 2026-09-17 (after first integration test)**: the KILL QUERY path was dropped because `SELECT CONNECTION_ID()` in the same `*sql.Conn` blocks the next query (a `*sql.Conn` from `database/sql` only allows one statement in flight at a time). Current `CancelRunningQuery` closes the data `*sql.Conn` and asks the pool for a fresh one — any in-flight server-side query on the old connection is interrupted by the server when its TCP socket goes away. Trade-off: a few hundred ms of reconnect latency vs. simpler invariant. KILL QUERY can be layered on later via `multiStatements=true` or a non-reserved `*sql.Conn` if the latency becomes a UX problem. The same single-statement-per-Conn constraint forced `ListTriggers`/`ListFunctions` to drain the metadata cursor fully before running `SHOW CREATE TRIGGER`/`SHOW CREATE FUNCTION` (see the comment in those methods).

## Alternatives considered

- **`godror` (Oracle)**: explicitly rejected. Requires CGO (`-tags oracle` or always-on CGO build), violating ADR 0002. Oracle is also out of scope this round — the maintainer does not currently need it.
- **NoSQL drivers (`mongo-driver`)**: rejected for this round. `DatabaseDriver` is a relational contract (columns + rows + named schemas); supporting document-oriented engines would require a parallel interface and a frontend redesign, which is a separate architecture decision.
- **Decomposing the DSN into structured fields** at the storage layer (`host`/`port`/`user`/`password`/`dbname`/`sslmode` columns): rejected for this round. The current "DSN as opaque encrypted blob" decision in `internal/store/store.go:5-11` is documented as pragmatic for the MVP. The clone-of-connection feature this round uses the pragmatic alternative — backend exposes the decrypted DSN exclusively to `ConnectionModal`, which opens the modal in raw-DSN mode pre-filled with the original string. A structured-fields refactor can be revisited later if multiple consumers need field-level edits.
- **`mysql.NullTime`/custom scanner instead of `parseTime=true`**: rejected. Driver-level parsing is the canonical solution; writing custom `Scan` implementations per driver inflates the codebase for no real benefit.

## Consequences

- New Go dependency: `github.com/go-sql-driver/mysql` v1.10.1 + transitive `filippo.io/edwards25519` v1.2.0 — both pure Go, no CGO impact on the release build matrix.
- MariaDB is functionally a subset of MySQL for this driver. Quirks like sequences and `SHOW CREATE SEQUENCE` remain unimplemented; document a follow-up if real demand surfaces.
- New IPC binding `GetConnectionForEdit` (in `app.go`) intentionally expands the surface where a decrypted DSN crosses the bridge — only ever consumed by `ConnectionModal`. This is a conscious trade-off and is documented in the method comment + STATE.md, not buried in a low-level helper.
- Cancellation is best-effort within the mutex-protected race window. Worst-case behavior is a slightly slower cancel (close + reopen `dataDB`) rather than a hung query — acceptable for an interactive SQL client.
- Same RAM profile as the existing drivers: one connection per pool, two pools per session, no streaming result buffering. Meta: keep the < 500MB idle RAM target from ADR 0001.
- ADRs 0001 (stack) and 0002 (CGO policy) are not contradicted — the new driver fits both.
