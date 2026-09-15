# ADR 0004 — Inline cell editing: scope restricted for data safety

**Status:** Accepted
**Date:** 2026-09-14

## Context
Inline grid editing (auto-generating an `UPDATE` from an edited cell) is the single largest potential source of silent data corruption in the whole product: tables without a PK, composite PKs, generated/computed columns, and concurrency (another process changing the row between fetch and save) are real cases, not hypothetical ones.

## Decision
1. **Enabled by capability, not by heuristic.** When loading table metadata, the backend marks `isEditable: bool` based on a real PK from the catalog (simple or composite). Never assume uniqueness by column name (e.g. treating `id` as a PK without checking the real constraint).
2. **Generated/computed columns are always read-only**, detected via catalog metadata (`GENERATED ALWAYS AS` in Postgres, per-dialect equivalents).
3. **SQL preview before committing**: the generated `UPDATE` is shown to the user (popover/confirmation) before running — never silent.
4. **Optimistic concurrency check**: `WHERE pk = ? AND old_column = ?` using the value read at fetch time, not just the PK. If `0 rows affected`, explicitly warn the user instead of assuming success.
5. Table with no detectable PK: the grid stays **read-only with a visible notice**, never a silent failure after a save attempt.

## Alternatives considered
- **Free editing without a PK check**: rejected — silent-corruption risk incompatible with a production client.
- **Custom SQL parser to infer PK/uniqueness**: rejected — already-fixed decision not to build a custom parser (see `ARCHITECTURE.md`); the database's native catalog already exposes this information reliably.

## Consequences
- Phase 3's scope is deliberately restricted: only tables with a detectable simple/composite PK enter the inline-editing MVP.
- Requires the `DatabaseDriver` (Strategy) to expose PK and generated-column introspection per dialect — this becomes part of the interface contract, not optional.
