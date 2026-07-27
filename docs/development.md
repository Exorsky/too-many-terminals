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

A dev run titles its window **Too Many Terminals (Dev)** (`cfg!(debug_assertions)`
in `lib.rs`'s setup hook), so it is never confused with an installed build
running beside it.

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
3. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z` — this triggers
   `.github/workflows/release.yml` (see below), or build locally with
   `pnpm tauri build` (bundles land in `src-tauri/target/release/bundle/`).

Bump rules: breaking behavior/config changes → major; new features → minor;
fixes/docs/internal → patch.

## CI/CD

- `.github/workflows/ci.yml` — runs on every push to `main` and on pull requests:
  typecheck + frontend build (`pnpm build`), `pnpm test`, `pnpm test:rust`.
- `.github/workflows/release.yml` — runs when a `vX.Y.Z` tag is pushed (or manually via
  "Run workflow"). Builds installers for macOS (Apple Silicon + Intel, as separate
  matrix jobs), Linux, and Windows using `tauri-apps/tauri-action`, then creates a
  **draft** GitHub release with all bundles attached — review and publish it manually
  from the GitHub UI.
  - When triggered manually via "Run workflow", the `tag` job first creates and pushes
    the `vX.Y.Z` tag (from `tauri.conf.json`) so the tag ref exists *before* you publish
    the draft. This is deliberate: a GitHub draft release only creates its git tag when
    published, so without the up-front tag, publishing the draft would fire `push:tags`
    and trigger a **second, duplicate** release. (Pushing the tag with the built-in
    `GITHUB_TOKEN` does not re-trigger the workflow, so the manual run isn't doubled.)
- Builds are **unsigned**: macOS `.dmg` triggers Gatekeeper (right-click → Open on
  first launch), Windows `.exe`/`.msi` triggers SmartScreen ("More info" → "Run
  anyway"). No code-signing certificates are configured since this is a personal app.
