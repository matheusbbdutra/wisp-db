# ADR 0021 — Modular Backend Architecture & TabsContext

**Status:** Accepted  
**Date:** 2026-09-22  

## Context

As Wisp evolved from a prototype to a full desktop client, two architectural bottlenecks emerged:
1. **Backend (`app.go`)**: The single file `app.go` has grown to over 940 lines. It acts as a monolithic "God Object" hosting lifecycle methods, connection management, SQL execution, streaming cursors, schema introspection, batch operations, script persistence, update checks, and error logging.
2. **Frontend (`App.tsx`)**: Tab management (`tabs`, `activeId`), tab creation, closing, and callback orchestration (`onOpenTable`, `onOpenSchema`, `onOpenRoutine`, `onConnectedChange`) are managed at the root component and passed down through 2-3 levels of props, violating separation of concerns and making tab additions error-prone.

## Decision

Refactor the Go backend into domain-focused files within `package main` and introduce a lightweight `TabsContext` in the React frontend.

### 1. Backend Decomposition (`package main`)

Split `app.go` into cohesive files sharing the existing `App` struct receiver:

- **`app.go`**: Core struct `App`, lifecycle (`NewApp`, `startup`, `shutdown`, `beforeClose`, `ConfirmQuit`).
- **`app_connection.go`**: Connection lifecycle (`Connect`, `Disconnect`, `SaveConnection`, `ListSavedConnections`, `ConnectSaved`, `TestConnection`, `DeleteSavedConnection`, `GetConnectionForEdit`, `PickSQLiteFile`).
- **`app_query.go`**: Query execution and streaming (`RunQuery`, `FetchRows`, `CancelQuery`, `ExecuteBatch`, `UpdateCell`, `InsertRow`, `DeleteRow`).
- **`app_schema.go`**: Schema introspection and metadata (`ListSchemas`, `ListTables`, `ListSchemaObjects`, `IntrospectTable`, `IntrospectSchemaTables`, `RefreshSchema`, `GetCachedCatalog`, `WarmupCatalog`, `GetTableDDL`, `ListTriggers`, `ListFunctions`, `ListIndexes`, `ListForeignKeys`, `ListIncomingForeignKeys`).
- **`app_scripts.go`**: Scripts and history persistence (`GetQueryHistory`, `SaveScript`, `ListScripts`, `UpdateScript`, `DeleteScript`).
- **`app_updater.go`**: Update checks and version info (`CheckForUpdate`, `OpenReleaseURL`, `GetAppVersion`).
- **`app_export.go`**: File export operations (introduced in ADR 0016).

*Note*: Because all files remain in `package main` on receiver `(a *App)`, all Wails binding signatures and method names remain 100% identical. Zero breaking changes for the IPC contract or frontend generated code.

### 2. Frontend Tabs Context (`frontend/src/context/TabsContext.tsx`)

Extract tab state and operations into a React Context:

```typescript
export interface TabsContextValue {
    tabs: TabState[];
    activeId: string;
    setActiveId: (id: string) => void;
    addConsoleTab: () => void;
    openTableTab: (connectionId: string, schema: string, table: string, initialFilter?: { column: string; value: any }) => void;
    openSchemaTab: (connectionId: string, schema: string) => void;
    openRoutineTab: (kind: 'trigger' | 'function', name: string, definition: string) => void;
    closeTab: (tabId: string) => Promise<void>;
    updateTabConnected: (tabId: string, connected: boolean) => void;
    registerConsoleRef: (tabId: string, handle: ConsoleTabHandle | null) => void;
}
```

- Wrap the app in `<TabsProvider>` in `main.tsx` or `App.tsx`.
- Child components (`Sidebar`, `ConsoleTab`, `TableTab`, `SchemaTab`) consume tab actions directly via `useTabs()` instead of relying on callback props threaded from `App.tsx`.

## Consequences

- **Pros**:
  - Eliminates the monolithic `app.go` file; each file is focused (< 250 lines), readable, and easier to maintain.
  - Zero IPC contract breakage (Go struct receiver methods remain unchanged).
  - Eliminates prop drilling across the frontend tab hierarchy.
- **Cons**:
  - Minor initial file movement in backend and context wrapping in frontend.

## Acceptance Criteria

1. Backend builds cleanly (`go build ./...`) and passes all existing unit and integration tests (`go test ./...`).
2. Wails binding generation (`wails generate module`) yields identical signatures in `frontend/wailsjs/`.
3. Tab navigation (opening tables, schemas, routines, closing tabs with dirty SQL confirmation) functions identically without regression.
