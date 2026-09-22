# ADR 0014 — Sequential Multi-Statement Script Execution

**Status:** Accepted  
**Date:** 2026-09-22  

## Context

In `v0.1.0-beta.13`, Wisp implemented strict statement isolation in `frontend/src/lib/sqlStatements.ts` (`splitStatements` and `resolveStatementAtOffset`) to prevent PostgreSQL syntax errors (`ERROR: syntax error at or near "SELECT" (SQLSTATE 42601)`) caused by sending multiple statements to drivers in extended query mode.

While single-statement execution under the cursor (`Ctrl+Enter`) works reliably, developers frequently need to run entire multi-statement scripts (e.g. migration files, DDL definitions, or reporting batches containing multiple `CREATE`, `INSERT`, `UPDATE`, and `SELECT` queries) in one unified action ("Run All" / "Execute Script", equivalent to DBeaver `Alt+X`).

## Decision

1. **Leverage the Statement Scanner Pipeline**:
   - Reuse `splitStatements(queryText)` from `frontend/src/lib/sqlStatements.ts` to tokenize and segment the editor buffer into clean, isolated statement ranges, correctly handling comments (`--`, `/* ... */`), single-quoted strings (`'...'`), and blank lines.
2. **Sequential Batch Execution**:
   - Introduce a dedicated "Run Script" action (`Alt+X`) in `ConsoleToolbar.tsx` and `ConsoleRunBar.tsx`.
   - Statements are dispatched sequentially through the tab's dedicated `*sql.Conn` session.
   - For DQL queries (`SELECT`), create corresponding result tabs or sequentially updated result sets.
   - For DDL/DML statements (`INSERT`, `UPDATE`, `CREATE`), accumulate execution duration and affected row counts.
3. **Failure Handling**:
   - By default, stop execution immediately on the first statement that returns an error, highlighting the exact failed statement range in Monaco Editor and reporting the failure without executing subsequent statements.
4. **Cancellation**:
   - Triggering "Cancel" during script execution aborts the active statement on the database server and halts the remaining sequence.

## Consequences

- **Pros**: Full support for running large migration and setup scripts; preserves the single-statement driver invariant under the hood; provides clear visual feedback of execution progress.
- **Cons**: Scripts with many large SELECT queries will generate multiple result tabs.
