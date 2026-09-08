# Too Many Terminals

Working with [Claude Code](https://claude.com/claude-code) usually means juggling a
pile of terminal windows — one per project, one per session, and no easy way to tell
which one is waiting on you. **Too Many Terminals puts all of them in one place.**

Open several folders side by side, spawn Claude and native shells in tabs, and see at
a glance which sessions are working, done, or blocked on your input.

Lightweight and cross-platform — built with Tauri 2, so the builds are small native
binaries (~10–25 MB) for Windows, macOS and Linux.

## Preview

<video src="https://raw.githubusercontent.com/Exorsky/too-many-terminals/main/docs/media/preview.mp4" controls muted loop playsinline width="900"></video>

▶ [Watch the preview](docs/media/preview.mp4) — sessions and their live status, the
rendered transcript beside the terminal, and Markdown preview with mermaid.

## Features

- **Multi-project rail** — every open folder is a colored square in a 44px rail; the
  session list beside it holds Claude tabs and native OS shells
  (Windows: PowerShell/CMD · macOS: Zsh/Bash · Linux: Bash/Zsh/Fish)
- **Live tab status & auto-naming** — see whether Claude is working, done, or waiting
  on you, with a "what it's doing right now" label; tabs title themselves from your
  first message
- **Session ledger** — live counts for *waiting on you*, *running*, *just finished* and
  *pinned*; click one to filter the list
- **Desktop notifications** — get pinged when an unfocused session needs you or finishes
- **Read a session instead of scrolling it** — any Claude tab renders its transcript as
  a document, full-pane or split beside the live terminal, following along as it answers
- **Markdown preview** — mermaid diagrams, links that open the file they name, anchors,
  a find bar and per-block copy buttons
- **File explorer & editor** — docked to the right edge or peeked over the terminal;
  open files stay in step with what your sessions write to disk
- **Home dashboard** — an idle-screen logbook built from your own session history:
  sessions per day, top commands, hours, models, streaks
- **Session history** — browse and resume past Claude Code sessions across every open folder
- **Export / import a session** — hand a live shift to another machine as a single file
- **Open in VS Code** — hand a session to the Claude Code extension mid-conversation
- **`.env` loading** — a folder's `.env` reaches the session at spawn, so secrets never
  have to be pasted into the conversation
- **Usage meter** — the official 5-hour and 7-day rate-limit windows, with reset countdowns
- **Auto-sleep** — an idle, off-screen session's process is stopped and resumed on return
- **Command palette** — `Ctrl+Shift+P` to fuzzy-jump to any open terminal
- **Workspace persistence** — your open folders and tabs are restored on next launch
- **Themes** — presets plus a custom theme editor

## Development

```sh
pnpm install
pnpm tauri dev
```

Tests: `pnpm test` (frontend) · `pnpm test:rust` (backend).
Release build: `pnpm tauri build`.

Docs live in [docs/](docs/) — start with [architecture](docs/architecture.md).
