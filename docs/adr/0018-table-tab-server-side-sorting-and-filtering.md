# ADR 0018 — TableTab Server-Side Sorting and Filtering

**Status:** Accepted  
**Date:** 2026-09-22  

## Context

In `frontend/src/components/TableTab.tsx`, navigating to a table loads data using a fixed query:
`SELECT * FROM <qualified> LIMIT 200`
While `ResultGrid.tsx` provides client-side substring filtering via `useGridFilter.ts`, this only filters across rows currently loaded in memory (the initial 200 rows).
Users need:
1. **Server-side column sorting**: Clicking a column header should sort the entire table in the database (`ORDER BY <column> ASC / DESC`), re-querying from row 0.
2. **Server-side query filtering**: Specifying custom filter conditions (e.g. `status = 'active'`, `created_at > '2026-01-01'`) evaluated by the database engine across all table rows.

## Decision

Extend `TableTab.tsx` and `ResultGrid.tsx` to support server-side sort and filter state.

### 1. State Model (`TableTab.tsx`)

Add explicit sort and filter state to `TableTab`:

```typescript
export interface SortConfig {
    column: string;
    direction: 'ASC' | 'DESC';
}

export interface TableFilterConfig {
    rawWhere?: string;                // Custom SQL snippet: "age > 18 AND status = 'active'"
    columnFilter?: {                  // Quick column filter
        column: string;
        operator: '=' | '!=' | '>' | '<' | 'LIKE' | 'ILIKE' | 'IS NULL' | 'IS NOT NULL';
        value: string;
    };
}
```

### 2. Query Assembly

When `sortConfig` or `filterConfig` change, construct the SQL statement dynamically:

```typescript
function buildTableQuery(
    qualifiedTable: string,
    filter: TableFilterConfig | null,
    fkFilter: { column: string; value: any } | null,
    sort: SortConfig | null,
    batchSize: number,
    dialect: string
): string {
    let sql = `SELECT * FROM ${qualifiedTable}`;
    const whereClauses: string[] = [];

    if (fkFilter) {
        whereClauses.push(buildFkCondition(fkFilter, dialect));
    }
    if (filter?.rawWhere) {
        whereClauses.push(`(${filter.rawWhere})`);
    } else if (filter?.columnFilter) {
        whereClauses.push(buildColumnCondition(filter.columnFilter, dialect));
    }

    if (whereClauses.length > 0) {
        sql += ` WHERE ${whereClauses.join(' AND ')}`;
    }

    if (sort) {
        const quotedCol = quoteIdent(sort.column, dialect);
        sql += ` ORDER BY ${quotedCol} ${sort.direction}`;
    }

    sql += ` LIMIT ${batchSize}`;
    return sql;
}
```

### 3. Grid Header Click Interaction (`GridCanvas.tsx` / `ResultGrid.tsx`)

1. Glide Data Grid provides `onHeaderClicked(colIndex, event)`.
2. Map `colIndex` to column name.
3. Inform `TableTab` via `onSortChange(columnName)`:
   - Click 1 on Column A: Sort `ASC` (shows visual indicator `▲` in column header).
   - Click 2 on Column A: Sort `DESC` (shows visual indicator `▼`).
   - Click 3 on Column A: Reset sort (removes `ORDER BY`).
4. Re-fetch the first batch (`RunQuery` + `FetchRows`), resetting the pagination cursor.

### 4. Quick Filter Bar in TableTab

Add a collapsible filter bar at the top of the "Dados" sub-tab:
- Quick Column dropdown (listing table columns).
- Operator selector (`=`, `!=`, `>`, `<`, `LIKE`, `IS NULL`).
- Value input box with "Aplicar" (Enter) and "Limpar".
- Toggle for "Modo Avançado (WHERE customizado)".

## Consequences

- **Pros**:
  - Full server-side sorting and filtering for tables with millions of rows.
  - Retains responsive pagination and Glide Data Grid virtualized rendering.
- **Cons**:
  - Sorting on unindexed columns on large tables may incur query latency on the database server (cancellable via existing `CancelQuery`).

## Acceptance Criteria

1. Clicking a column header in TableTab reloads the data with `ORDER BY <col> ASC`, displaying `▲` next to the column name.
2. Clicking the same header again toggles to `DESC` with `▼`.
3. Applying a filter `status = 'active'` updates the query to `WHERE status = 'active'` and correctly reloads rows.
4. "Carregar mais" loads subsequent rows preserving the active `ORDER BY` and `WHERE` clauses.
