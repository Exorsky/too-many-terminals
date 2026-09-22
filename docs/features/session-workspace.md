# The session workspace

> **Session > Claude / Shell / Files.**
> Not `tab = session`. That distinction is what the whole layout turns on.

The Sessions view is two areas: the [sidebar](terminals.md) and this. The selected
session fills the workspace, and the terminal fills almost all of that.

```
┌─ sidebar ────────┬─ workspace ──────────────────────────────┬─ inspector ─┐
│                  │ ● Analyze 429 errors        ↗1 task  ⋯ ▣ │  (closed    │
│                  │ Inbox · ~/.tmt/scratch/7f3a              │   by        │
│                  ├──────────────────────────────────────────┤   default)  │
│                  │ Claude   Shell   Files                   │             │
│                  ├──────────────────────────────────────────┤             │
│                  │                                          │             │
│                  │              T E R M I N A L             │             │
│                  │                                          │             │
└──────────────────┴──────────────────────────────────────────┴─────────────┘
```

## Header

Two rows, ~56px, and nothing else goes in it:

- **Row 1** — one status dot, the session's name, and on the right: the linked-task
  count if there is one, ⋯, and the inspector toggle.
- **Row 2** — where it's filed ("Inbox" or the project name) and the real working
  directory.

Everything else you might want to know about a session is in the inspector, and
everything else you might want to *do* to it is in ⋯. The space they would have
taken belongs to the terminal.

The status dot appears **once** here and **once** on the sidebar row, and both read
the same `sessionState` from `lib/sessions.ts`. See [design.md](../design.md).

## Tools

`Claude`, `Shell`, `Files` — the tools belonging to *this* session. A shell session
has no Claude tool, because there is no Claude process to show.

| Tool | What it is |
|---|---|
| **Claude** | the session's `claude` pty, plus the Preview/Split transcript controls |
| **Shell** | a second pty in the same `cwd`, spawned on first visit |
| **Files** | the session's own directory: tree on the left, editor on the right |

### The shell tool is not a session

Its pty id is derived (`<sessionId>::shell`), so there is no second record to keep
in sync: no row in the sidebar, no status, no history, nothing to restore. Closing
the session kills a shell that can be named without looking anything up, and a
restart simply gives you a fresh one on first click — a shell has no state worth
persisting.

### Nothing is unmounted on a tool switch

All three tools stay mounted; the inactive ones are `visibility: hidden`. Dropping
a terminal from the tree would take its xterm buffer with it and re-wrap the entire
scrollback on the way back. The same rule holds across session switches: the
workspace component is reused rather than keyed, so switching sessions doesn't
re-read the file tree or remount the transcript.

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

⌘⇧F. Hides the top nav, the sidebar and the inspector, and shrinks the header to a
32px line carrying the status dot and the session name. Escape leaves (unless the
terminal has focus, where Escape belongs to Claude Code as an interrupt).

What's left is the session's identity and its terminal, which is the point.

## What this replaced

Before v0.25 the same list of sessions appeared in three persistent places at once:
a project icon rail, the sidebar list, and a tab strip above every pane. Opening a
session put it in a *fourth*. See [panes.md](panes.md) for the pane grid that went
with it, and [../design.md](../design.md) for the rule it broke.
