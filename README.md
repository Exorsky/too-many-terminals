# Claude Terminal

Lightweight cross-platform desktop terminal for [Claude Code](https://claude.com/claude-code).
Built with Tauri 2 — small native builds (~10–25 MB) for Windows, macOS and Linux.

## Features

- **Sidebar sessions** — open Claude tabs and native OS shells side by side
  (Windows: PowerShell/CMD · macOS: Zsh/Bash · Linux: Bash/Zsh/Fish)
- **Session history** — browse and resume past Claude Code sessions
- **Usage meter** — today's token consumption per model

## Development

```sh
pnpm install
pnpm tauri dev
```

Tests: `pnpm test` (frontend) · `pnpm test:rust` (backend).
Release build: `pnpm tauri build`.

Docs live in [docs/](docs/) — start with [architecture](docs/architecture.md).
