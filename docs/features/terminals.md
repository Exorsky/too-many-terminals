# Terminals

## Project folders

Any number of folders can be open at once (`App.tsx` `projects: string[]`), each rendered
as a flat group in the sidebar: a `Folder` glyph plus the folder name and its session count,
tab list as its collapsible body. The header glyph is neutral (`text-muted-foreground`), not
per-folder colored — a folder's hue (`projectHue(index)`, assigned sequentially in the order
folders were added) still marks it elsewhere, in the Pinned/Attention strips' cross-folder
chips (see [Pinning a session](#pinning-a-session) below), where a colored dot is doing real
work disambiguating which folder a listed session belongs to; in the folder's own header,
that job is already done by the name sitting right there; a second color badge would be
decoration, not information. A folder isn't boxed in a tinted, bordered card by default
either — that was the pre-redesign look — but see [Folder activity](#folder-activity) below
for the one case that now earns one back. Click a folder's header to expand/collapse just
that folder's tabs; right-click it for **New Claude session** / a shell per `ShellOption`,
or **Remove folder** (kills its open tabs, no confirmation — closing tabs isn't destructive,
transcripts stay on disk) — the same three actions the in-body **"New session"** row and
header hover-X used to split across two places, now one menu that works whether the folder
is expanded or collapsed. Removal (and now spawning) lives in the context menu rather than a
permanent header icon so the header row isn't carrying rarely-used actions at all times — the
same reasoning behind every other per-item action in this sidebar (rename, pin, tab close).
"Add folder…" (button below the list, or the folder-plus icon in the collapsed rail) opens
the native picker (`@tauri-apps/plugin-dialog`, `ipc.pickFolder`) and appends a new project;
picking an already-open folder is a no-op. Each project's expanded body also keeps its own
**"New session"** row — every tab spawns with its owning folder as `cwd`, from either path.

### Folder activity

A folder with a live Claude session inside it is doing something *right now*, which the flat
row list otherwise treats identically to an idle one. `folderActivity()` (`Sidebar.tsx`) reads
the worst of a folder's own tab statuses — `requires_response` outranks `working` outranks
nothing worth flagging — and:

- Tints the folder's own container with a soft border + background, reusing the matching
  reserved status color (`attention` orange or `warning` amber) at low alpha — the same
  technique the Attention strip's own border already uses, not a new color. This holds
  whether the folder is expanded or collapsed.
- While the folder is *collapsed*, also shows a small `MessageCircle`/`Loader2` glyph next to
  the chevron. Expanded, each row already shows its own `TabIndicator`, so a second copy at
  the header would just repeat it; collapsed, it's the only surviving signal that something
  in there needs a look, since collapsing hides every child row's own status dot.

Dormant and exited tabs are excluded — a session with no live process behind it can't be
"doing something right now" regardless of its last known status.

A folder holding the *currently selected* tab gets the same border-and-tint treatment, but
neutral (`var(--border-hover)`, no status color) — a quiet "you are here" rather than a claim
that something's happening on its own. Real activity still wins: a folder that's both the
active one and has a working/waiting session inside shows the status color, not the neutral
one, since ACTIVITY_TINT is checked first.

A working row also gets a second line under it — `ActivityCaption`, from the PreToolUse hook's
own activity summary (`Tab.statusDetail`, e.g. "editing Sidebar.tsx"). See
[tab-status-and-naming.md](tab-status-and-naming.md#the-activity-caption) for where that string
comes from and how it's split into a muted verb and a highlighted target.

### Folder paths

When two open folders share a name (or you just can't remember which drive/client a
project lives under), the name alone doesn't say where it is — the full path was always
in the row's `title` tooltip, but that means hovering every row to check. `parentPath()`
(`src/lib/utils.ts`) prefixes the name with its ancestor folders, muted and smaller — the
sidebar calls it with `levels = 1`, so just the *one* folder nearest the project:
`… / prog / too-many-terminals`, not a fixed root. An ellipsis marks that there's more above;
nothing is added when a folder has no ancestor at all (one sitting right off a drive root).
Gated by **Show folder paths** (`showFolderPaths`, default on — see [settings.md](settings.md)).
`parentPath` itself still supports showing more (`levels` defaults to 2, and tests cover
arbitrary counts) — the sidebar just doesn't ask for more than one.

Two ancestors was the original design, dropped to one after two rounds of truncation bugs: a
missing shrink priority let the *name* get cut before the path did (fixed by giving the name
`shrink-0`), and then a `dir="rtl"` trick meant to truncate the path from its *start* instead
of its end turned out to reorder the path's separate words instead — `unicode-bidi` reorders
multiple space-separated LTR runs inside an RTL container as blocks, not just flip which edge
truncates, so the "…" marker visually jumped next to the folder name instead of staying at the
far end. One ancestor is short enough to make truncation a non-issue in the first place, which
sidesteps the whole problem rather than trying to solve it with another CSS trick.

The breadcrumb and the folder name share one line and don't always both fit — the name wins
that fight regardless: the breadcrumb span is the only one that shrinks (`min-w-0 shrink
truncate`), the name is `shrink-0`, so it always renders in full. The full path is still
there in the row's tooltip either way.

## Pinning a session

Any session can be pinned from its right-click menu (**Pin session** / **Unpin**,
`Tab.pinned`) so it doesn't need a scroll through unrelated folders to reach. A pinned
session floats into a **Pinned** strip above the folder list — same visual family as the
["Waiting on you"](attention-inbox.md) strip below it (primary blue for what you asked for,
attention orange for what's blocking you), with a live count and a trailing folder-name chip
since it spans every folder at once. The session still shows in its own folder too; pinning
doesn't move or hide it. Unpin from either place — the strip and the folder row share the
same context menu (`Sidebar.tsx` `TabRow`, now taking an optional `showFolder`/`hue` pair
for cross-folder display). Pin state persists like the rest of the workspace (see
[workspace persistence](workspace-persistence.md)).

## Searching sessions

A search icon button sits in the sidebar header, next to the collapse toggle — the same
jump-to behavior [Ctrl+Shift+P](command-palette.md) already had, now with a visible,
mouse-reachable entry point instead of only a keyboard shortcut. It used to be its own
full-width row below the header; folding it into the header icon row saves a block of
vertical chrome before the folder list starts.

## Reordering (drag & drop)

Both folder groups and sessions can be reordered by dragging (native HTML5 DnD; Tauri's
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
identical-value updates), so the line never flickers. Folder groups use `DropLine`'s
`flush` variant (tucked to the group's own edge); rows let it sit in the `my-0.5` margin
between them.

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

- `src/App.tsx`, `src/components/Sidebar.tsx`, `src/components/Terminal.tsx`,
  `src/components/terminalCache.ts`, `src/components/ui/context-menu.tsx` (tab right-click menu),
  `src/lib/tabs.ts`, `src/lib/utils.ts` (`folderName`, `parentPath`),
  `src/main.tsx` (global contextmenu suppression)
- `src-tauri/src/pty.rs`, `shell.rs`, `claude.rs`, `commands.rs`

## Tests

- `src/lib/tabs.test.ts` — tab state transitions, including `rename`, `pin`, and
  `reorderTab` (same-folder move, no-op guards, cross-folder refusal)
- `src/lib/utils.test.ts` — `parentPath` (nearest-two-ancestors, ellipsis, fewer-than-two,
  root-level, forward-slash paths, custom level count)
- `src/components/Sidebar.test.tsx` — tab rows, per-project shell menu, folder
  expand/collapse, add/remove/spawn via a folder's context menu (collapsed or not),
  multiple simultaneous folders, empty state, sidebar collapse, double-click rename
  (commit/cancel/empty-name-discard), drag-to-reorder folders and sessions (and refusal to
  move a session across folders), the Pinned strip (cross-folder listing, count, exited
  exclusion, pin/unpin via context menu), the header search button, the folder-paths
  breadcrumb (shown by default, hidden via settings), and a working folder's activity tint
- `cargo test shell::` / `claude::` — per-platform shell lists and claude command shape
- `cargo test workspace::` — includes the `pinned` field round-tripping and loading as
  unpinned from a workspace file saved before the field existed

Manual PTY verification checklist: docs/development.md.

See also: [workspace persistence](workspace-persistence.md) for how open tabs survive
an app restart, and [file explorer](file-explorer.md) for `TabBar` — the strip of open
file tabs (plus a single slot for your last-active session) docked above the content pane.
