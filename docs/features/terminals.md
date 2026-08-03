# Terminals

## Project folders

Any number of folders can be open at once (`App.tsx` `projects: string[]`), each rendered
as its own card in the sidebar — hue assigned sequentially in the order folders were added
(`projectHue(index)`, same scheme as the original multi-project app), tab list as its
collapsible body. Click a card's header to expand/collapse just that folder's tabs; click
the X inside it to remove the folder (kills its open tabs, no confirmation — closing tabs
isn't destructive, transcripts stay on disk). "Add folder…" (dashed button below the cards,
or the folder-plus icon in the collapsed rail) opens the native picker
(`@tauri-apps/plugin-dialog`, `ipc.pickFolder`) and appends a new project; picking an
already-open folder is a no-op. Each project's "New session" menu is scoped to that
project — every tab spawns with its owning folder as `cwd`.

## Reordering (drag & drop)

Both folder cards and sessions can be reordered by dragging (native HTML5 DnD; Tauri's
own file-drop handler is turned off via `dragDropEnabled: false` in `tauri.conf.json` so
the webview receives the drag events). Two things stay put:

- **Folders reorder among folders.** Grab a card by its header and drop it onto another
  card — `App.tsx` `handleReorderProject` splices the `projects` array (the new order
  persists like the rest of the workspace, and re-hues the cards by their new index).
- **Sessions reorder within their own folder.** Drag a `TabRow` onto another row in the
  same card — `tabsReducer`'s `reorderTab` action moves it. A session **cannot** move into
  another folder and a folder **cannot** nest inside another: a drop is only accepted when
  the drag item and target match kind (and, for sessions, share the same `cwd`). The check
  is synchronous during `dragover` via a shared `dragRef` in `Sidebar`, so cross-folder
  targets show no indicator at all; the reducer refuses a cross-`cwd` move as a second guard.

### The drop indicator

The valid drop target renders a `DropLine` — a glowing 2px accent bar (`bg-primary`) with a
leading cap, sitting in the gap the item will fall into rather than outlining the whole row
(an outline can't say *before* vs *after*). Which side is decided by `dropSide()`: cursor
above the target's vertical midpoint → `before`, below → `after`, so the line follows the
pointer between rows. That `'before' | 'after'` position flows all the way through
`onReorderTab`/`onReorderProject` into the reducer/array splice — which is why a drop can
land *after* the last row, something a plain insert-before couldn't reach. Each target
stores its own `dropPos` state and sets it only when the side changes (React bails out of
identical-value updates), so the line never flickers. Cards use `DropLine`'s `flush`
variant (tucked to the card's own edge, since their `overflow-hidden` would clip a line
floated into the gap); rows let it sit in the `my-0.5` margin between them.

## Sidebar collapse

The sidebar can be hidden to an 11px icon rail (`PanelLeftClose`/`PanelLeftOpen` toggle,
`App.tsx` `collapsed` state) — tabs render as icon-only buttons (flat across all projects),
History and "Add folder" stay reachable. Matches the original Electron app's collapse
behavior, including the width transition (`transition-[width]` on a single shared root
element — swapping between two early-return roots would remount instead of animating).

The sidebar's "New session" menu opens terminal tabs of two kinds:

- **Claude** — runs the `claude` CLI (Claude Code) in a pty.
- **OS shells** — provided by `src-tauri/src/shell.rs` per platform:
  - Windows: PowerShell, Command Prompt
  - macOS: Zsh, Bash
  - Linux: Bash, Zsh, Fish

  The list is static per platform (a shell may not be installed; spawning then fails and
  the tab is marked exited).

## Renaming a tab

Double-click a tab's name — or pick **Rename** from its right-click menu — to rename it in
place (`Sidebar.tsx` `TabRow`, local `editing` state): Enter commits, Escape reverts, blur
commits, an empty/whitespace-only name is discarded. Renames go through the same
`tabsReducer` `rename` action session history used internally, and persist like anything
else in the workspace (see [workspace persistence](workspace-persistence.md)).

## Tab context menu

Right-clicking a tab row opens an app-native menu (Radix `ContextMenu`, wrapped in
`src/components/ui/context-menu.tsx`) with three actions:

- **Rename** — enters the same in-place edit as double-click.
- **Open directory** — opens the tab's `cwd` (its project folder) in the OS file manager,
  via `ipc.openDirectory` → the opener plugin's `openPath`. Needs the
  `opener:allow-open-path` permission in `capabilities/default.json`.
- **Close** — same as the row's `X` (`pty_kill` + tab removal).

The webview's own browser-style menu (Inspect/Reload) is still suppressed app-wide
(`main.tsx`, a single `document`-level `contextmenu` listener that calls `preventDefault()`);
Radix's trigger opens our menu on the same event. Everywhere *outside* a tab row, right-click
does nothing — the terminal's old copy-on-select/paste-on-right-click is gone.

## Flow

1. `App.tsx` `spawnTab()` creates a `Tab` (id = `crypto.randomUUID()`), dispatches `add`,
   and calls `ipc.spawnPty()` with a per-tab channel whose callback routes bytes into
   `terminalCache.writeToTerminal`.
2. `commands.rs::pty_spawn` builds the command (`claude.rs` for Claude tabs incl.
   `--resume <sessionId>`, `shell.rs` lookup for shells), spawns via `pty.rs`
   (portable-pty), and starts a reader thread streaming raw bytes over the channel.
3. `Terminal.tsx` lazily creates one xterm instance per tab, cached in
   `terminalCache.ts` across React unmounts so hidden tabs keep buffering output.
   Fit-on-resize (ResizeObserver → `pty_resize`), Ctrl+V paste, links open externally via
   the opener plugin.
4. Closing a tab calls `pty_kill` (Windows: `taskkill /T`), disposes the xterm instance,
   and removes the tab. Backend `pty-exit` events mark tabs whose process died on its own.

## Files

- `src/App.tsx`, `src/components/Sidebar.tsx`, `src/components/Terminal.tsx`,
  `src/components/terminalCache.ts`, `src/components/ui/context-menu.tsx` (tab right-click menu),
  `src/lib/tabs.ts`, `src/main.tsx` (global contextmenu suppression)
- `src-tauri/src/pty.rs`, `shell.rs`, `claude.rs`, `commands.rs`

## Tests

- `src/lib/tabs.test.ts` — tab state transitions, including `rename` and `reorderTab`
  (same-folder move, no-op guards, cross-folder refusal)
- `src/components/Sidebar.test.tsx` — tab rows, per-project shell menu, card expand/collapse,
  add/remove folder, multiple simultaneous project cards, empty state, sidebar collapse,
  double-click rename (commit/cancel/empty-name-discard), drag-to-reorder folders and
  sessions (and refusal to move a session across folders)
- `cargo test shell::` / `claude::` — per-platform shell lists and claude command shape

Manual PTY verification checklist: docs/development.md.

See also: [workspace persistence](workspace-persistence.md) for how open tabs survive
an app restart, and [file explorer](file-explorer.md) for `TabBar` — the strip of open
file tabs (plus a single slot for your last-active session) docked above the content pane.
