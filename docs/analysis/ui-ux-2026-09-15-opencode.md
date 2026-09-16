# UX/UI Analysis — Value Viewer, Collapsible Sidebar, and General Polish (OpenCode, 2026-09-15)

> ANALYSIS/PROPOSAL task — no code was changed. Independent proposal
> (run in parallel with Antigravity and Cursor; didn't read the other analyses
> before writing this one). Stated limitation: code-reading-only analysis
> (`CellValueViewer.tsx`, `ResultGrid.tsx`, `Sidebar.tsx`, `ConsoleTab.tsx`,
> `TableTab.tsx`, `App.tsx`, `App.css`, `useDragResize.ts`, `valueFormat.ts`);
> didn't run `wails dev` for visual testing.

## Executive Summary

- **Point 1 — Value viewer becomes a panel docked to the RIGHT of the grid** (DBeaver pattern):
  state lives inside `ResultGrid` (works the same in Console and TableTab with
  no prop drilling), follows the active selection on its own, resizable with the
  existing `useDragResize`, preserves format/wrap/copy. Keeps the
  "View value…" context-menu item as a shortcut that opens the panel. Priority
  HIGH, effort MEDIUM.
- **Point 2 — Sidebar collapses to HIDDEN (not icon-only)**, with a chevron
  button on the edge + a thin strip/tab to reopen; preference in `localStorage`
  (`wisp:sidebarCollapsed`); state lives in `ConsoleTab` (the only real
  Sidebar consumer — verified by grep). Priority HIGH, effort LOW.
- **Point 3 — General polish**: the #1 structural problem is **hardcoded
  colors/values outside the `:root` vars** (`#1e1e22`, `#93c5fd`, `#2563eb`
  straight in CSS and TSX) + **two referenced-but-never-defined vars**
  (`--font-mono`, `--accent-color`). Fix that first (low effort, high
  value) before any other polish. Full prioritized list below.
- **What NOT to do**: no new UI framework, no new resize mechanism, no new
  global state — everything fits the existing patterns
  (pure CSS + `useDragResize` + `localStorage`).
- **Suggested sequence**: (1) sanitize CSS vars → (2) collapsible sidebar →
  (3) docked value panel → (4) remaining polish by priority.

---

## Point 1: Value Viewer as a Docked Side Panel (DBeaver Pattern)

### Diagnosis of the Current State (Verified)

- `CellValueViewer.tsx:28-51` — centered modal reusing the
  `.grid-edit-overlay` class (`App.css:1486-1494`, `position:absolute; inset:0`
  inside `.result-grid-canvas`). Concrete problems behind the "not utilitarian"
  feedback: (a) it covers the grid — prevents comparing the value with
  neighboring rows; (b) it freezes context — `rawValue` is a snapshot
  (`ResultGrid.tsx:142`, `valueViewer` state), navigating to another cell
  doesn't update it, requiring close → right-click → "View value…" again for
  every cell; (c) the panel header (`.value-viewer-header`, `App.css:1589-1594`,
  `space-between` with 5 controls) gets squeezed in a `min-width:420px` modal
  (`App.css:1576`).
- The functionality itself (Auto/Text/JSON/XML detection via `valueFormat.ts`,
  wrap, copy) is good and must be preserved in full — only the *container* is
  the problem.

### Proposal: Panel Docked to the RIGHT of the Grid

- **Side: RIGHT.** It's the DBeaver pattern ("Value" viewer on the right/bottom)
  and, in the current Wisp layout, the left is already taken by the
  schemas/tables Sidebar — docking the value panel on the left would create two
  competing vertical strips on the same side and squeeze the grid in the middle.
  Right keeps the symmetry: navigation (left) → data (center) → detail (right).
- **Where the state lives**: inside `ResultGrid` (local state, next to the
  current `valueViewer`, `ResultGrid.tsx:142`). Reason: the grid is shared
  between Console and TableTab, and placing the panel as a sibling of the grid
  *inside* `ResultGrid` makes the feature work in both contexts without changing
  `ConsoleTab`/`TableTab` or drilling props beyond 1 level (project
  convention). The inner layout becomes flex-row: `DataEditor` (flex:1) +
  vertical handle + panel (hook width).
