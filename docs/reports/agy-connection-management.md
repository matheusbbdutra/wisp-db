# Connection Management Redesign Report — Wisp

**Date:** 2026-09-14  
**Owner:** Antigravity (agy)  
**Context:** Full replacement of the raw DSN bar with saved-connection selection and a structured modal (file picker for SQLite, structured fields for Postgres).

---

## 1. Changed Files

1. **`app.go`**:
   - Added import `"github.com/wailsapp/wails/v2/pkg/runtime"`.
   - Added a new binding exposed to the frontend: `PickSQLiteFile() (string, error)`, which triggers the native OS file dialog (`runtime.OpenFileDialog`) with filters for `*.db;*.sqlite;*.sqlite3`.
2. **`frontend/wailsjs/go/main/App.d.ts` and `frontend/wailsjs/go/main/App.js`**:
   - Added the type signature and JS binding for `PickSQLiteFile()`.
3. **`frontend/src/components/ConnectionModal.tsx`** *(new)*:
   - Structured connection modal with "New Connection" and "Saved Connections (N)" tabs.
   - SQLite support with a button that triggers the native file picker via `PickSQLiteFile()`.
   - PostgreSQL support with structured fields (Host, Port, Database, User, Password, SSL Mode).
   - Safe sanitization and escaping of user and password via `encodeURIComponent` to prevent DSN breakage from special characters (`@`, `:`, `/`).
   - "Save" and "Save & Connect" actions, plus deletion of saved connections with `DeleteSavedConnection`.
4. **`frontend/src/components/ConnectionBar.tsx`**:
   - Raw DSN bar fully removed from the topbar.
   - Replaced with:
     - Saved-connection selector dropdown (`ListSavedConnections`).
     - "Connect" / "Disconnect" button based on the selected connection (`ConnectSaved`).
     - "Manage Connections" button to open the modal.
     - Active-connection indicator tag (driver + name).
     - Session status badge.
5. **`frontend/src/App.tsx`**:
   - Cleaned up loose local DSN/driver state in `App.tsx` (now centralized in the safe saved-connections flow).
   - Removed redundant DSN handlers.
6. **`frontend/src/App.css`**:
   - Added classes and themes for the structured modal, dark backdrop, tabs, form fields, driver selection pills, file picker button, and the connection list in the manager.

---

## 2. UX Decisions

- **Removal of raw-text DSN from the main bar:** The root cause of the previous problems (losing the DSN when switching drivers and silently creating an empty database in SQLite) was eliminated at the source. The DSN is now always generated transparently and in structured form.
- **SQLite with Native File Picker:** Instead of typing a path or risking typos in filesystem paths, the user clicks "Browse file..." and selects the `.db` directly in the native OS dialog (GTK on Linux/WebKit, Cocoa on macOS, Win32 on Windows).
- **Structured Postgres with Mandatory Escaping:** Dedicated host, port, database, user, and password fields, applying `encodeURIComponent` to sensitive credentials before building `postgres://...`, protecting against special characters such as `@` or `:`.
- **Clean and Productive Topbar:** The top bar now takes up only a single clean row with the existing-connections select, connect/disconnect button, modal shortcut, and session status.

---

## 3. Validation of the 3 Mandatory Steps

### Step 1: Go Validation (`go build`, `go vet`, `gofmt`)
```bash
cd /home/matheusdutra/Projects/wisp && go build ./... && go vet ./... && gofmt -l -w .
```
- **Result:** Exit code 0. No errors or warnings.

### Step 2: Frontend Type Check (`npx tsc --noEmit`)
```bash
cd frontend && npx tsc --noEmit
```
- **Result:** Exit code 0. Zero TypeScript errors.

### Step 3: Wails Build (`wails build -tags webkit2_41`)
```bash
wails build -tags webkit2_41
```
- **Output:**
```text
Wails CLI v2.16.0
# Building target: linux/amd64
  • Generating bindings: Done.
  • Installing frontend dependencies: Done.
  • Compiling frontend: Done.
  • Compiling application: Done.
  • Packaging application: Done.
Built '/home/matheusdutra/Projects/wisp/build/bin/wisp' in 9.185s.
```
- **Result:** Exit code 0. Binary built successfully.

---

## 4. Limitations and Out of Scope

- **Direct editing of an existing connection:** Users can create new saved connections and delete existing ones; in-place editing of an existing connection's parameters was not requested and may be added later if needed.
- **Connection testing (Ping/Test Connection):** Users can save and connect directly in one click ("Save & Connect"). A standalone "Test Connection" button without saving is left for future work.
