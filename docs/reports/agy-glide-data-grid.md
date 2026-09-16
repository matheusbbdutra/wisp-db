# Glide Data Grid Implementation Report — Wisp

**Date:** 2026-09-14  
**Owner:** Antigravity (agy)  
**Context:** Replacement of the plain HTML results table with the virtualized Glide Data Grid (`@glideapps/glide-data-grid`), keeping the same props interface and high performance with thousands of rows.

---

## 1. Changed Files

1. **`frontend/package.json`**:
   - Added the `@glideapps/glide-data-grid` dependency and local peer dependencies (`lodash`, `marked`, `react-responsive-carousel`, `@types/lodash`).
   - 100% offline (no external requests or CDN).
2. **`frontend/.npmrc`**:
   - Created with `legacy-peer-deps=true` for compatibility between React 19 and ecosystem peer dependencies.
3. **`frontend/src/components/ResultGrid.tsx`**:
   - Replaced the HTML `<table>` rendering with the `<DataEditor>` component from `@glideapps/glide-data-grid`.
   - Kept exactly the same props interface (`columns: string[], rows: any[][]`). No changes were needed in `App.tsx`.
   - Kept the friendly Empty State when `columns.length === 0`.
   - Kept the statistics bar (`rows.length` rows × `columns.length` columns).
4. **`frontend/src/App.css`**:
   - Added the `.result-grid-canvas` class (`flex: 1; min-height: 0; min-width: 0; position: relative; width: 100%; height: 100%; overflow: hidden; background: var(--bg-grid);`) to provide the ideal dimensions and bounding box for the Glide Data Grid canvas.

---

## 2. Implementation Decisions

### Dark Theme Mapping
The custom theme (`darkTheme: Partial<Theme>`) was mapped directly from the CSS custom properties in `App.css`:
- `bgCell`: `#131315` (data cell background)
- `bgCellMedium`: `#18181c`
- `bgHeader`: `#1f1f23` (column header)
- `bgHeaderHasFocus`: `#27272a`
- `bgHeaderHovered`: `#2a2a30`
- `borderColor`: `#242428` (subtle grid lines)
- `horizontalBorderColor`: `#1a1a1e`
- `headerBottomBorderColor`: `#3f3f46`
- `textDark`: `#f4f4f5` (primary text color)
- `textHeader`: `#a1a1aa` (column titles)
- `accentColor`: `#2563eb` and `accentLight`: `rgba(37, 99, 235, 0.2)` (focus and selections)
- `fontFamily` & `baseFontStyle`: `ui-monospace, "Cascadia Code", "Fira Code", monospace` at `12px`

### Visual Treatment of `NULL` Values
In the `getCellContent` callback:
When a cell holds `val === null` or `val === undefined`:
- Returns a cell with `data: 'NULL'`, `displayData: 'NULL'`
- Applies a `themeOverride`:
  - `textDark: '#d97706'` (amber tone matching `--accent-amber`)
  - `baseFontStyle: 'italic 12px ui-monospace, monospace'`
This way, `NULL` values are highlighted visually right on the canvas, matching the original design intent.

### Fixed Index Column
Used Glide Data Grid's native support via the prop:
`rowMarkers="number"`
This creates the fixed index column on the left numbered from 1 (1, 2, 3...), with no need to create synthetic columns in the data matrix.

### Resizable Columns
Implemented local state `columnWidths: Record<string, number>` and an `onColumnResize` callback:
- When a column is resized, the new width is saved to local state.
- Initial width is computed dynamically from the column name length (minimum 120px, maximum 320px).

---

## 3. Bundle Size Impact

Per the project's critical rule against bloated bundles (`monaco-editor-exports-map-vite` memory), we measured the production assets in `dist/assets`:

### Before installing Glide Data Grid:
- `editor.worker-...js`: 267 kB
- `index-...css`: 92 kB
- `index-...js`: 2.8 MB
- **Total:** ~3.16 MB

### After installing Glide Data Grid:
- `editor.worker-DIDyqMcf.js`: 272.76 kB
- `index-C-ColBSv.css`: 106.55 kB
- `data-grid-overlay-editor-CPXHxapU.js`: 3.56 kB
- `number-overlay-editor-DetCm0Sz.js`: 16.23 kB
- `index-CjmyfphP.js`: 3,214.61 kB (3.21 MB)
- **Total:** ~3.61 MB

**Total increase:** ~450 kB (well within the expected limit of <1MB, without pulling unnecessary chunks).

---

## 4. Validation of the 3 Mandatory Steps

### Step 1: TypeScript Type Check
```bash
cd /home/matheusdutra/Projects/wisp/frontend && npx tsc --noEmit
```
- **Result:** Exit code 0. Zero compile/type errors.

### Step 2: Frontend Build (Vite)
```bash
npm run build
```
- **Result:** Exit code 0. Build completed in 5.87s.

### Step 3: Wails Build
```bash
cd /home/matheusdutra/Projects/wisp && wails build -tags webkit2_41
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
Built '/home/matheusdutra/Projects/wisp/build/bin/wisp' in 10.775s.
```
- **Result:** Exit code 0. Native executable built successfully.

---

## 5. Limitations and Next Steps

- **Inline Cell Editing in the Grid:** The grid currently works as a high-performance results viewer (`read-only`). Inline editing with catalog-based PK verification (ADR 0004) can be wired via `onCellEdited` once that feature is started.
- **Custom Cell Types (JSON viewer / Arrays):** Complex values are currently serialized to a readable string (`JSON.stringify`).
