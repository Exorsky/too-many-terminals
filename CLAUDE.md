# Too Many Terminals

Lightweight cross-platform (Windows/Linux/macOS) desktop terminal for Claude Code.
Tauri 2 (Rust backend + system webview) + React 19 + Tailwind v4 + xterm.js.

## Documentation

Feature and architecture docs live in `docs/` — **keep them updated when features change**:

- [docs/architecture.md](docs/architecture.md) — process model, IPC design, module boundaries
- [docs/design.md](docs/design.md) — visual/interaction design system: color and type
  vocabulary, shape rules, the status vocabulary, and when to reach for a tab strip vs. a
  left rail vs. a menu vs. a context menu
- [docs/features/terminals.md](docs/features/terminals.md) — sidebar (folders, pinning, drag-reorder), tabs, PTY spawning per OS
- [docs/features/file-explorer.md](docs/features/file-explorer.md) — file tree + CodeMirror editor docked to the right edge
- [docs/features/home-screen.md](docs/features/home-screen.md) — idle Home: a skyline built from your session history
- [docs/features/attention-inbox.md](docs/features/attention-inbox.md) — "Waiting on you" strip: sessions blocked on you
- [docs/features/command-palette.md](docs/features/command-palette.md) — Ctrl+Shift+P fuzzy jump to any open terminal
- [docs/features/notifications.md](docs/features/notifications.md) — desktop notifications when an unfocused session needs you
- [docs/features/session-history.md](docs/features/session-history.md) — past-session browsing/resume
- [docs/features/session-reader.md](docs/features/session-reader.md) — reading a past session as rendered Markdown
- [docs/features/usage-meter.md](docs/features/usage-meter.md) — official 5h/7d rate-limit percentages
- [docs/features/workspace-persistence.md](docs/features/workspace-persistence.md) — restoring folder/tabs across restarts
- [docs/features/tab-status-and-naming.md](docs/features/tab-status-and-naming.md) — Claude Code hooks: live status + auto-naming
- [docs/features/settings.md](docs/features/settings.md) — Settings view (left-rail categories: Interface/Notifications/Sessions/Customize)
- [docs/features/themes.md](docs/features/themes.md) — theme presets + custom theme editor
- [docs/development.md](docs/development.md) — dev/test/build commands, release process

## Commands

- `pnpm tauri dev` — run the app in dev mode
- `pnpm test` — frontend tests (vitest)
- `pnpm test:rust` — Rust tests (cargo test)
- `pnpm tauri build` — release bundles

## Conventions

- **Conventional commits** (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, `build:`); scope by area (`pty`, `ui`, `tabs`, `history`, `usage`).
- **SemVer** `Major.Minor.Patch`. The version source of truth is `src-tauri/tauri.conf.json`; keep `package.json` and `src-tauri/Cargo.toml` in sync when bumping (see docs/development.md).
- All frontend↔backend calls go through `src/lib/ipc.ts` — never import `@tauri-apps/api` elsewhere. Tests mock this one module.
- Rust modules keep Tauri types out of core logic (`pty.rs`, `session_history.rs`, `session_usage.rs`, `shell.rs` are plain Rust; `commands.rs` is the thin Tauri adapter) so they stay unit-testable.
- New features need tests (vitest for frontend logic/components, cargo test for Rust) and a doc page under `docs/features/`.
