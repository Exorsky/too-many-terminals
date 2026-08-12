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

## Changelog

`CHANGELOG.md` (repo root, [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
format) is kept current as work lands, not reconstructed at release time:

- Every user-facing `feat`/`fix` commit adds a line under `## [Unreleased]`
  (`### Added` for a `feat`, `### Fixed` for a `fix`, `### Changed` for a
  behavior change to something that already existed). Internal-only commits
  (`chore`, `docs`, `test`, `build`, refactors with no user-visible effect)
  don't get an entry.
- If `[Unreleased]` was ever allowed to fall behind, rebuild it before
  cutting a release from the commits since the last version tag:
  `git log vX.Y.Z..HEAD --oneline --no-merges`, grouped the same way.

## Release process (SemVer)

Version source of truth: `src-tauri/tauri.conf.json` → `version`.

1. Retitle `CHANGELOG.md`'s `## [Unreleased]` heading to `## [X.Y.Z] - YYYY-MM-DD`
   (today's date), then add a fresh empty `## [Unreleased]` section above it.
   Add the compare-link reference at the bottom of the file
   (`[X.Y.Z]: .../compare/vPREV...vX.Y.Z`).
2. Bump the version in **three** files: `src-tauri/tauri.conf.json`, `package.json`,
   `src-tauri/Cargo.toml` (keep them identical).
3. Commit: `chore(release): vX.Y.Z`
4. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z` — this triggers
   `.github/workflows/release.yml` (see below), which pulls step 1's
   `CHANGELOG.md` section into the draft release body automatically. Or build
   locally with `pnpm tauri build` (bundles land in
   `src-tauri/target/release/bundle/`), which has no changelog step of its own.

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
  - The `changelog` job reads the version straight from `tauri.conf.json` and pulls the
    matching `## [X.Y.Z]` section out of `CHANGELOG.md` (a plain `index()`-based `awk`
    scan, stopping at the next `## [` heading or the reference-links block at the bottom
    — no regex, so the brackets in `[X.Y.Z]` can't be misread as one), then feeds it to
    `tauri-action` as `releaseBody`. Relies on step 1 of the release process above having
    already retitled `[Unreleased]` to this version *before* the tag is pushed — an
    unretitled `CHANGELOG.md` just produces an empty release body, same as before this
    job existed.
- Builds are **unsigned**: macOS `.dmg` triggers Gatekeeper (right-click → Open on
  first launch), Windows `.exe`/`.msi` triggers SmartScreen ("More info" → "Run
  anyway"). No code-signing certificates are configured since this is a personal app.
