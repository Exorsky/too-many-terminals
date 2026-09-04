# Terminals

## The session list

Every open session — Claude and shell alike — lives in **one flat list**, sorted by what it's
doing rather than by which folder it came from. There are no folder groups, no accordions and
no nesting: thirteen sessions are thirteen rows.

That's a deliberate reversal. Sessions used to sit inside collapsible per-folder groups, which
cost a header row and a "New session" row per folder before a single session appeared, and
buried a running session three folders down. The flat list trades away per-folder ordering for
the thing the sidebar is actually for: seeing what needs you.

### Order

`sortRank()` (`Sidebar.tsx`) ranks every row, and `sort` is stable so equal ranks keep the
order you opened them in:

1. **Pinned**, whatever it's doing — you put it there on purpose.
2. **Waiting on you** (`requires_response`).
3. **Running** (`working`).
4. **Idle** — alive, finished, nothing pending.
5. **Quiet** — dormant, `new`, exited, and every shell.

There is no manual ordering to preserve, so dragging a session no longer does anything;
`tabsReducer`'s `reorderTab` action was removed with the folder groups that gave it meaning.

The rank comes from `segOf()`, which mirrors `TabIndicator`'s
[status vocabulary](../design.md#status-vocabulary) one-for-one. It is deliberately **not**
derived from `bucketsOf()`: buckets answer "show me what just finished", `segOf` answers
"what is this session doing". Deriving one from the other is what once ranked a plain `idle`
session down with the sleepers — `done` requires `justFinished`, so a finished-and-seen
session fell into no bucket at all while its own row showed a green check.

### A row is two lines

The name gets the whole first line. Everything else — folder, activity, time — goes on a
second, smaller line beneath it (`RowMeta`). Cramming the folder chip onto the same line as
the name left names reading "Commit to ma…" at 260px, which is no name at all.

The second line renders **only when it has something to say**, so with one folder open and
nothing happening, rows stay one line tall. It can carry:

- **The folder** — hue dot plus name, shown only when the visible rows can actually come from
  different folders (more than one folder open *and* no folder filter active).
- **What Claude is doing right now** — `Tab.statusDetail` from the PreToolUse hook, split by
  `splitActivityDetail` into a muted verb and a `warning`-colored target ("editing
  **Sidebar.tsx**"). See
  [tab-status-and-naming.md](tab-status-and-naming.md#the-activity-caption).
- **Time**, right-aligned: how long a `requires_response` session has been waiting, or
  otherwise **last used**.

### Last used

A tab carries no date of its own — one restored from a past run comes back with nothing but a
session id — so `useLastUsed()` reads the same transcript mtimes History reads
(`ipc.listSessions`, one call per open folder, re-read when the session count changes) and
keys them by session id. The row shows whichever clock is fresher: a status transition this
run (`statusChangedAt`) or that mtime, formatted with `SidebarFooter`'s `formatDuration`
("3d 4h ago"). A session mid-turn shows nothing — it was last used *now*, and the activity
summary already says so.

### Row spine

A 2px bar down a row's left edge, drawn only for `requires_response` (`attention`) and
`working` (`warning`), so live sessions form one readable column of color down an otherwise
flat list. Quiet rows have no spine, which is what makes the ones that do have one worth
looking at. `spineClass()` gives the bar to a live status ahead of the selected row's own
`primary` bar: the row you're looking at is already obvious from its background tint, whereas
a session that needs you is exactly what the column exists to surface.

## Folders are a filter, not a heading

Any number of folders can be open at once (`App.tsx` `projects: string[]`). Each is a **pill**
in a row under the [lens](attention-inbox.md): its accent hue as a dot, its name, its session
count, and the [credentials glyph](env-loading.md) when it has any. Click one to narrow the
list to that folder; click it again, or the leading **All** pill, to go back.

The selected pill is drawn in the folder's **own hue** — border and tint — rather than a
neutral highlight. A white-on-white tint at 10.5px was invisible next to unselected pills that
all carry the same bright dot, and the hue is already the color spent on identifying this
folder everywhere else. Two more things guard against "which one did I click": the selected
pill scrolls itself into view (the row wraps, so a pill can sit below the fold), and the
folder's name always appears in the lens line above the list.

Pills **wrap** onto a second and third line rather than scrolling sideways — a horizontal
scroller hides folders behind a gesture a mouse is bad at, and "which folders do I have open"
is exactly what this row is for. Past three lines it scrolls.

### Naming a pill

`pillLabel()` shows just the folder name until two open folders share one, at which point
**both** grow their nearest ancestor (`one/api`, `two/api`) and nothing else does. This
replaces the old **Show folder paths** preference: the breadcrumb it gated lived on the
folder-group header, which no longer exists, and telling two identically-named folders apart
is correctness rather than taste — not something to leave off behind a toggle.

### A folder's context menu

Right-click a pill for **New Claude session** / a shell per `ShellOption`, **Open directory**,
**Import session…**, or **Remove folder** (kills its open tabs, no confirmation — closing tabs
isn't destructive, transcripts stay on disk). These live in a context menu rather than
permanent icons so the pill row isn't carrying rarely-used actions at all times.

### Starting something

One **`+`** button at the end of the pill row, and it adapts to what you're looking at:

- A folder is selected (or only one is open) → a flat menu of **Claude** plus each shell,
  landing in that folder.
- Several folders open and none selected → one submenu per folder, each with the same items.
- Always, at the bottom: **Add folder…**, which opens the native picker
  (`@tauri-apps/plugin-dialog`, `ipc.pickFolder`) and appends a new project; picking an
  already-open folder is a no-op.

This replaces the per-folder "New session" row that used to sit under every folder group —
one row per folder, permanently, to offer something you use a few times a day.

## Pinning a session

Any session can be pinned from its right-click menu (**Pin session** / **Unpin**,
`Tab.pinned`) so it doesn't need a scroll to reach. A pinned session sorts above everything
else and carries a small `primary` pin glyph on its row; it also gets a **pinned** chip in the
[session ledger](attention-inbox.md), which filters the list to just those. Pin state persists
like the rest of the workspace (see [workspace persistence](workspace-persistence.md)).

## Searching sessions

A **Search sessions** item sits in the sidebar footer's "more" menu — the same command palette
Ctrl+Shift+P opens (see [command-palette.md](command-palette.md)). For narrowing the list
while you keep looking at it, use the filter field in the lens row instead; the palette is
modal and closes.

## Reordering folders (drag & drop)

Folder pills can be reordered by dragging (native HTML5 DnD; Tauri's own file-drop handler is
turned off via `dragDropEnabled: false` in `tauri.conf.json` so the webview receives the drag
events). Grab a pill, drop it onto another — `App.tsx` `handleReorderProject` splices the
`projects` array, the new order persists with the rest of the workspace, and the pills re-hue
by their new index.

Sessions are **not** draggable: the list derives its own order from status, so there is
nothing to rearrange.

### The drop indicator

The valid drop target renders a `DropLine` — a glowing 2px accent bar (`bg-primary`) sitting
in the gap the pill will fall into rather than outlining it (an outline can't say *before* vs
*after*). The pill row runs across rather than down, so the line is **vertical** and the side
is decided by `dropSideX()`: cursor left of the pill's horizontal midpoint → `before`, right →
`after`. That `'before' | 'after'` flows through `onReorderProject` into the array splice —
which is why a drop can land *after* the last pill, something a plain insert-before couldn't
reach. Each pill stores its own `dropPos` and sets it only when the side changes (React bails
out of identical-value updates), so the line never flickers.

## Sidebar collapse

The sidebar can be hidden to an 11px icon rail (`PanelLeftClose`/`PanelLeftOpen` toggle,
`App.tsx` `collapsed` state) — tabs render as icon-only buttons (flat across all projects),
under a stacked copy of the [ledger counts](attention-inbox.md#collapsed-rail). The rail has
no footer, so it keeps its own Home / History / Files / Add folder / Settings squares —
otherwise collapsing the sidebar would cut that navigation off entirely. Matches the original Electron app's collapse
behavior, including the width transition (`transition-[width]` on a single shared root
element — swapping between two early-return roots would remount instead of animating).

The "+" menu opens terminal tabs of two kinds:

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
`src/components/ui/context-menu.tsx`) with four actions:

- **Rename** — enters the same in-place edit as double-click.
- **Open directory** — opens the tab's `cwd` (its project folder) in the OS file manager,
  via `ipc.openDirectory` → the opener plugin's `openPath`. Needs the
  `opener:allow-open-path` permission in `capabilities/default.json`.
- **Pin session** / **Unpin** — see [Pinning a session](#pinning-a-session) above.
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

- `src/App.tsx`, `src/components/Sidebar.tsx` (`SidebarLens`, `FolderBar`/`FolderPill`,
  `NewMenu`, `TabRow`/`RowMeta`, `sortRank`/`segOf`, `useLastUsed`, `pillLabel`),
  `src/components/SidebarFooter.tsx` (app navigation), `src/components/Terminal.tsx`,
  `src/components/terminalCache.ts`, `src/components/ui/context-menu.tsx` (tab right-click menu),
  `src/lib/tabs.ts`, `src/lib/utils.ts` (`folderName`, `parentPath`),
  `src/main.tsx` (global contextmenu suppression)
- `src-tauri/src/pty.rs`, `shell.rs`, `claude.rs`, `commands.rs`

## Tests

- `src/lib/tabs.test.ts` — tab state transitions, including `rename` and `pin`
- `src/lib/utils.test.ts` — `parentPath` (nearest-two-ancestors, ellipsis, fewer-than-two,
  root-level, forward-slash paths, custom level count)
- `src/components/Sidebar.test.tsx` — session rows and the flat list's order (pinned →
  waiting → running → idle → asleep, stable among equals, and a live idle session ranking
  above a dormant one), the two-line row (folder on its own line, second line dropped when
  it would say nothing, activity target highlighted, elapsed and last-used), the session
  ledger and filter field (see [attention-inbox.md](attention-inbox.md)), folder pills
  (counts, narrowing, the lens naming the selection, pressed state, per-row folder line
  dropped once one folder deep, falling back to All when the selected folder is removed,
  the context menu, drag-reorder), the "+" menu in all three shapes, footer and rail
  navigation, double-click rename (commit/cancel/empty-name-discard), `bucketsOf`,
  `pillLabel` and `matchesQuery`
- `cargo test shell::` / `claude::` — per-platform shell lists and claude command shape
- `cargo test workspace::` — includes the `pinned` field round-tripping and loading as
  unpinned from a workspace file saved before the field existed

Manual PTY verification checklist: docs/development.md.

See also: [workspace persistence](workspace-persistence.md) for how open tabs survive
an app restart, and [file explorer](file-explorer.md) for `TabBar` — the strip above the
content pane holding every tab you've gone into (sessions, shells and files).
