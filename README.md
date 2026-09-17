<div align="center">
  <img src="build/appicon.png" width="120" height="120" alt="Wisp logo">

  # Wisp

  **A lightweight, native desktop SQL client** — built with [Wails](https://wails.io) (Go backend, native Webview + React/Monaco frontend), aiming for DBeaver-level productivity without the JVM/Electron memory footprint.

  [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
  [![Built with Wails](https://img.shields.io/badge/built%20with-Wails-DF0000?logo=wails&logoColor=white)](https://wails.io)
  [![Go](https://img.shields.io/badge/Go-1.21%2B-00ADD8?logo=go&logoColor=white)](https://go.dev)

  📖 [Leia em português](docs/README.pt-BR.md)
</div>

---

See `docs/ARCHITECTURE.md`, `docs/adr/` and `docs/ROADMAP.md` for design decisions and the phased plan.

## Status

Early beta (`v0.1.0-beta.x`). Supported databases today: **PostgreSQL**, **SQLite**, **MySQL 8+**, and **MariaDB 10.11+**. See [Releases](https://github.com/matheusbbdutra/wisp-db/releases) for prebuilt packages:
- `.deb` for Debian 12+ / Ubuntu 22.04+
- `.pkg.tar.zst` for Arch (via `packaging/arch/PKGBUILD`)

Idle RAM with one active connection, measured (not aspirational): **~160MB** — the whole point of going native (Wails) instead of Electron.

## Features

- Multiple independent console tabs (isolated connection per tab, cancel a running query without killing the connection).
- Real streaming result fetch (cursor-based, configurable batch size — never loads a whole result set into memory).
- SQL autocomplete (tables, columns, schemas, keywords, dialect-specific built-in functions), SQL pretty-print, automatic keyword uppercasing.
- Result grid: multi-select copy, "copy as" CSV/INSERT SQL/Markdown, inline cell editing (real primary key detection only — never a heuristic; see ADR 0004).
- Table/schema explorer as its own tab: Data / DDL / Triggers / Functions / Columns, opened via the ↗ icon or Ctrl+click (in the sidebar and inside the SQL editor itself, DBeaver-style).
- Multiple result tabs per console (running another query never discards the previous result) with an execution queue (running a query while another is in flight queues it instead of blocking the UI).
- Resizable panels (sidebar width, editor/grid split) via drag.
- Saved connections (encrypted at rest, OS keychain for the master key), query history, named saved scripts.

## System requirements (Linux)

- Go 1.21+
- Node 18+
- `webkit2gtk-4.1` (Arch dropped the `webkit2gtk-4.0` package; the build tag below is required)

## Build

This system only has `webkit2gtk-4.1` installed, so **every build/dev run needs the `webkit2_41` tag**:

```bash
wails build -tags webkit2_41
wails dev -tags webkit2_41
```

Without the tag, the build fails with `Package 'webkit2gtk-4.0' not found` even with the 4.1 package installed — that's a package-naming difference between distros, not a missing dependency.

## Testing locally (SQLite)

Generate a sample database:

```bash
sqlite3 testdata/sample.db < testdata/seed.sql
```

Run `wails dev -tags webkit2_41`, then create a SQLite connection pointing at `testdata/sample.db` from the connection manager.

## Testing locally (Postgres / MySQL / MariaDB via Docker)

```bash
cd testdata
docker compose up -d
```

Starts a Postgres 16 instance on `localhost:5432` (user/password/db: `wisp`/`wisp`/`wisp_test` — local test credentials, never use in production), plus MySQL 8.4 on `localhost:3306` and MariaDB 11 on `localhost:3307` (same `wisp`/`wisp`/`wisp_test` credentials). Each has a seed applied automatically: `postgres-seed.sql` covers three schemas, a simple PK, a composite PK, a generated column, JSON/XML columns, indexes, foreign keys (including cross-schema), triggers, functions, and views; `02-mysql-seed.sql` covers the same scope plus a `reporting` schema with cross-schema FKs. Seeds only run on the container's first initialization; recreate from scratch with `docker compose down -v && docker compose up -d` if you need to reapply.

DSNs to use in the connection manager:
- Postgres: `postgres://wisp:wisp@localhost:5432/wisp_test`
- MySQL / MariaDB: `wisp:wisp@tcp(localhost:3306)/wisp_test?parseTime=true` (port `3307` for MariaDB)

`parseTime=true` is required for MySQL/MariaDB — without it `DATE`/`DATETIME` columns arrive as `[]byte` in the IPC payload and the grid shows unreadable base64.

To tear down: `docker compose down` (from `testdata/`). `docker compose down -v` also removes the data volume.

## Running the test suite

```bash
go test ./...                 # Go backend — real SQLite (temp file) and real Postgres
                               # (skips the Postgres-backed tests gracefully if the
                               # instance above isn't running)
cd frontend && npm run test   # Vitest — pure logic (no DOM/React needed)
```

No mocks in place of a real database anywhere in the suite — that's a hard project rule (see `CLAUDE.md`).

## Structure

- `internal/db` — `DatabaseDriver` interface (Strategy pattern), one implementation per SQL dialect.
- `internal/session` — Session Manager, isolation by `tabId` (dedicated connection + cancellation).
- `internal/store` — local SQLite persistence (connections, history, schema cache).
- `frontend/` — React + TypeScript webview (Monaco Editor, Glide Data Grid).

## Contributing

See `CONTRIBUTING.md`.

## License

[MIT](LICENSE).
