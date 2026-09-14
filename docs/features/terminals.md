# Terminals

> The tab strip described here is now **per pane** — the window can hold up to
> four, each with its own strip and active tab. The app-wide `barTabIds` list is
> gone; a pane's `tabIds` is its strip. See [panes.md](panes.md).


## The session list

Every open session — Claude and shell alike — lives in **one flat list**, sorted by what it's
doing rather than by which folder it came from. There are no folder groups, no accordions and
no nesting: thirteen sessions are thirteen rows.

That's a deliberate reversal. Sessions used to sit inside collapsible per-folder groups, which
cost a header row and a "New session" row per folder before a single session appeared, and
buried a running session three folders down. The flat list trades away per-folder ordering for
the thing the sidebar is actually for: seeing what needs you.

### Order

**Newest first.** `recencyOf()` (`Sidebar.tsx`) dates every row from whichever of three
clocks is freshest, and the list runs descending:

- `createdAt` — when you opened it in this run.
- `statusChangedAt` — its last status change, so a session working right now keeps
  bumping itself to the top.
- the mtime of its transcript (`useLastUsed`), for a session restored from a previous run.

A tab restored at launch deliberately gets **no** `createdAt`: stamping them all with the
same instant would bury the real order, so those fall back to their transcript's date.
`sort` is stable, so rows with no clock at all keep the order you opened them in.

**Pinned still sits above everything.** Pinning is the one explicitly manual thing in a list
that otherwise derives its own order, and a pin that aged out of view would mean nothing.

Status no longer has a ranking tier of its own. It didn't need one: a session that is
waiting on you or working has just changed status, so recency already floats it. What the
old ranking couldn't express was "I just opened this" — a brand-new session sorted below
week-old idle ones because `new` ranked as quiet.

There is no manual ordering to preserve, so dragging a session doesn't do anything;
`tabsReducer`'s `reorderTab` action was removed with the folder groups that gave it meaning.

