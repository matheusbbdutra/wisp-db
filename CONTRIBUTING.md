# Contributing to Wisp

## Before you start

1. Read `docs/ARCHITECTURE.md` and the ADRs in `docs/adr/`.
2. Read `STATE.md` to see what's already decided and what's in progress.
3. Read `CLAUDE.md` if you're using an AI agent to contribute — it defines the project's specific rules. Note: `CLAUDE.md` and `STATE.md` are written in Brazilian Portuguese (the maintainer's working language for internal notes); the public-facing docs (this file, `README.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, ADRs) are in English.

## Workflow

1. Any change that revisits a decision listed in `CLAUDE.md` or `docs/adr/` needs a new ADR (`docs/adr/000N-title.md`), not just a code comment.
2. Small, focused PRs — one logical change per PR.
3. Before opening a PR: `gofmt`/`goimports` on the backend, the frontend's standard lint, and the "Definition of done" checklist in `CLAUDE.md`.

## Tests

- Tests against database drivers: use a real instance (local Docker, e.g. `docker compose -f testdata/docker-compose.yml up -d` for Postgres, a real temp-file SQLite database for SQLite) — never a pure mock to validate driver behavior. Mocks hide real dialect-behavior divergence.
- Don't write a unit test for code that doesn't exist yet (project-wide rule).

## Commit structure

- Commit messages describing the "why", not just the "what".
- Reference the related ADR when a change implements a documented decision (e.g. `Implement ADR 0002: build matrix for DuckDB`).
