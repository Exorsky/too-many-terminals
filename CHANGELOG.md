# Changelog

All notable changes to Too Many Terminals are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [SemVer](https://semver.org/). Entries land under
`[Unreleased]` as user-facing commits are made (see docs/development.md) —
cutting a release retitles that section with the version and date. Internal
changes (`chore`, `docs`, `test`, `build`, non-user-visible refactors) aren't
listed here; see `git log` for the full history.

## [Unreleased]

### Added
- A live session's tab context menu now has **Open in VS Code**, handing it
  off to the native Claude Code VS Code extension — both tools read the same
  transcript file, so there's nothing to migrate.

## [0.17.0] - 2026-08-12

### Added
- Session bar replaced by two controls docked to the tab strip: a Markdown
  Preview toggle and a Split menu (right/down), instead of one three-way
  Terminal/Split/Markdown switch. Markdown's own controls (Rendered/Raw,
  copy, refresh) moved onto the markdown pane itself.
- The sidebar shows up to two parent folders before each project's name
  (e.g. `Desktop / prog / too-many-terminals`), so folders that share a name
  stay easy to tell apart at a glance. Toggle with **Show folder paths** in
  Settings → Interface (on by default).

### Fixed
- Markdown links in the transcript reader now open in the default browser
  instead of navigating the app's own window.

## [0.16.1] - 2026-08-04

### Fixed
- A folder's file listing now re-fetches when you collapse and re-expand it,
  instead of showing a stale snapshot.

## [0.16.0] - 2026-08-04

### Added
- The transcript reader now renders pipe tables, nested/checkbox lists,
  italics, autolinks, and horizontal rules.

[Unreleased]: https://github.com/Exorsky/too-many-terminals/compare/v0.17.0...HEAD
[0.17.0]: https://github.com/Exorsky/too-many-terminals/compare/v0.16.1...v0.17.0
[0.16.1]: https://github.com/Exorsky/too-many-terminals/compare/v0.16.0...v0.16.1
[0.16.0]: https://github.com/Exorsky/too-many-terminals/compare/v0.15.0...5054537
