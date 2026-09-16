# Fix Review of the UI Changes — 2026-09-15

## Scope and Validation

Review of the working tree, including drivers, Go/Wails bindings, tabApi, grid, value panel, Sidebar, metadata tabs, CSS, and fixture. The docked-panel and collapsible-Sidebar decisions were preserved. No code was changed; this report is the only file created in this round. STATE.md was not edited, .env was not consulted, and memory MCP was not used.

Validation performed: `frontend/node_modules/.bin/tsc --noEmit`, run from `frontend`, passed. The analysis below is static, with call tracing and reading of the installed pgx ByteaCodec; no unit tests were created or run, and no database queries or browser/Wails tests were executed. The scenarios are proposed reproductions derived from the code, not reports of runs in the UI. I found no critical issue; there are medium data-fidelity and behavior issues and low state/fixture issues.

## Findings

### 1. Medium — binary bytes lose information in transit

**Source:** `internal/db/driver.go:19`, `internal/db/postgres.go:71`, `internal/db/postgres.go:117`, `internal/db/sqlite.go:509`.

**Scenario:** result of `SELECT decode('ff0080', 'hex') AS bin` in PostgreSQL, or the equivalent BLOB in SQLite → `normalizeCellValue` converts the bytes to a string → JSON serialization of a string with invalid UTF-8 replaces invalid bytes with U+FFFD. The bridge keeps carrying valid JSON, but the original content is lost; copy/export can no longer recover the bytes. The installed pgx `ByteaCodec.DecodeValue` genuinely returns `[]byte`, so this is not a merely theoretical risk. The streaming path applies the normalization too.

**Suggestion:** distinguish textual from binary values via driver metadata and keep a reversible representation for bytea/BLOB (identifiable hex/base64). Documenting it as a generic conversion is not enough: the current comment does not make this loss explicit. Checking only UTF-8 also does not tell valid-UTF-8 binary apart from text.

### 2. Medium — the XML formatter produces invalid or altered content

**Source:** `frontend/src/lib/valueFormat.ts:45`, `frontend/src/lib/valueFormat.ts:55`, `frontend/src/lib/valueFormat.ts:63`, `frontend/src/components/CellValueViewer.tsx:31`.

**Scenario:** `<r a="&quot;">A &amp; B &lt; C</r>` → DOMParser decodes entities → the serializer concatenates attribute/text without escaping, producing literal quotes, `&`, and `<` in invalid positions. The Copy button copies that altered version. Additionally, `<r><![CDATA[a<b]]><x/></r>` loses the CDATA section because, when there is an element child, the walk drops non-TEXT/ELEMENT nodes; mixed text has its whitespace altered by trim/indentation. Comments and processing instructions are also dropped.

**Suggestion:** preserve escaping and node types with XMLSerializer and do not reindent mixed content or content with significant whitespace; keep the original when fidelity cannot be guaranteed. React renders the result as text, so this finding is not an XSS claim.

### 3. Medium — right-panel drag uses an inverted sign

**Source:** `frontend/src/components/ResultGrid.tsx:156`, `frontend/src/components/CellValueViewer.tsx:38`, `frontend/src/lib/useDragResize.ts:35`.

**Scenario:** right-side panel 320 wide; dragging its left edge 40 px to the left should grow the width to 360. The hook adds the horizontal offset and yields 280: the edge moves opposite to the cursor. The existing hook is right for the left Sidebar, but this new use has the inverse orientation.

**Suggestion:** allow a negative delta direction in this hook call, preserving the direction of existing consumers.

### 4. Medium — SQLite UNIQUE indexes show as "no"

**Source:** `internal/db/sqlite.go:330`, `internal/db/sqlite.go:360`, `frontend/src/components/TableTab.tsx:350`.

**Scenario:** table with an explicit `CREATE UNIQUE INDEX` → indexInfo always returns false → the "Unique" column shows "no". The comment acknowledges the gap, but the UI communicates a false answer, not missing information. The DDL in the tooltip does not fix that contradiction.

**Suggestion:** fetch the flag via PRAGMA index_list and join it by name, preferably one query per table.