- **Resize**: reuse `useDragResize({axis:'x', initial:320, min:240,
  max:640, storageKey:'wisp:valuePanelWidth'})` — same hook as the sidebar and
  the editor/grid split (`ConsoleTab.tsx:135-136`). No new mechanism.
- **Follow selection vs. explicit opening — HYBRID recommended**:
  - The panel gets a visible toggle in the `result-toolbar` (e.g. a "Value"
    button that shows/hides it, with preference in `localStorage`
    `wisp:valuePanelOpen`).
  - With the panel OPEN, it **follows the active selection on its own**:
    `ResultGrid` already has `gridSelection` (`ResultGrid.tsx:125`, updated via
    `onGridSelectionChange`) and `handleCellClicked` (`ResultGrid.tsx:314`) —
    the panel derives `{column, value}` from the current cell with no extra
    action.
  - With the panel CLOSED, the "View value…" context-menu item
    (`ResultGrid.tsx:627-637`) stays and now **opens the panel already
    positioned on that cell** (instead of opening a modal). Anyone who prefers
    the old flow loses nothing; anyone who wants the DBeaver flow leaves the
    panel open and just navigates with arrows/clicks.
  - Mandatory correctness detail: the cell→value derivation must go through
    `toOriginalRow` (`ResultGrid.tsx:170-172`), because `gridSelection` is in
    **visual** space (post-filter) — without it, with the quick filter active,
    the panel would show the wrong row (the same trap already documented in the
    `markedRowsMatrix`/`rangeMatrix` comments).
- **Preserve**: format selector, wrap toggle, copy button (same
  `valueFormat.ts` + `copyToClipboard`, no logic change); `role="dialog"`
  becomes `role="complementary"` with the column's `aria-label` (a persistent
  panel is not a modal); `Escape` with panel focus closes/hides it (the global
  `Escape` handler in `ResultGrid.tsx:471-476` already clears `valueViewer` —
  adapt to the new state).
- **Edge cases**: with no selection (empty grid / `columns.length===0`) the
  panel shows the empty state ("Select a cell…") instead of disappearing —
  avoids layout jumps on every run; NULL values show the same amber style as
  the grid; very long text keeps its own scroll (`overflow:auto` like the
  current `.value-viewer-content`, `App.css:1620-1631`).
- Priority HIGH · effort MEDIUM (layout + selection wiring; zero new
  format/copy logic).

### What I Do NOT Recommend

- BOTTOM panel (below the grid): the vertical axis is already contested by
  editor → actions → result-tab-bar → grid → load-more; another horizontal
  split flattens the grid into uselessness. A vertical split on the right is
  the only one that scales.
- Generic icon-only/mini-bar: the panel needs ~300px to render legible
  pretty-printed JSON; an expanding mini-bar is one extra step with no gain
  over a direct toolbar toggle.

---

## Point 2: Minimizable/Collapsible Sidebar

### Diagnosis of the Current State (Verified)

- `Sidebar.tsx:27` receives `style` with its width from outside;
  `ConsoleTab.tsx:135` (`useDragResize`, min 180 / max 480) + handle in
  `ConsoleTab.tsx:764`. Drag only — the 180px minimum never frees real space
  for the grid.
- **Scope check**: grepping `useDragResize|Sidebar` in
  `frontend/src` shows only `ConsoleTab.tsx` imports the `Sidebar`
  (lines 12, 756-764). `TableTab.tsx` has no sidebar (read the first
  100 lines + grep with no Sidebar match). So the collapse state lives in
  **a single place** (`ConsoleTab`), with no cross-tab coordination.

### Proposal: Collapsed = HIDDEN + Reopen Strip

