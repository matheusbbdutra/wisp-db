# ADR 0011 — SQL Editor Automatic Word Wrap and Preference Architecture

**Status:** Accepted
**Date:** 2026-09-22

## Context

In `SqlEditor.tsx:543`, Monaco Editor is configured with:
```tsx
wordWrap: readOnly ? 'on' : 'off',
```
For interactive query editing in the console, `wordWrap` is permanently disabled (`'off'`). Consequently, pasting formatted SQL queries or long statements results in a single, excessively long horizontal line that forces horizontal scrolling and degrades developer experience.

Additionally, `SqlEditor.tsx` currently stands at ~686 lines. Introducing editor preference toggles, controls, and UI state directly into this component risks violating clean code boundaries and turning it into a god file.

## Decision

1. **Configurable Word Wrap in Monaco Editor**:
   - Update `SqlEditor.tsx` to support dynamic `wordWrap` configuration (`'on' | 'off'`), defaulting to `'on'` for interactive editing.
   - Configure `wrappingIndent: 'indent'` so that wrapped lines align cleanly with the indent level of the statement.
2. **Decoupled User Preference**:
   - Persist user preference globally in `localStorage` under `wisp:wordWrap` (following the pattern established by `AUTO_UPPERCASE_STORAGE_KEY`).
   - Default setting is `true` (wrapped).
3. **Decoupled Toolbar Control**:
   - Place the toggle action (button / keyboard shortcut `Alt+Z`) within `ConsoleToolbar.tsx` (~120 lines), preserving `SqlEditor.tsx` as a pure editor wrapper with a minimal interface prop (`wordWrap?: boolean`).

## Consequences

- **Pros**: Long pasted queries wrap cleanly without requiring manual line breaks or horizontal scrolling; editor file size is not bloated; consistent with existing client preferences.
- **Cons**: Users who prefer rigid horizontal alignment will need to toggle word wrap off.
