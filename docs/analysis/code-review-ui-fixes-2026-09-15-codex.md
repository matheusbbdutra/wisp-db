# UI Review Fixes — 2026-09-15

The five fixes were applied, with no new dependencies and no commit. `STATE.md`, `.env`, and memory MCP were not changed/consulted (STATE was only read). The untracked `receipts/` and `review-receipts/` directories, present at the start, were preserved.

## Diff Summary by File

| Fix | File / start line | Change |
| --- | --- | --- |
| 1 — applied | `frontend/src/lib/valueFormat.ts:35` (+31/-28) | Escaping of text and attributes, including whitespace characters that need numeric references to survive XML normalization. Preserves CDATA and comments, including comments outside the root element. Leaves keep text untrimmed and CDATA without internal reindentation. Mixed content, preserved xml:space, declarations/processing instructions, and DTD return the original. |
| 2 — applied | `internal/db/sqlite.go:420` (+21/-2) | Guards actions by FK id, appends ON DELETE/UPDATE clauses other than NO ACTION, omits a missing referenced list, and applies quoteIdent to tables/columns. Synthetic Name, RefSchema, and column metadata stay the same. |
| 2 — verification | `internal/db/sqlite_test.go:170` (+31) | Regression test with a temporary real SQLite database: explicit and implicit composite FKs, spaces/quotes in identifiers, CASCADE, SET NULL, RESTRICT, and absence of the default clauses. Reuses the existing helper; it is the direct way to prove the reconstruction against the real driver. |
| 3 — applied | `frontend/src/components/Sidebar.tsx:40`, `:88`, `:204` (+14/-3) | Visual error state with the existing class and alert role; captures failures per schema individually and continues the loop. Restart and cleanup clear loading; canceled responses update neither results nor errors. |
| 4 — applied | `frontend/src/components/ResultGrid.tsx:1`, `:217` (+15/-1) | Saves the previous mapping and compares the selected cell's original row against the new mapping. useLayoutEffect clears a shifted or out-of-bounds selection before paint, preserving the selection when the original index stays the same. |
| 5 — applied | `testdata/postgres-seed.sql:6` (+4/-4) | Removes the recommendation to reapply via psql and the idempotency promise. Documents recreation with docker compose down -v followed by up -d, including a warning that test data/volumes are removed. No Docker command was run. |

## Causes and Scenario Checks

- **Sidebar:** the canceled finally did not clear loading and there was no catch in the loop. Now clearing the search during a pending call runs cleanup and restart with loading=false; rejecting one schema logs a message and lets the next one be searched. Checked by reading the flow, without interactive WebView execution. This does not implement a timeout for a backend call that never resolves, nor does it change manual refresh/expansion.
- **SQLite:** onDelete/onUpdate were dropped and identifiers/lists were concatenated without quoting. The real test passed all three cases and guards against recurrence.
- **Grid:** reset depended only on the filter text. Manual check of the algorithm: before `[0, 1]`, visual selection 0 => original 0; after editing the first row out of the filter, `[1]`, visual 0 => original 1; the difference clears the selection. A new render with no selected cell returns without updating state, avoiding loops. Appends that preserve the selected index do not clear the selection. Limitation: it compares original indexes, not PKs; full result replacement/reordering at the same index and selections without current.cell get no identity tracking in this fix.
- **XML:** DOMParser decodes entities; reassembly without escaping produced invalid XML and textContent erased the text/CDATA/comment distinction. The serializer now handles those nodes separately. XML with mixed content returns the original in full; in formatted elements, the example `<r a="&quot;">A &amp; B &lt; C</r>` keeps the required escapes. Checked by reading and compiling, without running the formatter in a real DOM. Structural formatting keeps normalizing whitespace between elements when there is no mixed-content/xml:space signal; it does not promise universal textual identity.
- **Fixture:** CREATE IF NOT EXISTS does not migrate schema and SERIAL allows new rows on reapply. The docs now require a recreated database.

## Checks Performed

| Command | Result |
| --- | --- |
| `GOCACHE=/tmp/wisp-go-build go build ./...` | Passed, code 0, no diagnostics. |
| `GOCACHE=/tmp/wisp-go-build go vet ./...` | Passed, code 0, no diagnostics; repeated after adding the test. |
| `cd frontend && npx tsc --noEmit` | Passed, code 0, no diagnostics. |
| `cd frontend && npm run build` | Passed, code 0. Vite emitted PURE-annotation warnings on the Glide dependency and a chunk-over-500 kB warning; so it was not a warning-free run. Nothing was silenced and no out-of-scope dependencies were changed. |
| `GOCACHE=/tmp/wisp-go-build go test ./internal/db -run TestSQLiteForeignKeyDefinitions -count=1` | Passed: `ok wisp/internal/db 0.004s`. |
| `git diff --check` | Passed. |

The first attempt at `go build ./... && go vet ./...` failed before compiling because the default cache at `/home/matheusdutra/.cache/go-build` is read-only in the sandbox. The fix was pointing GOCACHE at `/tmp`, with no permission escalation. Lesson: in this environment, use a Go cache in a writable area. There was no code failure in that attempt.

All requested fixes were implemented. Visual validation in the WebView and running the formatter in a real DOM remain undone; the four mandatory commands completed successfully, with the frontend warnings disclosed above. Constraints kept: minimal change, no new library, no STATE.md edits, no .env access, no memory MCP, and no commit.