`segOf()` survives for the row spine and the ledger buckets, mirroring `TabIndicator`'s
[status vocabulary](../design.md#status-vocabulary) one-for-one.

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

## The rail: folders and navigation

The expanded sidebar is **two columns**: a 44px rail, then the 236px list column. Everything
in the rail is something the list can't answer — which folder to look at, where to navigate —
so the column beside it holds only bands that narrow the list, the list itself, and the
[usage meter](usage-meter.md).

Top of the rail, an **All** square carrying the total session count, then one **square per
open folder** (`App.tsx` `projects: string[]`), then a dashed **`+`** that adds a folder.
Below a hairline, the app's destinations: **Home**, **Search sessions**, **History**,
**File explorer**, **Settings**, **Hide sidebar**.

### Why a column and not a row

Folders used to be pills in a row that **wrapped**: 34px of chrome with three folders open,
90px with eight, and the first session pushed further down the screen every time you opened a
project. Vertical space beside the list was empty anyway, so the squares grow into it and the
bands above the list stop moving. The folder area scrolls on its own once it runs out of room;
the navigation under it never does.

A square is 28px, which is room for exactly one thing: the folder's **initial**
(`squareInitial`, the name's own first letter — `one/api` and `two/api` are both "A"). Identity
is carried by the **hue**, as it is everywhere else; the count rides the top-right corner and
the [credentials glyph](env-loading.md) the bottom-left. The name is in the tooltip and the
accessible label.

Clicking a square narrows the list to that folder; clicking it again, or the **All** square,
goes back. Four things answer "which one did I click": the selected square is drawn in the
folder's **own hue** at full strength against the others' 30%, **every other square fades to
35% opacity**, the selected one scrolls itself into view, and the folder's name appears in the
lens line above the list.

The fade is opacity, not a hide, and hover brings a dimmed square straight back to full — the
rail still has to answer "which folders are open" while you're filtered into one of them, and
reaching for a different folder should never mean aiming at something greyed out.

### The name panel

One letter identifies a folder right up until two folders share it. `clients/api` and
`internal/api` are both **A** — the hue tells them apart, the letter doesn't — and the
per-square tooltip is no help there, because it shows one name at a time, which is exactly
what makes two of them impossible to *compare*.

So hovering the folder group opens a panel of **every open folder's full name**, butted
against the rail's right edge: `All folders`, one row per folder, `Add folder…`. It doesn't
move or widen the rail. Rows run at the same 32px pitch as the squares, so row *i* sits
beside square *i* and **the square works as that row's icon** — which is why the panel
repeats neither the hue dot nor the credentials glyph: both are already six pixels to the
left, and saying it twice on one line is noise.

Rows are the same filter the squares are, so the panel is also how you pick a folder by name
when you can't remember its letter. Hovering a row lights its square and vice versa
(`hot` state) — the only thing that teaches the letter-to-name pairing, after which the panel
stops being needed.

**Timing.** Hover waits **300ms**; focus opens it immediately. The rail sits on the way to
the list, so a pointer crossing it hasn't asked for anything — 300ms is the floor
[Baymard measured](https://baymard.com/blog/dropdown-menu-flickering-issue) for hover-opened
content, below which the flicker starts. Moving focus onto a square is already deliberate, so
making the keyboard serve a pointer's grace period would read as broken. Closing has a
**120ms** grace so cutting the corner between two rows doesn't dismiss it.

There is no "safe triangle" and no invisible bridge: the panel is **flush** against the rail
(`left-full`), so the pointer never crosses a gap on its way over, which is the whole of the
diagonal problem those hacks exist to patch.

Everything in the rail shares one 32px rhythm — 28px squares, 4px gaps — because the panel's
rows have to land on them. That replaced a mismatched 6px gap inside the folder column.

`FolderNames` aligns to the rail's **unscrolled** position; the folder column only scrolls
past roughly a dozen open folders, and a `ponytail:` note in the source says to mirror its
`scrollTop` if that ever becomes normal.

### Naming a square

`pillLabel()` shows just the folder name until two open folders share one, at which point
**both** grow their nearest ancestor (`one/api`, `two/api`) and nothing else does. It feeds the
tooltip and the accessible name; `squareInitial` strips that ancestor back off for the glyph.
This replaced the old **Show folder paths** preference: telling two identically-named folders
apart is correctness rather than taste — not something to leave off behind a toggle.

### A folder's context menu

Right-click a square for **New Claude session** / a shell per `ShellOption`, **Open
directory**, **Import session…**, or **Remove folder** (kills its open tabs, no confirmation —
closing tabs isn't destructive, transcripts stay on disk). These live in a context menu rather
than permanent icons so a 44px rail isn't carrying rarely-used actions at all times.

## Starting a session

A **New session** row sits directly above the list, in the list's own rhythm: same width, same
26px height, a dashed border instead of a fill. It's the one control in the panel that
*creates* rather than narrows, which is why it gets a row of its own rather than an icon in a
corner.

The row **names its destination** — "New session · api" — so clicking it is never a guess
about where the session lands. That folder is the one selected in the rail, or the only open
one; with several open and none selected the row says nothing and the menu asks.

Opening it (`NewMenu`):

- A folder is selected (or only one is open) → a flat menu of **Claude** plus each shell,
  landing in that folder.
- Several folders open and none selected → one submenu per folder, each with the same items.
- Always, at the bottom: **Add folder…**, which opens the native picker
  (`@tauri-apps/plugin-dialog`, `ipc.pickFolder`) and appends a new project; picking an
  already-open folder is a no-op.

This is **not** the per-folder "New session" row v0.21 removed. That one cost one row *per open
folder*, forever, to offer something you use a few times a day; this is one row for the whole
list. The rail's dashed **`+`** is a different button doing a different job — it adds a
*folder* — and the two never compete because each sits against the thing it creates.

## Pinning a session

Any session can be pinned from its right-click menu (**Pin session** / **Unpin**,
`Tab.pinned`) so it doesn't need a scroll to reach. A pinned session sorts above everything
else and carries a small `primary` pin glyph on its row; it also gets a **pinned** chip in the
[session ledger](attention-inbox.md), which filters the list to just those. Pin state persists
like the rest of the workspace (see [workspace persistence](workspace-persistence.md)).

## Searching sessions

A **Search sessions** square sits in the rail — the same command palette Ctrl+Shift+P opens
(see [command-palette.md](command-palette.md)). For narrowing the list while you keep looking
at it, use the filter field above the list instead; the palette is modal and closes.

## Reordering folders (drag & drop)

Folder squares can be reordered by dragging (native HTML5 DnD; Tauri's own file-drop handler is
turned off via `dragDropEnabled: false` in `tauri.conf.json` so the webview receives the drag
events). Grab a square, drop it onto another — `App.tsx` `handleReorderProject` splices the
`projects` array, the new order persists with the rest of the workspace, and the squares re-hue
by their new index.

Sessions are **not** draggable: the list derives its own order from status, so there is
nothing to rearrange.

### The drop indicator

The valid drop target renders a `DropLine` — a glowing 2px accent bar (`bg-primary`) sitting
in the gap the square will fall into rather than outlining it (an outline can't say *before* vs
*after*). The rail runs down rather than across, so the line is **horizontal** and the side is
decided by `dropSideY()`: cursor above the square's vertical midpoint → `before`, below →
`after`. That `'before' | 'after'` flows through `onReorderProject` into the array splice —
which is why a drop can land *after* the last square, something a plain insert-before couldn't
reach. Each square stores its own `dropPos` and sets it only when the side changes (React bails
out of identical-value updates), so the line never flickers.

## Sidebar collapse

Collapsing (`PanelLeftClose`/`PanelLeftOpen` toggle, `App.tsx` `collapsed` state) drops the
list column and leaves a 44px rail: sessions as icon-only buttons (flat across all projects),
under a stacked copy of the [ledger counts](attention-inbox.md#collapsed-rail). That rail is
still its own component rather than the expanded one narrowed — it shows *sessions* where the
expanded rail shows folders — so it carries its own Home / Search / History / Files / Add
folder / Settings squares. The width transition rides a single shared root element
(`transition-[width]`); swapping between two early-return roots would remount instead of
animating.

### What the collapsed rail shows

**The same list, narrowed the same way.** The rail reads `visible` — the folder
filter, the status chip and the query already applied, ordered by recency —
not the raw `sessions` array. It used to read the raw one, which meant folding
the sidebar away silently dropped whatever filter you had set and reshuffled
what was left back into the order the tabs happened to be opened in. Collapsing
narrows the sidebar; it does not hand you a different one.

**Minus the sleepers.** `railWorthy()` leaves out **auto-slept** sessions and
nothing else. At 44px a session is one status glyph — no name, no folder, no
time — so a column of them reads as a bar chart with no labels, and a dormant
session is the one kind guaranteed to have nothing to report: its process is
freed and it is waiting to be resumed. Shells keep their square (no Claude
status, but perfectly capable of running a build), and so do **exited**
sessions: the process is gone, its scrollback isn't, and reading what a command
printed before it died is a normal reason to click one. The session you're
looking at is always kept, asleep or not.

**Told apart by hue.** Two sessions of the same status are otherwise identical
squares, so each carries its folder's hue as a background tint while the glyph
goes on saying the status — the same two-channel split the
[name panel](#the-name-panel) uses, and no new colors.

**The toggle itself doesn't move.** It is the **first** square in both rails, 6px from the
top, so collapse and expand happen under the cursor. It briefly didn't: the collapsed rail
kept its toggle in a header at the top while the expanded rail kept it at the foot, which
threw the button the full height of the sidebar on every click and made you go find it again.
Which end it lives at is taste; that both ends agree is not.

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
  `NewMenu`, `TabRow`/`RowMeta`, `recencyOf`/`segOf`, `useLastUsed`, `pillLabel`),
  `src/components/SidebarFooter.tsx` (app navigation), `src/components/Terminal.tsx`,
  `src/components/terminalCache.ts`, `src/components/ui/context-menu.tsx` (tab right-click menu),
  `src/lib/tabs.ts`, `src/lib/utils.ts` (`folderName`, `parentPath`),
  `src/main.tsx` (global contextmenu suppression)
- `src-tauri/src/pty.rs`, `shell.rs`, `claude.rs`, `commands.rs`

## Tests

- `src/lib/tabs.test.ts` — tab state transitions, including `rename` and `pin`
- `src/lib/utils.test.ts` — `parentPath` (nearest-two-ancestors, ellipsis, fewer-than-two,
  root-level, forward-slash paths, custom level count)
- `src/components/Sidebar.test.tsx` — session rows and the flat list's order (newest
  first whatever each session is doing, a just-opened session above an older idle one,
  pinned kept on top however stale, stable when nothing has a clock yet), the two-line row (folder on its own line, second line dropped when
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