### 5. Medium — reconstructed SQLite FK definition drops semantics

**Source:** `internal/db/sqlite.go:379`, `internal/db/sqlite.go:403`, `frontend/src/components/TableTab.tsx:369`.

**Scenario:** FK with ON DELETE CASCADE/ON UPDATE CASCADE → the actions are read but dropped from Definition. With `REFERENCES parent` and no explicit column list, RefColumns stays empty and the definition becomes `REFERENCES parent ()`, which is not a valid equivalent declaration. Identifiers containing spaces or quotes are also concatenated without quoting.

**Suggestion:** preserve actions, apply quoteIdent to identifiers, and handle the implicit-PK reference without emitting empty parentheses. Label the definition as reconstructed, since the ForeignKey contract in driver.go promises complete/verbatim DDL, which this path does not deliver.

### 6. Low — canceling the search can leave "searching…" forever

**Source:** `frontend/src/components/Sidebar.tsx:88`, `frontend/src/components/Sidebar.tsx:97`, `frontend/src/components/Sidebar.tsx:106`, `frontend/src/components/Sidebar.tsx:109`.

**Scenario:** after the debounce, ListTables is in flight and searchLoading=true; the user clears the field → cleanup marks cancelled → the new effect returns immediately and the old finally never clears the indicator. The UI stays on "searching…" with no active search. The same state can survive disconnect/reconnect without unmounting the component.

**Suggestion:** explicitly end the loading state when invalidating the search and on the no-text/no-pending-schemas paths, tying updates to the current generation.

### 7. Medium — a ListTables error silently aborts the global search

**Source:** `frontend/src/components/Sidebar.tsx:96`, `frontend/src/components/Sidebar.tsx:101`, `frontend/src/components/Sidebar.tsx:105`.

**Scenario:** ListTables rejects during the sequential search → the setTimeout async rejects without catch, the remaining schemas are never loaded, and there is no error message. The finally clears the indicator, leaving incomplete results that look like a finished search. Rejecting the call does not block the queue; the defect is error handling and feedback.

**Suggestion:** catch the rejection, distinguish a canceled search from a live failure, and offer an explicit error/retry. Define whether a schema failure aborts the whole search or allows continuing.

### 8. Low — a stale selection is used while the filter changes; editing can make the swap persistent

**Source:** `frontend/src/components/ResultGrid.tsx:185`, `frontend/src/components/ResultGrid.tsx:210`, `frontend/src/components/ResultGrid.tsx:220`.

**Transient scenario:** rows A/B, visual selection 0 on A with panel open; typing a filter that keeps only B → filteredIndices already points at B while gridSelection still holds 0 → valuePanelCell computes B before the effect clears the selection. The bounds guard prevents a crash when the position no longer exists. There is a render inconsistency provable from the flow; whether an intermediate frame is visible in the WebView was not verified.

**Persistent scenario:** filter "active", two matching rows, first one selected; editing the first so it no longer matches → rows changes, filteredIndices drops the first, but filterText does not change and the effect does not run. Visual selection 0 now means the second row; the panel and subsequent selection-based operations use that row with no explicit selection. The already-started UPDATE keeps the correct original index: I found no target swap in that UPDATE.

**Suggestion:** clear the selection in the same filter update and invalidate/remap the selection when visible-row identity changes; do not clear indiscriminately on every pagination append.

### 9. Low — the fixture instruction does not work over the previous seed

**Source:** `testdata/postgres-seed.sql:6`, `testdata/postgres-seed.sql:19`, `testdata/postgres-seed.sql:28`, `testdata/postgres-seed.sql:56`.

**Scenario:** following the instruction to reapply the file in a container initialized by the previous version → CREATE TABLE IF NOT EXISTS does not add profile/updated_at/customer_id/metadata_xml → INSERTs and other statements depending on those columns fail. Even on a fresh database, reapplying adds new invoice_lines: their SERIAL generates new keys, so ON CONFLICT DO NOTHING does not make that section idempotent.

