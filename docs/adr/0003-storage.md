# ADR 0003 — Internal storage: SQLite (not JSON, not Turso), no vector search

**Status:** Accepted
**Date:** 2026-09-14

## Context
Wisp needs to persist locally: saved connections (with credentials), executed query history, and schema metadata cache (table/column catalog per connection).

## Decision
- **SQLite via `modernc.org/sqlite`** (pure Go, no CGO) for the entire internal store.
- **Not loose JSON on disk**: lacks transactional atomicity (risk of corruption on a crash mid-write) and doesn't scale well for filtered queries (history by date/connection/status).
- **Not Turso/libSQL**: Turso solves distributed/multi-replica sync, a scenario that doesn't exist in the current scope (the app is local, single-user, single-process). Adopting it would introduce a network dependency and operational complexity with no real need.
- **No vector search/embeddings** in the schema cache: table/column search is exact or prefix-match; SQLite's native FTS5 covers fuzzy name search if ever needed. Embeddings would add generation/indexing cost with no gain for this use case.

## Initial schema (reference, subject to migration)
```sql
connections(id, name, driver, host, port, database, username, encrypted_secret, ssh_tunnel_config, created_at)
query_history(id, connection_id, tab_id, query_text, executed_at, duration_ms, status, row_count)
schema_cache(connection_id, catalog_json, fetched_at, ttl_expires_at)
```
- `encrypted_secret`: encrypted with a derived key; the master key lives in the OS keychain (`go-keyring` or equivalent), never in plaintext in SQLite.
- `catalog_json`: a per-connection JSON blob — acceptable here because it's write-once/read-often per connection, not a relational entity with multiple concurrent writers.

## Update 2 (schema cache, 2026-09-14)
`schema_cache` also changed from the original draft: instead of `connection_id TEXT PRIMARY KEY REFERENCES connections(id)`, the key is `cache_key` — a SHA-256 hash of `driver|dsn` (see `internal/schemacache.Key`), with no FK. Reason: ad-hoc connections (via a direct DSN, without `SaveConnection`) also benefit from caching, and they have no `connection_id`. Implemented in `internal/schemacache` (two-tier cache: memory + `Store`, 15-minute TTL, manual invalidation and invalidation on detected DDL — see `app.go`, `isDDL`). Validated with real execution: hit/miss, persistence across simulated app "restarts", TTL expiration, and manual/propagated invalidation.

## Update (real implementation, 2026-09-14)
The implemented `connections` schema differs from the draft above: instead of separate `host/port/database/username`, the **full DSN is encrypted as a single field** (`encrypted_secret`). A pragmatic decision — decomposing the DSN per dialect (Postgres, SQLite, and eventually ClickHouse/MySQL have quite different formats) is driver-specific work with no real gain for the MVP. Only reopen this if a real need shows up to edit a single field (e.g. changing just the password) without retyping the whole DSN. See `internal/store/store.go` and `internal/vault/vault.go` (ChaCha20-Poly1305 encryption, master key in the OS keychain via `go-keyring`, validated on this system with Secret Service/gnome-keyring).

## Future reopening (out of scope for now)
- If a real need for **syncing saved connections across devices** appears, revisit Turso as an option at that point — not before.
- If a real need for **semantic search over query history** appears (e.g. "queries similar to this one"), consider `sqlite-vec` (a SQLite extension, still a local file) — never an external vector service, to keep the local-app-with-no-network-dependency philosophy.

## Consequences
- A single local `.db` file holds the app's entire state — trivial backup/restore (copy the file).
- Requires a schema migration routine (`schema_cache`/`connections` versioning) as the product evolves.
