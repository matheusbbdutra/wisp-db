# ADR 0005 — SQL formatting via an off-the-shelf lib (`sql-formatter`)

**Status:** Accepted
**Date:** 2026-09-15

## Context
SQL pretty-printing (DBeaver's "Format SQL" style) was a pending Phase 2 item. The project's "no custom SQL parser" rule (see `docs/ARCHITECTURE.md`) exists to keep Wisp from building its own parser/language-service for features like autocomplete — writing an in-house formatter would incur the same maintenance cost with no benefit.

## Decision
- Use the npm library **`sql-formatter`** (MIT, mature, typed in TS) — installed version `15.8.2` — entirely in the frontend, synchronous, no new backend binding.
- Dialect mapping from the tab's active `driver`: `postgres` → `postgresql`, `sqlite` → `sqlite`, anything else/undefined → `sql` (generic). Names confirmed against the installed version's `supportedDialects`.
- A "Format" button in `ConsoleTab.tsx`'s `.toolbar-secondary`; formats the whole editor (no "format selection" — extra scope not requested). A parsing error doesn't lock up the UI: it's shown in the `status` line and the original content stays untouched.

## Alternatives considered
- **A custom formatter/parser**: rejected — violates the no-custom-parser rule and reinvents what a mature MIT library already solves. Analogous to ADR 0001's decision to use the off-the-shelf Glide Data Grid instead of a custom virtualized grid.
- **Formatting via the Go backend**: rejected — no equivalent mature Go library, and it would add an IPC round-trip for something purely presentational.

## Consequences
- New npm dependency (checked: trustworthy source, active maintenance, MIT license).
- No configurable indentation style for now — library defaults; only reopen with a real user request.