**Suggestion:** document that a fresh test database is required, or provide an explicit fixture upgrade; if idempotency is promised, use stable identifiers on the lines without a natural key too. No seed application was run in this review.

## Explicit Verification of the Six Requested Points

1. **Visual ↔ original translation: verified, no issue on the access paths examined with stable mapping.** getCellContent (299), handleCellClicked (363), and handleCellContextMenu (445) translate once. rowHasPkValues/isCellEditable receive the original index; directEdit/pendingEdit store the original index, including preview, PK, and onCellSaved. markedRowsMatrix (459) caps at rowCount and translates; rangeMatrix (477) translates rows and caps columns. selectionTarget (492) compares selection in visual space and accesses matrices in original space. handleCopyCell (543), handleCopyRow (547), and targetMatrix (583) receive menu.row already translated. "View value…" (689) uses menu.displayRow for selection; valuePanelCell translates on read. getBounds correctly receives the visual index. No column reordering is enabled that would need extra translation. Temporal invalidation is finding 8, not a missing translation.
2. **valuePanelCell: there is the inconsistency window described in finding 8.** useEffect does not prevent computing with the previous selection on the first render with the new filter; the row/column guards prevent fatal indexing.
3. **normalizeCellValue: real problem, finding 1.** bytea genuinely arrives as []byte; string does not guarantee preservation of invalid bytes in JSON. The conversion benefits XML/text but is not safe for every []byte.
4. **Sidebar/debounce: verified, no issue discarding search responses after cleanup.** clearTimeout prevents a pending start; cancelled is checked before and after each await; search/schemas/connected/tabId changes invalidate the effect. There is no internal parallelism in the loop. Findings 6 and 7 stand. Limit: preexisting handleRefresh and toggleSchema lack the same stale-response protection; the guarantee holds for the new search effect, not for every Sidebar request.
5. **Collapse and queue: verified, no abandoned-promise-holding-the-queue issue.** `frontend/src/lib/tabCallQueue.ts:13` keeps the backend call independent of the React consumer and runs release in finally on resolve/reject. cancelled only breaks the loop after the await; unmounting does not cancel the withQueue execution. A backend call that never settles would keep holding the queue, but that is not caused by the collapse. The Map retains already-settled keys, a preexisting behavior distinct from deadlock.
6. **CSS/fallback: verified, no functional issue.** `frontend/src/App.css:27` defines --accent-blue as #2563eb and line 41 defines --accent-color from that valid variable. The consumer on line 946 now resolves to #2563eb instead of the #3b82f6 fallback. The tone shift is real and explicitly documented in the CSS; there is no circular reference or missing variable on that path.

## Additional Notes and Limits

- ListIndexes/ListForeignKeys bindings and models match the Go methods and go through the tabApi queue. Consumers handle null lists with `?? []`. I found no signature mismatch in the review; the type check passed.
- Documentary menu events have cleanup. The "Copied!" timeout lasts 1.5 s and is not canceled on unmount; this allows temporarily stale feedback when switching cells, but does not demonstrate a permanent leak. The resize hook only removes listeners on mouseup, a preexisting limitation; closing a tab mid-drag was not tested.
- The new panel separator only accepts the mouse (`CellValueViewer.tsx:38`), with no focus, no separator semantics, and no keyboard alternative for adjusting the width. It is a concrete accessibility limitation, already shared by the existing separators; recommendation: a focusable control with arrow-key adjustment and value announcement. No screen-reader audit was run.
- JSON formatting uses parse/stringify and may round large integers when the source value is text, e.g. `{"id":9007199254740993}`. Before guaranteeing faithful data copy through the viewer, preserve a raw copy or use a precision-safe representation; no library needs to be introduced to offer a raw copy.
- No backend execution or Wails layout validation in this round. The findings do not mean the UX decisions should be revisited. Suggested priority: XML/binary fidelity, resize direction, and metadata truthfulness; then search cancelation/errors and selection invalidation.

Rules kept to the end: review without fixes, no new unit tests, no .env/memory MCP, and no STATE.md changes. Causes and scenarios stay persisted in this report to avoid repeating already-settled hypotheses.
