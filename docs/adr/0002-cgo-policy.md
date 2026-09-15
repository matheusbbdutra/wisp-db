# ADR 0002 — CGO policy: avoid by default, documented exception for DuckDB

**Status:** Accepted
**Date:** 2026-09-14

## Context
The original proposal set "avoid CGO" as an absolute rule, to simplify cross-compilation (Linux/macOS/Windows × amd64/arm64). A practical check (official documentation, September 2026) showed that:

- `pgx` (Postgres), `clickhouse-go` (ClickHouse), `go-sql-driver/mysql` (MySQL), and `modernc.org/sqlite` (SQLite, transpiled from C to Go) are **100% Go, no CGO**.
- `go-duckdb` (marcboeker) and its official successor `duckdb/duckdb-go` **require CGO** — they link against the native `libduckdb`. No mature, pure-Go DuckDB driver exists today. Cross-compiling requires `CGO_ENABLED=1` plus a cross C toolchain (`CC=...`) per OS/arch combination.
- DuckDB is in the Phase 1 (MVP) scope, so the absolute "no CGO" rule would break at the very first milestone.

## Decision
- **General rule**: always prefer a 100% Go driver when a mature, maintained option exists.
- **Documented exception**: DuckDB requires CGO. This is accepted because it's the only exception in the matrix, not the norm.
- **Build strategy**: release builds with DuckDB support run on **native per-OS runners** (GitHub Actions macOS/Linux/Windows), avoiding forced cross-compilation whenever possible. Cross cross-compilation (`CGO_ENABLED=1` + a cross `CC`) is only used if a need arises for an arch not covered by a native runner (e.g. Linux ARM64 from an amd64 runner).
- Wisp's **internal store** SQLite uses `modernc.org/sqlite` (no CGO) — the app's base binary stays CGO-free even indirectly, except when the user connects to a DuckDB database.

## Alternatives considered
- **Remove DuckDB from scope**: rejected — it's an explicit product requirement (support for modern analytical databases).
- **Wait for a pure-Go DuckDB driver**: no timeline exists; blocking the roadmap on that isn't reasonable.

## Consequences
- CI needs a build matrix with native per-OS runners, not just a simple cross-platform `GOOS=... go build`.
- The DuckDB-enabled binary is larger and depends on a static `libduckdb` per platform — increases distribution size.
- If a mature pure-Go DuckDB driver appears in the future, revisit this ADR.
