# File explorer

A file browser and editor at the right edge of the window, opened from the
**Files** square in the [sidebar rail](terminals.md#the-rail-folders-and-navigation).
Browse every open project's files, open one as a tab, and edit it in place.

## Three states, not two

`App.tsx` holds `filesMode: 'hidden' | 'peek' | 'pinned'` (default `pinned`).

| | what it is | opened by | closed by |
|---|---|---|---|
| **hidden** | an 8px strip at the right edge (`FilesEdge`) | — | — |
| **peek** | the panel laid **over** the terminal | hovering the strip (300ms), clicking it, focusing it | Escape, a click outside, **opening a file** |
| **pinned** | docked beside the terminal, with the resize seam | the pin in the panel header, the rail's Files square | the same two, explicitly |

The rail's Files square still toggles **pinned ↔ hidden**, exactly as it did
when this was a boolean, so the habit survives. Peeking is a separate gesture.

### Why peek exists

Not screen space — **the terminal's own reflow**. Docked, the panel is a flex
sibling of `<main>`, so every open and every close narrows main, wakes the
`ResizeObserver` in `Terminal.tsx`, and runs `fitAddon.fit()` → `pty_resize`:
xterm rewraps every line it is showing, twice per visit. A peek is
`position: absolute` over the terminal, so main never changes width and nothing
rewraps.

### Peek closes on focus, never on the pointer

This is the one thing that would be easy to get wrong. Reaching a file deep in
the tree walks the cursor past the panel's edges, and a `mouseleave` rule would
cancel the errand halfway through. That is the line between a hover menu and a
tool window — JetBrains calls the same mode
[Dock Unpinned](https://www.jetbrains.com/help/idea/viewing-modes.html) and
hides it the same way.

Opening a file closes a peek by itself: look, take, gone. Pinning is what you
do when you want the panel to stay.

### The strip is visible

Eight pixels with a notch that grows under the cursor, not a bare hot zone. An
invisible edge doesn't announce itself, and when the window isn't flush against
the screen the pointer misses it and the feature reads as broken — the
complaint [Arc's auto-hidden sidebar](https://resources.arc.net/hc/en-us/articles/25619487530519-How-Do-You-Hide-the-Sidebar)
collects. Hover waits **300ms** (the right edge is on the way to a scrollbar or
a window button, so crossing it isn't a request); click and focus don't wait.

There is no resize seam while peeking — the width you drag in the docked mode
is the width the overlay uses. Neither the mode nor the width is persisted, the
same as before this change: the app starts docked.

## Keeping up with the disk

A file open in a tab is usually a file some session in the next pane is busy
rewriting, so **both the tree and the open file re-read themselves while they
are on screen** — no more closing a tab and opening it again to see a change.

- **The tree.** An expanded directory keeps re-listing (`FileTree`); a listing
  that comes back identical is discarded rather than handed to React, so an
  unchanged folder never re-renders its subtree. Collapsed directories poll
  nothing.
- **The open file.** The visible file tab re-reads its own path (`FileViewer`)
  and swaps the text into CodeMirror through `EditorHandle.replaceText`, which
  keeps the scroll position and clamps the caret instead of dropping it, and
  doesn't report the change back as an edit.

Both go through `usePollWhileFocused` (`src/lib/use-poll.ts`), which owns the
one rule they share: **nothing polls while the window is unfocused.**

**Unsaved edits always win.** If the file changes on disk while the tab is
dirty, nothing is overwritten — the header says *"Changed on disk, and you have
unsaved edits"* and offers **Load the file**, or Ctrl+S to keep yours.

### Why polling and not a watcher

`usePollWhileFocused` carries a `ponytail:` note saying as much. A `notify`
watcher means a recursive watch per project plus ignore rules for
`node_modules`/`.git`/`target` plus a debounce, all to learn about changes the
UI mostly isn't showing. Re-reading what *is* on screen costs one directory
listing per expanded folder and one read of one already size-capped text file,
every two seconds, only while you're looking. The watcher earns its keep the
day Files has to react to something it isn't already displaying.

## The tab strip

`TabBar.tsx` (docked above the content pane, its trailing edge hosting
`SessionControls` — Preview/Split — for the active session) holds **the tabs
you've gone into**, in the order you first opened them. Existing and being
*open* are two different things here: every session lives in the sidebar from
the moment it's created, but it only joins the strip when you actually click
into it (`App.tsx` `barTabIds` + `openInBar`, called from `handleSelectTab`,
`spawnTabAt` and `handleOpenFile` — the three ways you enter a tab on purpose).
Open a second session and the first stays up there to click back to; sessions,
shells and files all sit in the same row.

- **Click** to switch. The active tab is scrolled into view whenever it changes,
  since the strip scrolls once enough tabs are open.
- **Drag** a tab onto another to reorder (`moveId` splicing `barTabIds`). The
  strip's order is its own: it doesn't touch the sidebar's, and a session can
  land next to one from a different folder — which the sidebar's own reorder
  refuses, since there a row's position *means* which folder it's in. A vertical
  accent line marks the gap; which side is decided by the cursor against the
  target's horizontal midpoint (`dropSide` in `TabBar.tsx` — the sidebar's own
  turned 90°, four lines, not worth a shared abstraction).
- **× / middle-click** on a *session* takes it out of the strip only — it keeps
  running and stays in the sidebar, which is what owns a session's life.
  Removing the one you're looking at hands you its neighbour in the strip. A
  *file* has no such home, so closing its tab really closes the file (with the
  usual unsaved-changes confirmation).
- Closing a session from the **sidebar** removes it from the strip too, and any
  id whose tab is gone is dropped when the strip is rebuilt — nothing to clean up.
- The strip doesn't survive a restart (it isn't in `SavedTab`); a restored
  workspace opens on Home with an empty strip.

The strip used to hold only file tabs plus a *single* slot for the session you
were last on — the theory being that the sidebar already lists every session, so
a row up top would be redundant. That made it useless for what a tab strip is
for: bouncing between the two or three sessions you're actually working in. The
sidebar is the *organizer* (folders, pinning, renaming, reordering); the strip is
the *switcher*, and it holds what you chose to put there. File tabs are still
excluded from the sidebar's per-project session list and from the command palette
(both stay scoped to "jump to a terminal").

## Behavior

- **Tree.** One lazily-loaded tree per open project folder. A directory fetches
  its own children (`list_dir`) the first time it's expanded — opening a
  project with a large `node_modules` never walks it up front. Collapsing a
  directory drops its cached listing, so the next expand re-fetches instead of
  showing a stale snapshot — the way to pick up a file that appeared on disk
  (e.g. written by a running Claude session) without reopening the whole panel.
  Everything starts collapsed, including the project root row itself —
  nothing auto-expands.
- **Find files.** Typing in the search box switches the panel to a flat,
  breadth-first filename search across every open project (`src/lib/file-search.ts`),
  skipping the usual noisy directories (`node_modules`, `.git`, `dist`, …) and
  capped at 4000 scanned entries / 200 matches so a huge or pathological tree
  can't hang the UI. This is a filename search, not a content search — there's
  no index, just bounded `list_dir` calls.
- **Opening a file.** Clicking a file (in the tree or in search results) opens
  it as a tab of `kind: 'file'` — the same `Tab`/`tabsReducer` every Claude and
  shell tab uses, just with `path`/`dirty` fields and no pty behind it. Clicking
  a file that's already open reuses that tab instead of duplicating it.
- **Editing.** Every open file tab gets its own `FileViewer`/`Editor`
  (CodeMirror 6) instance that stays mounted the whole time the tab is open —
  hidden via `display:none` when it isn't the active tab, exactly like
  `Terminal.tsx` does for xterm. Switching tabs never re-fetches from disk or
  drops in-progress edits; undo history and cursor position survive a tab
  switch too. Language highlighting is auto-detected from the filename via
  `@codemirror/language-data`, loaded on demand.
- **Saving.** **Ctrl/Cmd+S** while the editor is focused, or the same chord
  fires from CodeMirror's own keymap (`Prec.highest`, so it isn't shadowed by
  the browser's save-page binding). Writes through `write_file`, which refuses
  to write outside the project folder the file was opened from — the one path
  in the app that overwrites arbitrary files, so that boundary is enforced on
  the Rust side, not trusted to the UI. A small header strip above the editor
  shows *Saved* / *Unsaved changes* / a save error.
- **Closing a dirty tab** (the `×`, or removing its project folder) asks for
  confirmation via `window.confirm` before discarding the edit — the one
  confirmation dialog in the app, reserved for the one action that can silently
  lose typed work.
- **Markdown** (`.md`/`.mdx`) gets a small Source/Preview toggle in the header
  strip (or **Ctrl/Cmd+Shift+V**), refreshed ~300ms after you stop typing.
  Preview renders through the same `Markdown.tsx` component the session reader
  uses — where a link to another file **opens that file as a tab** instead of
  sending you back to the tree, `#anchors` jump within the document, and
  `mermaid` fences draw. The half you were last on is remembered across tabs
  and restarts, the preview stays mounted so switching back keeps your place,
  and Ctrl/Cmd+F searches it. See
  [markdown-preview.md](markdown-preview.md).
- Files over 4 MB or that aren't valid UTF-8 are refused (read *and* write)
  with a message instead of being opened.
- **Panel width** is drag-resizable from its left edge (200–480px), the same
  pattern as the terminal/markdown split seam in `App.tsx`.

## Files

- `src-tauri/src/files.rs` (+ tests) — `list_dir` (one level, folders first,
  case-insensitive), `read_text` (size/UTF-8 guarded), and `write_text`
  (canonicalizes both sides and checks containment so `../` or a symlink can't
  escape the open project folder). Plain Rust, no Tauri types.
- `src-tauri/src/commands.rs` — thin `list_dir` / `read_file` / `write_file` adapters.
- `src/lib/ipc.ts` — `DirEntry`, `listDir`, `readFile`, `writeFile`.
- `src/lib/file-search.ts` (+ test) — the bounded breadth-first filename search.
- `src/components/FileTree.tsx` (+ test) — the recursive, lazily-loaded tree node.
- `src/components/TabBar.tsx` (+ test) — the top strip; kind-agnostic
  (reuses `Sidebar.tsx`'s exported `TabIndicator`) so it renders whatever list
  it's given. Middle-click close, and a `scrollIntoView` on the active tab.
- `src/lib/tabs.ts` (+ test) — `tabBarTabs(tabs, openIds)`: resolves the opened
  ids against the live tab list, dropping ids whose tab is gone. `moveId`: the
  strip's drag-reorder splice.
- `src/components/FileExplorerPanel.tsx` (+ test) — the panel: header, search
  box, and per-project trees or search results.
- `src/components/Sidebar.tsx` — the folder-tree toggle button in the expanded
  header row, next to Search; the collapsed rail has its own copy.
- `src/components/Editor.tsx` (+ test) — the CodeMirror 6 instance: creates once
  per `path`, exposes an imperative `save()` handle, Ctrl+S keymap, async
  language loading.
- `src/components/FileViewer.tsx` (+ test) — one per open file tab: load, dirty/
  save state, the Source/Preview toggle, the preview's find bar and link →
  open-a-tab wiring, hides via `display:none` when inactive.
- `src/lib/paths.ts` (+ test) — resolving a preview link's target against the
  file it was written in; see [markdown-preview.md](markdown-preview.md).
- `src/types.ts` — `TabKind` gained `'file'`; `Tab` gained optional `path`/`dirty`.
- `src/lib/tabs.ts` (+ test) — `dirty` reducer action.
- Wiring in `App.tsx`: `showFiles` state (defaults `true`), the resize seam,
  `handleOpenFile`, one `FileViewer` mounted per file tab (not just the active
  one — same pattern as the `Terminal` map), `barTabIds`/`openInBar`/
  `handleCloseBarTab` feeding the strip, `SessionControls` hiding itself for a
  file tab (since the strip already shows its name), and the `window.confirm`
  guards in `handleCloseTab` / `handleRemoveProject`.

## Scope / follow-ups

Deliberately left out — see the design notes for why each was cut:

- **Persistence.** File tabs don't survive an app restart — `SavedTab` has no
  `path` field yet. Nothing else needed it, so it wasn't added speculatively
  (and a dirty, unsaved file tab silently vanishing on restart would need its
  own warning before this is worth doing).
- **File watching.** No live reload while a file tab is open; re-open the tab
  to see external changes.
- **File creation/deletion/rename from the explorer.** Only edits existing
  files opened from the tree or search.
- **Content search, git status letters, tabs-within-the-explorer, split
  editors.** All plausible Orca-style additions; none were needed to browse,
  read, and edit a project's files, so none were built.
