# ADR 0010 — Multi-Object Schema Catalog and Modular UI Architecture

**Status:** Accepted
**Date:** 2026-09-22

## Context

When opening a schema view in Wisp (`SchemaTab.tsx`), the interface currently displays only tables (and views labeled inline as `Kind: "view"`). Relational databases group multiple first-class objects within a schema:
- Tables
- Views
- Functions & Stored Procedures
- Sequences

While `DatabaseDriver` already implements `ListFunctions`, this capability is not exposed through the Wails IPC bridge for general schema browsing, and sequences are not represented in the driver contract. 

Furthermore, existing files are approaching size limits (`app.go` ~790 lines, `Sidebar.tsx` ~302 lines). Adding multi-object discovery and rendering directly into `SchemaTab.tsx` or `Sidebar.tsx` risks turning them into unmaintainable god components.

## Decision

1. **Driver Interface Extension (`internal/db/driver.go`)**:
   - Add `ListSequences(ctx context.Context, schema string) ([]Sequence, error)` to `DatabaseDriver`.
   - Postgres driver queries `information_schema.sequences` / `pg_sequences`.
   - SQLite and MySQL drivers return empty slices without error (neither dialect treats standalone sequences as independent schema objects in the standard way).
   - Functions are surfaced using the existing `ListFunctions(ctx, schema)` implementation.
2. **Aggregated Schema Catalog DTO**:
   - Define a single consolidated DTO in Go to transport schema objects over the IPC bridge in a single payload rather than 4 separate calls:
     ```go
     type SchemaObjects struct {
         Tables    []Table    `json:"tables"`
         Views     []Table    `json:"views"`
         Functions []Function `json:"functions"`
         Sequences []Sequence `json:"sequences"`
     }
     ```
3. **Modular Frontend Decomposition (Anti-God-Component)**:
   - Extract schema data retrieval into a dedicated hook: `useSchemaObjects.ts`.
   - `SchemaTab.tsx` acts purely as a layout container (~120 lines) with categorized tabs/pills (`Tables`, `Views`, `Functions`, `Sequences`).
   - Object lists are rendered via lightweight specialized subcomponents (`SchemaObjectList.tsx`).
   - Clicking a function opens its definition in `RoutineTab.tsx` (reusing the existing Monaco read-only viewer).
   - `Sidebar.tsx` introduces structured groupings or badges to cleanly distinguish object types without expanding into multiple nested hierarchies.

## Consequences

- **Pros**: Complete schema exploration (Tables, Views, Functions, Sequences); strict adherence to SRP (Single Responsibility Principle) prevents file bloat; reuses existing UI components (`RoutineTab.tsx`).
- **Cons**: Minor addition to `DatabaseDriver` interface requiring implementation across all three dialect drivers.
