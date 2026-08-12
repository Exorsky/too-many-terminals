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
- Session bar replaced by two controls docked to the tab strip: a Markdown
  Preview toggle and a Split menu (right/down), instead of one three-way
  Terminal/Split/Markdown switch. Markdown's own controls (Rendered/Raw,
  copy, refresh) moved onto the markdown pane itself.

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

[Unreleased]: https://github.com/Exorsky/too-many-terminals/compare/v0.16.1...HEAD
[0.16.1]: https://github.com/Exorsky/too-many-terminals/compare/v0.16.0...v0.16.1
[0.16.0]: https://github.com/Exorsky/too-many-terminals/compare/v0.15.0...5054537