- **Hidden, not icon-only.** The Sidebar is a text tree with search
  (`sidebar-header` / `sidebar-search` / `sidebar-tree` — `Sidebar.tsx:165-283`):
  none of that survives in a 40px strip (neither heading, nor search input,
  nor table name). Icon-only only makes sense for a toolbar;
  here the right call is `display:none` + a reopen control. That answers
  the prompt's question directly — yes, hidden is more appropriate.
- **Controls** (two, both cheap):
  1. Chevron button (`‹`/`›`) on the sidebar's right edge (or over the
     existing `resize-handle`) that collapses; `title="Collapse side panel"`.
  2. When collapsed: the sidebar disappears (handle included) and a thin
     clickable strip appears on the workspace's left edge (`title="Expand side
     panel"`) — or, even simpler, a discreet button in
     `toolbar-secondary`. I recommend the edge strip (VS Code/DBeaver pattern,
     immediate discovery, zero button-hunting).
- **Persistence**: `localStorage` `wisp:sidebarCollapsed` (`'1'`/`'0'`),
  same pattern as the `wisp:sidebarWidth`/`wisp:editorHeight`/`wisp:lastOpenScript`
  keys. State: boolean `useState` in `ConsoleTab` next to `sidebarResize`;
  conditional render (`{!collapsed && <Sidebar/>}`) — the `Sidebar` itself
  barely changes (good for the "small components" convention).
- **Behavior with active search**: collapsing with search text loses nothing
  ( `search` is Sidebar-internal state; if the Sidebar unmounts, the text
  is lost — accept and document, or lift just `search` if that bothers;
  I recommend accepting: collapsing with an active search is a rare case, not
  worth lifting state and breaking the prop-drilling convention).
- Priority HIGH · effort LOW (1 boolean + 2 controls + strip CSS).

---

## Point 3: General UI Review (Polish, Prioritized)

Effort legend: **L**ow (CSS/class only), **M**edium (local TSX markup),
**H**igh (changes layout or touches several components). Nothing below asks for
a new lib — everything fits in pure CSS with the `:root` vars.

### P0 — Var Sanitation (Do Before Everything Else)

1. **Hardcoded colors outside the palette** (L): `#1e1e22` (context menu
   `App.css:1428`, edit popover `1509`, value panel `1582`), `#93c5fd`
   (table name `App.css:244,259`, leaf hover `1095`, active conn `526,538`),
   `#2563eb` straight (`App.css:1006`, `1572`, edit button `1502`) instead of
   `var(--accent-blue)`/`var(--border-focus)`, `#131315` (`1544,1625`,
   edit input `1500`) instead of `var(--bg-grid)`. Real effect: changing one
   tone today means hunting N spots; any "UI improvement" proposal without
   this creates new inconsistency.
2. **Referenced-but-NEVER-defined vars** (L): `var(--font-mono)` used in
   `App.css:159,198,256,1407,1564...` and `var(--accent-color, #3b82f6)` in
   `App.css:932` — with no `:root` definition (`App.css:5-34`), what applies is
   accidental fallback/inheritance. Define `--font-mono` and `--accent-color`
   for real in `:root`.
3. **Duplicated NULL amber** (L): `ResultGrid.tsx:272` hardcodes `textDark:
   '#d97706'` inline while `--accent-amber: #d97706` exists
   (`App.css:33`). Use the var (or expose it via the theme) to keep a single
   source.

### P1 — Concrete Usability (High Value, Low/Medium Cost)

4. **`tree-leaf-open ↗` on hover only** (`App.css:305-307`) (M): unreachable by
   keyboard and on touch (desktop Webview has touch on some setups; and a
   screen reader never "hovers"). Show on `:focus-visible`/`focus-within` too.
5. **Too-thin resize handles** (`App.css:935-947`, 4px) (L): a tiny target even
   for the mouse; add an invisible hit-area (`::after` at 10-12px) keeping the
   4px visuals.
6. **`result-toolbar` with `space-between`** (`App.css:1384-1393`) (L): in a
   narrow window the `result-filter-input` (fixed 220px width, `App.css:1567`)
   squeezes the badges or overflows. `flex-wrap:wrap` + `min-width:0` fixes it.
