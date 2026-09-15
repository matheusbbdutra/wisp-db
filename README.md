# Wisp

A lightweight, native desktop SQL client (Go + Wails, Webview + React/Monaco) — aiming for DBeaver-level productivity without the JVM/Electron memory footprint.

📖 [Leia em português (README.pt-BR.md)](docs/README.pt-BR.md)

See `docs/ARCHITECTURE.md`, `docs/adr/` and `docs/ROADMAP.md` for design decisions and the phased plan.

## Status

Early beta (`v0.1.0-beta.x`). Supported databases today: **PostgreSQL** and **SQLite**. See [Releases](https://github.com/matheusbbdutra/wisp-db/releases) for prebuilt `.deb` packages (Debian 12+/Ubuntu 22.04+).

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

## Testing locally (Postgres via Docker)

```bash
cd testdata
docker compose up -d
```

Starts a Postgres 16 instance on `localhost:5432` (user/password/db: `wisp`/`wisp`/`wisp_test` — local test credentials, never use in production) with a seed applied automatically (`postgres-seed.sql`): a table with a simple PK, a table with a composite PK, and a table with a generated column — covering the cases from `docs/adr/0004-inline-edit-safety.md`.

DSN to use in the connection manager: `postgres://wisp:wisp@localhost:5432/wisp_test`

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
