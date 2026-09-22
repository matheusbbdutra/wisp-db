# ADR 0009 — Reactive Metadata Cache and Background Lifecycle

**Status:** Accepted
**Date:** 2026-09-22

## Context

In Wisp, schema introspection and autocomplete catalogs are currently driven by a sequential loop inside the frontend React code (`useConnection.ts:loadCatalog`). When a tab connects, it calls `ListSchemas` followed by `IntrospectSchemaTables` per schema, locking the tab's metadata queue (`${tabId}:metadata`).

This creates critical friction points:
1. **Blocking IPC roundtrips**: In databases with large schemas, the sequential JS loop keeps the connection busy and starves user queries.
2. **Destructive TTL eviction**: In `internal/store/store.go:321`, `GetSchemaCacheJSON` deletes the SQLite cache row immediately upon TTL expiration (`15 * time.Minute`). When reopening or reconnecting after 15 minutes, the cache is purged and must be fetched from scratch.
3. **Ambiguous history and cache lifecycle**: Normal connection disconnects and reconnects flush memory state, while `DeleteConnection` in `store.go:181` leaves orphaned records in `schema_cache` and `query_history`.

## Decision

1. **Stale-While-Revalidate Policy**:
   - `GetSchemaCacheJSON` in `internal/store` will never delete records on TTL expiration.
   - On tab connection, existing cached metadata in SQLite is served immediately via a direct synchronous read (sub-10ms latency).
2. **Background Go Goroutines for Network Introspection**:
   - Network introspection is moved entirely out of the frontend React loop.
   - The Go backend manages introspection in a background goroutine using a dedicated introspection connection, avoiding contention on the user's console query connection.
3. **Reactive Domain Events via Wails IPC**:
   - As new or updated schema metadata is discovered by the background worker, the backend persists it to SQLite and emits `runtime.EventsEmit(ctx, "catalog:updated", schemaData)`.
   - The frontend subscribes via `runtime.EventsOn` to receive catalog deltas without polling or locking IPC queues.
   - DDL statements executed in the console trigger targeted `catalog:invalidated` events.
4. **Explicit History and Cache Deletion Lifecycle**:
   - Query history (`query_history`) and schema cache are never dropped on connection open, close, or reconnect.
   - A connection's cache (`schema_cache WHERE cache_key = ?`) and query history (`query_history WHERE connection_id = ?`) are pruned **only** when the user explicitly deletes the saved connection via `DeleteSavedConnection`.

## Consequences

- **Pros**: Zero UI blocking upon connection; autocomplete and schema trees render instantaneously from local SQLite; query history is preserved reliably.
- **Cons**: UI may display slightly stale metadata for a few seconds on initial connection while the background worker revalidates against the remote database.
