# Claude Terminal

Lightweight cross-platform desktop terminal for [Claude Code](https://claude.com/claude-code).
Built with Tauri 2 — small native builds (~10–25 MB) for Windows, macOS and Linux.

## Features

- **Multi-project sidebar** — open several folders at once, each its own card with
  Claude tabs and native OS shells (Windows: PowerShell/CMD · macOS: Zsh/Bash · Linux: Bash/Zsh/Fish)
- **Live tab status & auto-naming** — see at a glance whether Claude is working, done,
  or waiting on you; tabs title themselves from your first message
- **Session history** — browse and resume past Claude Code sessions across every open folder
- **Usage meter** — today's token consumption per model
- **Workspace persistence** — open folders and tabs continue where you left off next launch

## Development

```sh
pnpm install
pnpm tauri dev
```

Tests: `pnpm test` (frontend) · `pnpm test:rust` (backend).
Release build: `pnpm tauri build`.

Docs live in [docs/](docs/) — start with [architecture](docs/architecture.md).
