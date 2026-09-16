# UI Visual Redesign Report — Wisp

**Date:** 2026-09-14  
**Scope:** Full visual redesign of the frontend interface (React/Monaco Editor), keeping Go bindings, internal logic, and architecture untouched.

---

## 1. List of Changed Files

- `frontend/src/style.css`: Base app reset and styling, removal of template-inherited centering, integration with system variables and custom scrollbars.
- `frontend/src/App.css`: Complete design system in pure CSS with color variables, elevations, styled buttons, inputs, status badges, saved-connection chips, sidebar hierarchy, editor toolbar, and grid table.
- `frontend/src/App.tsx`: Semantic update of the editor toolbar (Run button with Play icon and `<kbd>Ctrl+Enter</kbd>` badge, Cancel button with Stop icon) and strict preservation of all states and handlers.
- `frontend/src/components/ConnectionBar.tsx`: Organization into two clean rows (active connection and saved favorites), dedicated classes for mono-styled DSN input, pulsing/colored status badges, and connection chips with dialect tags.
- `frontend/src/components/Sidebar.tsx`: Clear visual hierarchy with inline SVG icons for schemas (database) and tables (grid), subtly animated expansion arrows, illustrated empty state, and a compact refresh button.
- `frontend/src/components/SqlEditor.tsx`: Monaco Editor visual options tuned to the new palette (modern mono font-family, 13px font-size, vertical padding, removal of unneeded rulers and thin scrollbars).
- `frontend/src/components/ResultGrid.tsx`: Professional IDE/DB-tool look with sticky header, row numbers (#) in a fixed left column, subtle zebra striping, visual highlight for `NULL` values, row/column count toolbar, and explanatory empty state.

---

## 2. Design Decisions

### Color Palette (Professional Dark Theme)
Inspired by modern desktop tools (VS Code, TablePlus, DataGrip):
- **Window / Base Background:** `#121214` (deep dark zinc)
- **Top Bar & Toolbars:** `#18181b` / `#1a1a1e`
- **Navigation Sidebar:** `#141416` with borders in `#242428` / `#2d2d32`
- **Monaco Editor:** `#1e1e1e` (fully integrated default `vs-dark` theme)
- **Results Grid:** `#131315` with header in `#1f1f23` and hover highlight `rgba(59, 130, 246, 0.09)`
- **Accents and States:**
  - Run / Success button: Emerald green (`#059669` / `#047857`)
  - Connection / Primary: Professional blue (`#2563eb` / `#1d4ed8`)
  - Alerts / Error / Cancel: Red (`#dc2626` / `#ef4444`)
  - `NULL` indicator: Subtle amber (`#d97706` with italic)

### Typography
- **General UI:** `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`
- **Code, DSN, SQL, and Data Cells:** `ui-monospace, "Cascadia Code", "Fira Code", "JetBrains Mono", Menlo, Consolas, monospace` with `tabular-nums` support for flawless numeric alignment.

### 100% Offline Compliance (Zero CDN)
- All icons were implemented as **inline SVG**, with no added external packages, no network requests, and no CDN font dependencies.
- The local isolation required by the Wisp architecture was strictly maintained.

---

## 3. Type Check and Build Verification

Running the mandatory commands:

```bash
cd frontend && npx tsc --noEmit && npm run build
```

### Output:
```text
vite v7.0.0 building for production...
transforming...
✓ 1563 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                                  0.45 kB │ gzip:     0.29 kB
dist/assets/codicon-Brq4_Ui5.ttf               140.96 kB
dist/assets/editor.worker-DIDyqMcf.js          272.76 kB
dist/assets/json.worker-D71nRnS-.js            404.05 kB
dist/assets/html.worker-GHzVgjxi.js            714.10 kB
dist/assets/css.worker-DrPvyF-b.js           1,051.35 kB
dist/assets/ts.worker-_me3HhwX.js            7,031.80 kB
dist/assets/index-1zq8466J.css                 172.41 kB │ gzip:    27.20 kB
...
dist/assets/index-C-IHNGN1.js                4,156.35 kB │ gzip: 1,087.94 kB
✓ built in 18.57s
```

- `npx tsc --noEmit`: exit code 0 (zero type errors).
- `npm run build`: exit code 0 (production build completed successfully).

---

## 4. Limitations and Out of Scope

- **Grid Virtualization (Glide Data Grid):** Not added at this time; the grid remains a plain HTML table with immediate rendering, sticky header, and optimized scroll, per the Phase 1 roadmap decision.
- **Manual Panel Resizing (Split panes / Resizers):** The current proportions (fixed 250px sidebar, 220px editor, grid taking the remaining flex space) respond to window resizing but have no drag bars between panels yet.
- **Backend logic and bindings:** Kept 100% intact as requested.
