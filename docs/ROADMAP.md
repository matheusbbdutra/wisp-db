# Wisp — Roadmap

See `docs/ARCHITECTURE.md` and the ADRs in `docs/adr/` for the rationale behind each decision cited here.

## Phase 1 — Functional MVP ✅ complete (2026-09-15)
- ✅ Native connection to PostgreSQL and local SQLite (DuckDB not implemented yet, see ADR 0002).
- ✅ Query execution with a dedicated `tabId` and real native cancellation (not just a local ctx — see the `pgx-context-cancel-closes-connection` note).
- ✅ Virtualized grid (Glide Data Grid), real streaming fetch (cursor-based, not a full scan), configurable pagination (default 200, "Load more").
- ✅ Local SQLite store: encrypted connections, query history.
- ✅ **Performance target actually measured**: idle RAM ~158-164MB (target was <500MB).

## Phase 2 — Productivity & Autocomplete
- ✅ Sidebar with a lazy schema/table tree.
- ✅ Two-tier schema cache, TTL + manual/DDL invalidation.
- ✅ Persisted query history, UI panel.
- ✅ Monaco autocomplete via the schema cache — completed 2026-09-15 (schemas, tables, columns, keywords, per-dialect functions, dot-narrowing).
- ✅ SQL formatting (pretty-print) — completed 2026-09-15: a "Format" button in `ConsoleTab.tsx`'s toolbar via the `sql-formatter` lib (see ADR 0005).

## Phase 2.5 — Multi-console and organization ✅ complete (2026-09-15)
- ✅ Multiple tabs/consoles (Session Manager isolates by `tabId`, tab UI in `App.tsx`/`ConsoleTab.tsx`).
- ✅ Saving named SQL scripts (distinct from automatic history) — `ScriptsPanel.tsx`.

## Phase 2.6 — Schema exploration / View Data + Copy ✅ complete (2026-09-15)
- ✅ Inline cell editing — ADR 0004, with a real PK via introspection (never a heuristic), optimistic concurrency check.
- ✅ Table as its own tab (Data/DDL/Triggers/Functions/Columns per table), Schema as its own tab (table list), opened via ↗ or Ctrl+click (in the sidebar and inside the SQL editor).
- ✅ Special copy in the result grid (cell/row/selection, CSV/INSERT SQL/Markdown).
- ✅ **`v0.1.0-beta.1` through `v0.1.0-beta.3` released** (github.com/matheusbbdutra/wisp-db).

## Phase 3 — Closing the DBeaver-migration gap (next batch, prioritized 2026-09-15)
Analysis done via Cursor Agent + OpenCode (independently) plus the maintainer's own judgment. Both analyses converged: the biggest remaining gap to replace DBeaver day-to-day isn't agent integration or a query builder — it's object exploration and data-inspection ergonomics. Suggested order (to confirm with the maintainer before implementing each item):
1. **Indexes, FKs, and distinguishing Views from tables** in schema exploration — `ListTables`/`TableDDL` don't expose this today; it's the thing most missed when opening an unfamiliar table. Medium effort, low/medium risk.
2. **Quick ergonomics wins**: a value viewer for long text/JSON(B) currently truncated in the grid; a quick filter in the table tab; search in the sidebar tree (schemas with many tables). All small, low risk.
3. **EXPLAIN / execution plan** (v1 as rendered text via `EXPLAIN ANALYZE` — no visual graph yet).
4. **Row INSERT/DELETE in the grid** (closes the loop started by inline editing/ADR 0004 — today only `UpdateCell` exists). Same real-PK and preview rules; without a PK, read-only. Medium risk.
5. **Update checker** (manual/on-open check, no automatic download): queries the GitHub Releases API (`/repos/.../releases/latest`), compares it against the version embedded in the binary, shows a notice with a link if a newer one exists. Wails has no built-in updater (unlike Electron's `autoUpdater`/Tauri's updater) — v1 scope is notification only, never auto-downloading/replacing the binary. Small effort, low risk (just reading a public API, nothing critical touched).

**✅ Completed out of order** (direct maintainer request on 2026-09-15, shipped in `v0.1.0-beta.2`/`v0.1.0-beta.3`): result tabs (running another query never overwrites the previous result), an execution queue (running a query queues it instead of blocking the UI while another runs), resizable panels via drag (sidebar, editor/grid split), and a real "conn busy" concurrency fix that serializes every backend call per tab.

Outside the next batch, but recorded because the two analyses diverged on it (not dropped, just no evidence of demand yet):
- **MySQL driver** (or another dialect): the project is open source and will grow beyond the maintainer's own use (Postgres/SQLite only today), so this should come back on the table once real demand from other users appears — don't implement speculatively before that.
- **Explicit transactions** (autocommit toggle, manual commit/rollback): the deeper analysis (OpenCode) flagged this as the highest architectural risk item in the batch — it touches a Session Manager invariant (what happens to an open streaming cursor inside a transaction). Design carefully, only once the rest of Phase 3 has settled.
- Terminal-agent integration via an MCP server exposed by Wisp — scope still needs proper design; both analyses agree this solves no DBeaver-migration gap and should stay exploratory, not in the active queue.
- Large dataset exporter (CSV, JSON, Parquet) — the two analyses diverged on priority (one says raise it, the other says keep it low since special-copy to clipboard already covers most real usage); kept as low priority until a stronger usage signal appears.
- **UI translation to English (i18n)**: the app's interface (buttons, labels, messages) is currently Brazilian Portuguese throughout. As the project goes open source, this should move to English (or a language switcher) in a dedicated phase — needs a full string inventory first; not a small change. Public docs (this roadmap, `README.md`, `ARCHITECTURE.md`, ADRs) are already in English as of 2026-09-15; `CLAUDE.md`/`STATE.md` stay in Portuguese (internal working notes).

## Phase 4+ — Future explorations (not committed)
- Visual query builder (Strategy per SQL dialect) — both Phase 3 analyses agree: irrelevant for people who already write SQL, only enters real planning once Phase 3 is stable and demand is validated.
- Semantic search over query history (`sqlite-vec`, never an external vector service) — only with real validated demand.
- Syncing saved connections across devices (would reopen the Turso evaluation) — only with real validated demand.
- **SSH tunnel built into the connection flow** (`crypto/ssh`) — the project will be open source regardless (that's a given, not a condition), but that alone doesn't make the feature urgent: the first user is the maintainer, who already has a VPN covering access to databases behind a firewall. Stays queued, deprioritized until real demand appears (the maintainer's own, or another project user's).
- DuckDB (ADR 0002) — native per-OS CI is a large effort; only enters real planning if a genuine analytical use case shows up, not as a "DBeaver replacement".

## Out of scope (an active decision, not an oversight)
- GPU acceleration in the data pipeline — no identified hot path.
- Custom SQL parser.
- Any network dependency for core functionality (the app works 100% offline except for the user's own database connection).
