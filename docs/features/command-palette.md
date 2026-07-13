# Command palette

A fuzzy switcher over every open terminal, summoned from anywhere with
**Ctrl/Cmd+Shift+P**. Type a fragment of a tab's name, its folder, or a status
word, and jump straight to it — the fast path for "which terminal was that?"
without scanning collapsed sidebar cards.

## Why Ctrl+Shift+P (not Ctrl+K)

Ctrl+K is the usual command-palette chord, but inside a shell it's readline's
*kill-to-end-of-line* — hijacking it globally would break every shell tab. The
app hosts terminals, so the shortcut has to dodge readline. Ctrl/Cmd+Shift+P
(VSCode's palette chord) is never bound in a shell, so it's safe to grab
app-wide.

## Behavior

- The shortcut listener is registered in `App.tsx` on `window` in the **capture
  phase** (`addEventListener(..., true)`), so it fires before the focused xterm
  can swallow the key. It toggles `paletteOpen`.
- Opening resets the query and selection and focuses the input. `Escape`, a
  click on the backdrop, or choosing a result closes it.
- **Matching** is `fuzzyScore` (`src/lib/fuzzy.ts`): a case-insensitive
  subsequence match that rewards consecutive characters and word-boundary starts
  (so "ag" ranks `api-gateway` above `images`). Results sort by score; an empty
  query lists every tab.
- Each tab's search text is `name + folder + status words`, where status words
  come from `STATUS_TERMS` — typing `needs` surfaces sessions blocked on input,
  `done` the finished ones, `working` the busy ones. Shell tabs fold in
  `shell terminal`.
- Rows show the same status icon as the sidebar (`TabIndicator`, exported from
  `Sidebar.tsx`) plus the folder on the right. `↑`/`↓` move (wrapping), the
  hovered row becomes selected, `↵` opens, and selecting routes through the same
  `handleSelectTab` a sidebar click uses (which also closes History/Settings).

## Scope / follow-ups

- **Open tabs only** for now. Folding in past sessions (from
  [session history](session-history.md)) and folder actions ("new session in…")
  would make it a true command palette — a natural next step, but it needs the
  async per-project session fetch, so it's deferred.
- The trigger key is fixed; a rebind setting could live in
  [settings](settings.md) later.

## Files

- `src/lib/fuzzy.ts` (+ `fuzzy.test.ts`) — the subsequence scorer.
- `src/components/CommandPalette.tsx` (+ `CommandPalette.test.tsx`) — the overlay,
  filtering, and keyboard nav.
- `src/components/Sidebar.tsx` — exports `TabIndicator`, reused for row icons.
- Wiring in `App.tsx`: `paletteOpen` state, the capture-phase shortcut effect,
  and the root-level `<CommandPalette>`.
