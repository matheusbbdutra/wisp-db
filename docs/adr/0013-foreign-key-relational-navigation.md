# ADR 0013 — Foreign Key Relational Navigation in Result Grid

**Status:** Accepted  
**Date:** 2026-09-22  

## Context

When inspecting data in `ResultGrid` (whether from an ad-hoc query in `ConsoleTab` or viewing a table in `TableTab`), rows frequently contain foreign key reference IDs (e.g., `customer_id = 42`, `tenant_id = 'abc'`).

Currently, finding the referenced parent record requires manual interaction:
1. Opening a new console tab or table tab;
2. Remembering the target schema, table name, and primary key column;
3. Typing and executing `SELECT * FROM <parent_table> WHERE id = <value>`.

This causes substantial friction and context switching.

## Decision

1. **Foreign Key Metadata Mapping in Grid Columns**:
   - Utilize existing table introspection metadata (`ListForeignKeys` / `ForeignKey` mappings) to annotate columns in `editContext` or `QueryMetadata` that map to a target `(target_schema, target_table, target_column)`.
2. **Visual Affordance & Cell Action**:
   - Render a subtle key/link affordance (e.g. 🔗 or indicator) on cells with active foreign key references.
   - Support direct navigation via click or context menu ("Navigate to referenced record").
3. **Navigation Behavior: Open in New Dedicated Tab**:
   - When triggered on a cell value (e.g., `customer_id = 42`), the application will **open a new tab** (a dedicated `TableTab` pre-filtered by the target key or a dedicated `ResultTab` executing `SELECT * FROM <target_table> WHERE <target_column> = <value>`).
   - In-place navigation with a "Back" button was explicitly rejected: replacing the current grid in-place invalidates the user's scroll position, active filters, loaded batches, and pending row selections. Opening a separate tab preserves the parent query state intact and allows returning simply by closing the child tab (`Ctrl+W`).

## Consequences

- **Pros**: Instant relational drill-down matching workflows from DBeaver / DataGrip; zero loss of parent grid state; works seamlessly with keyboard shortcuts.
- **Cons**: Requires foreign key constraints to be defined in database catalog (views and unconstrained relations will not have automatic FK links).
