# ADR 0017 — Object Tree Context Menu & SQL Generator in Sidebar

**Status:** Accepted  
**Date:** 2026-09-22  

## Context

In `frontend/src/components/Sidebar.tsx`, clicking on an item either triggers `onSelectTable` (which replaces the editor text with `SELECT * FROM table LIMIT 50;`) or opens `TableTab` (via Ctrl+click or clicking the `↗` button).
However, right-clicking on schemas, tables, and views currently does nothing.
Standard SQL desktop tools (DBeaver, TablePlus, DataGrip) provide a rich context menu on the schema tree for:
1. Copying identifiers (simple name, schema-qualified name, DDL).
2. Generating boilerplate SQL statements (`SELECT`, `INSERT`, `UPDATE`, `DELETE`).
3. Administrative operations (Drop table, Truncate table) with safe confirmations.
4. Refreshing an individual schema's metadata.

## Decision

Implement a dedicated context menu (`SidebarContextMenu.tsx`) and an SQL generation utility (`lib/sqlGenerator.ts`).

### 1. Context Menu Component (`frontend/src/components/SidebarContextMenu.tsx`)

Render a floating context menu on `contextmenu` event in `Sidebar.tsx`:

- **Target Types**:
  - `schema`: Context menu for schema nodes.
  - `table`: Context menu for table nodes.
  - `view`: Context menu for view nodes.

- **Menu Structure**:
  - **For Tables**:
    - 📋 **Copiar**:
      - "Copiar nome" (`table`)
      - "Copiar nome qualificado" (`schema.table`)
    - 📝 **Gerar SQL**:
      - `SELECT * FROM ... LIMIT 50`
      - `INSERT INTO ... (col1, col2) VALUES (...)` (pre-filled with column names from catalog)
      - `UPDATE ... SET col1 = ... WHERE pk = ...`
      - `DELETE FROM ... WHERE pk = ...`
      - `CREATE TABLE DDL` (calls backend `GetTableDDL`)
    - ↗️ **Abrir tabela** (equivalent to clicking `↗`)
    - ⚡ **Ações perigosas** (separated with divider):
      - 🧹 "Truncar tabela..." (modal confirmation required)
      - 🗑️ "Excluir tabela..." (modal requiring user to type table name to confirm)
  - **For Views**:
    - "Copiar nome", "Copiar nome qualificado", "Gerar SELECT", "Ver definição DDL", "Excluir view...".
  - **For Schemas**:
    - "Copiar nome do schema"
    - "Atualizar metadados deste schema" (targeted refresh)
    - "Nova tabela..." (opens console with boilerplate `CREATE TABLE schema.new_table (...)`)

### 2. SQL Generator Utility (`frontend/src/lib/sqlGenerator.ts`)

Create helpers that format statements with proper dialect quoting (see ADR 0019):
```typescript
export function generateSelect(schema: string, table: string, dialect: string): string;
export function generateInsert(schema: string, table: string, columns: db.Column[], dialect: string): string;
export function generateUpdate(schema: string, table: string, columns: db.Column[], dialect: string): string;
export function generateDelete(schema: string, table: string, pkColumns: string[], dialect: string): string;
```

When generating an `INSERT`, non-generated columns are included in the column list.
When generating `UPDATE` and `DELETE`, PK columns are identified from the catalog; if no PK exists, a comment `-- WARNING: No primary key detected` is appended.

### 3. Action Destination

Clicking a "Gerar SQL" action:
- If a console tab is open: Appends the generated SQL into the Monaco Editor at the cursor position (or in a new blank console tab if desired).
- Automatically focuses the editor.

## Consequences

- **Pros**:
  - Accelerates query writing by eliminating manual typing of column lists and schema prefixes.
  - Gives users instant access to DDL and table management operations.
- **Cons**:
  - Dangerous actions (Drop/Truncate) require strict modal validation to prevent accidental data loss.

## Acceptance Criteria

1. Right-clicking any table or view in the sidebar displays the context menu at the cursor coordinates.
2. Clicking "Gerar INSERT" generates an INSERT statement containing the actual columns of the table.
3. Clicking "Excluir tabela" prompts a modal requiring the user to type the exact table name before issuing `DROP TABLE`.
4. Escape or clicking outside closes the menu immediately.
