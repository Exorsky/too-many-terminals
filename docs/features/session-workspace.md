# The session workspace

> **A tab is a session; its splits live inside it.**
> The model every terminal teaches — iTerm2, Ghostty, Warp: a window has tabs,
> a tab has panes.

```
┌─ title bar ── infra › [PROJ-4821] Fix alert noise ─────── Session ▬ 42%  Week ▬ 18% ┐
├─ sidebar ───────┬─ + │ ● Fix alert noise [2] × │ ● VPN drops │ …     ⫴▾ 🗎 │ ⋯ ▣ ┤
│ ⌘K Search…      ├──────────────────────────────┬─────────────────────────────────┤
│ Sessions    14  │ Claude                     × │ Shell                         × │
│ To-Do        4  │                              │                                 │
│ Library         │        T E R M I N A L       │          S H E L L              │
│ Settings    ⌘,  │                              │                                 │
│ + New session   │                              │                                 │
│ Now / Today / … │                              │                                 │
└─────────────────┴──────────────────────────────┴─────────────────────────────────┘
```

## Tabs and splits

`TabsState` (`src/lib/tabs.ts`) holds `open` — the session ids on the strip,
in order — `current`, and `layouts`: **one pane grid per open session**.
Switching tabs swaps the whole grid; switching back brings its splits back.

- **New tabs land at the left edge** by default, beside the `+` that made them,
  so the strip reads newest → oldest like the sidebar's Today and ⌘1 is always
  the one you just opened. *Settings › Interface › New tabs open* switches to
  "after the current tab", which is what most terminals do: newest-left shifts
  every other tab's position and ⌘-number on each open, and that trade-off is
  the user's to make.
- **Clicking a session that's already a tab** focuses it where it is. Moving it
  would shuffle the strip under the pointer.
- **Closing a tab** (×, or middle-click) takes it off the strip. The session
  keeps running in the sidebar; closing *the session* is still ⋯ › Close.
- **One Split menu** at the strip's trailing end puts things beside the
  terminal: *Shell to the right* / *Shell below* (⌘D / ⌘⇧D on macOS,
  Ctrl+Shift+D / Ctrl+Shift+Alt+D elsewhere — Ctrl+D is EOF) and the
  transcript to the right or below. Files aren't in it: the file explorer
  peeks in from the window's right edge. It replaced five look-alike icons, two of
  them the same "columns" glyph meaning different things. **Preview** stays a
  toggle beside it — it swaps the terminal for the transcript rather than
  adding anything. A shell split opens a **new shell** in the session's cwd
  beside the focused pane. Each split is its
  own pty, numbered (`<id>::shell:1`, `:2`…; `nextShellNumber`), so a second
  split is a second shell, never the first one moved.
- **Closing a split's shell kills that shell** — closing a split in any terminal
  does. Closing Claude, Files or another session's pane only takes it off the
  screen. A tab whose last pane closes leaves the strip.
- **A lone pane has no header** — the tab above already names it. Once a tab is
  split, each pane gets a 28px header naming its tool ("Claude", "Shell 2") or,
  for another session placed beside this one, that session.
- **Another session beside this one** ("compare"): ⋯ › *Open beside current* on
  a sidebar row, or drag the row onto a pane's edge.
- **A file** opened from the explorer joins a pane already showing a file, else
  splits off the focused pane. With no tab open it opens on Home.

Up to four panes per tab; a fifth split degrades to a tab in the focused pane
rather than an error (`splitPane`). The pane algebra in `lib/panes.ts` is the
v0.24 one — only *where* the layout lives changed. Layouts aren't persisted;
open tabs start empty after a restart, like before.

## What stays on screen

Only the current tab's grid renders. A terminal's xterm lives in
`terminalCache` outside React, so unmounting a background tab's panes doesn't
cost its scrollback; it re-attaches on the way back. Auto-sleep and
notifications treat the sessions painted in the current grid as "on screen".

## Shortcuts

| Keys (macOS) | Does |
|---|---|
| ⌘N | New session (dialog; ⌘N again starts Claude) |
| ⌘D / ⌘⇧D | Split right / down with a new shell |
| ⌘1…⌘9 | Go to tab by position |
| ⌘⇧U | Jump to the session that most recently started waiting on you |
| ⌘I | Inspector |
| ⌘, | Settings |
| ⌘B | Fold the sidebar to the rail |
| ⌘⇧F | Focus mode |

## Inspector

**Closed by default**, ⌘I or the ▣ button to open, and the terminal expands back
the moment it closes. Metadata does not get to hold a 280px column permanently in
an app whose point is the terminal.

It carries the session title (editable — this is where you come when the auto-namer
got it wrong), state, project, working directory, created/last-used, the Claude
session id, any linked To-Dos, and the infrequent actions: Move to project, Create
To-Do, Open directory, Open in VS Code, Export, Archive, Close.

The task inspector in [To-Do](todo.md) is the same panel in a different mode — same
width, same field rows, same "closed until asked".

## Focus mode

⌘⇧F. Hides the title bar, the sidebar and the inspector; the session tab strip
stays, without its trailing controls, because it is what still says which session
you are in. Escape leaves (unless the
terminal has focus, where Escape belongs to Claude Code as an interrupt).

What's left is the session's identity and its terminal, which is the point.

## What this replaced

Before v0.25 the same list of sessions appeared in three persistent places at once:
a project icon rail, the sidebar list, and a tab strip above every pane. Opening a
session put it in a *fourth*. See [panes.md](panes.md) for the pane grid that went
with it, and [../design.md](../design.md) for the rule it broke.
