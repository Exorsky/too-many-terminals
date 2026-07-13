# Too Many Terminals

Lightweight cross-platform (Windows/Linux/macOS) desktop terminal for Claude Code.
Tauri 2 (Rust backend + system webview) + React 19 + Tailwind v4 + xterm.js.

## Documentation

Feature and architecture docs live in `docs/` — **keep them updated when features change**:

- [docs/architecture.md](docs/architecture.md) — process model, IPC design, module boundaries
- [docs/features/terminals.md](docs/features/terminals.md) — sidebar, tabs, PTY spawning per OS
- [docs/features/session-history.md](docs/features/session-history.md) — past-session browsing/resume
- [docs/features/usage-meter.md](docs/features/usage-meter.md) — daily token counter
- [docs/features/workspace-persistence.md](docs/features/workspace-persistence.md) — restoring folder/tabs across restarts
- [docs/features/tab-status-and-naming.md](docs/features/tab-status-and-naming.md) — Claude Code hooks: live status + auto-naming
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
- Rust modules keep Tauri types out of core logic (`pty.rs`, `session_history.rs`, `usage.rs`, `shell.rs` are plain Rust; `commands.rs` is the thin Tauri adapter) so they stay unit-testable.
- New features need tests (vitest for frontend logic/components, cargo test for Rust) and a doc page under `docs/features/`.
