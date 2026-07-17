# Too Many Terminals

Working with [Claude Code](https://claude.com/claude-code) usually means juggling a
pile of terminal windows — one per project, one per session, and no easy way to tell
which one is waiting on you. **Too Many Terminals puts all of them in one place.**

Open several folders side by side, spawn Claude and native shells in tabs, and see at
a glance which sessions are working, done, or blocked on your input.

Lightweight and cross-platform — built with Tauri 2, so the builds are small native
binaries (~10–25 MB) for Windows, macOS and Linux.

<!-- 🎥 Preview video goes here -->

## Features

- **Multi-project sidebar** — open several folders at once, each its own card with
  Claude tabs and native OS shells (Windows: PowerShell/CMD · macOS: Zsh/Bash · Linux: Bash/Zsh/Fish)
- **Live tab status & auto-naming** — see whether Claude is working, done, or waiting
  on you; tabs title themselves from your first message
- **"Waiting on you" inbox** — a strip that surfaces every session blocked on your input
- **Command palette** — `Ctrl+Shift+P` to fuzzy-jump to any open terminal
- **Desktop notifications** — get pinged when an unfocused session needs you
- **Session history** — browse and resume past Claude Code sessions across every open folder
- **Usage meter** — today's token consumption per model
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