7. **Raw `tabId` exposed in the toolbar** (`ConsoleTab.tsx:752`,
   `.toolbar-tab-id`) (L): `tab-uuid…` is visual noise for end users
   (useful for debug, not for UI). Hide behind `title` or remove from the
   bar — frees space and cuts clutter.
8. **Value select off-pattern** (L): `.value-viewer-controls select`
   (`App.css:1604-1611`) doesn't use `.input-control` (`App.css:347-371`, which
   already has hover/focus/disabled). Unify (in the docked panel, free by
   inheritance).
9. **Secondary-text contrast** (L): `--text-muted #71717a` over `#131315/#141416`
   backgrounds is borderline WCAG AA at 11px (badges, hints,
   `result-readonly-notice`). Go one step up (e.g. `#8e8e96`) or
   restrict the current tone to ≥12px text.
10. **3-bar stacking** (M): `toolbar-secondary` + `editor-actions` +
    `result-tab-bar` take ~100px vertically before the first datum. Consider
    merging `toolbar-secondary` into the `editor-actions` row (or moving the
    uppercase toggle to settings) — direct grid-area gain, the scarcest good
    on screen.

### P2 — Consistency (When Time Allows)

11. **Empty states in 3 dialects** (L): `sidebar-empty` / `result-empty` /
    `meta-empty` with different paddings, icon sizes, and tones
    (`App.css:1021-1038, 1642-1660, 268-277`). Unify into a single pattern.
12. **Hardcoded modal container** (L): `.modal-container` uses `#18181c` and
    `#151518` (`App.css:557,616`) instead of vars — part of the P0 sanitation,
    but cited separately because ConnectionModal is the other "floating"
    surface suffering the same ailment as the old CellValueViewer.
13. **`history-panel` with no collapse** (M): once Point 2 is done,
    apply the same hidden+strip pattern to `QueryHistory` (same mechanics,
    another `localStorage` key) — don't do it together, to avoid inflating
    scope.
14. **Inconsistent visible focus** (L): inputs have `:focus` with a blue ring
    (`.input-control:focus`), but `.btn`, `.tab-item`, and `.tree-leaf` have no
    focus style — keyboard navigation goes blind outside inputs.
    Add a global `:focus-visible` with `var(--border-focus)`.

### Explicitly OUT of Scope (Don't Propose Now)

- New virtualization, server-side pagination, light theme, grid lib swap,
  semantic search — none of it follows from the feedback and all of it violates
  "minimal change" or existing ADRs.

---

## Reference Files/Lines (All Confirmed by Reading)

| What | Where |
|---|---|
| Current value modal | `frontend/src/components/CellValueViewer.tsx:28-51` |
| Value snapshot state | `frontend/src/components/ResultGrid.tsx:142, 627-637, 689-695` |
| Grid active selection | `frontend/src/components/ResultGrid.tsx:125, 314-338, 593-594` |
| Visual-vs-real space trap | `frontend/src/components/ResultGrid.tsx:149-172, 400-436` |
| Global Escape | `frontend/src/components/ResultGrid.tsx:462-484` |
| Format/copy (preserve) | `frontend/src/lib/valueFormat.ts`, `gridCopyFormats.ts` |
| Sidebar + external style | `frontend/src/components/Sidebar.tsx:24, 27, 164-186` |
| Sidebar's only consumer | `frontend/src/components/ConsoleTab.tsx:12, 135-136, 756-764` |
| Resize hook | `frontend/src/lib/useDragResize.ts:15-54` |
| `:root` vars | `frontend/src/App.css:5-34` |
| Value overlay/panel CSS | `frontend/src/App.css:1486-1494, 1575-1640` |
| resize-handle CSS | `frontend/src/App.css:922-947` |
| Tabs/tab types | `frontend/src/App.tsx:10-49` |

*Analysis written by OpenCode on 2026-09-15. No code files were
changed — only reading and this document.*
