# Development

## Prerequisites

- Node 20+, pnpm 10+, Rust stable (1.80+)
- Linux additionally: `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`
  (standard Tauri 2 deps)

## Commands

| Command | What |
| --- | --- |
| `pnpm install` | install frontend deps |
| `pnpm tauri dev` | run the app (vite + cargo, hot reload) |
| `pnpm test` | vitest (frontend) |
| `pnpm test:rust` | cargo test (backend) |
| `pnpm build` | typecheck + vite build only |
| `pnpm tauri build` | release bundles (NSIS on Windows, dmg/app on macOS, deb/appimage on Linux) |

## Manual PTY verification checklist

Automated tests cover logic, not real ptys. After touching `pty.rs`/`Terminal.tsx`, verify
per OS with `pnpm tauri dev`:

1. Open a Claude tab — the TUI renders and accepts input.
2. Open each OS shell — prompt appears, commands echo.
3. Resize the window — the shell/TUI reflows (no wrapped garbage).
4. Flood output (`yes` or `dir /s`) — UI stays responsive; Ctrl+C stops it.
5. Close a tab — the process tree actually dies (check Task Manager / `ps`).
6. Quit the app with tabs open — no orphan shells remain.
7. History → resume a session — Claude opens with prior context.

## Release process (SemVer)

Version source of truth: `src-tauri/tauri.conf.json` → `version`.

1. Bump the version in **three** files: `src-tauri/tauri.conf.json`, `package.json`,
   `src-tauri/Cargo.toml` (keep them identical).
2. Commit: `chore(release): vX.Y.Z`
3. Tag: `git tag vX.Y.Z`
4. Build per platform: `pnpm tauri build` (bundles land in
   `src-tauri/target/release/bundle/`).

Bump rules: breaking behavior/config changes → major; new features → minor;
fixes/docs/internal → patch.
