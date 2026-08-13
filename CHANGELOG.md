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
- **A calendar of when you worked.** Session History now opens with a three-month
  grid above the list: one square per day, filled by how many sessions ran that
  day and tinted with the colour of the folder that ran most of them. Click a day
  to see only that day's sessions, click again (or the date chip, or Esc) to clear
  it; `c` hides and shows the grid. Hovering a day reads out its date, session
  count and folders.

- **Find in the transcript reader** — press Ctrl/Cmd+F in the Preview pane or the
  Session History reader to search the rendered (or raw) transcript. Every match
  is highlighted, the active one accented, with an `n/total` count; Enter jumps
  to the next match, Shift+Enter the previous, Esc closes.

### Changed
- **Home's cadence is now that same calendar** instead of a strip of day columns,
  so weekdays line up and month boundaries are visible — with the day's tokens in
  the hover readout. The time range switch now sets how many months are drawn.

### Fixed
- **Session names now survive closing a tab.** History read names off the open
  tabs, so closing a session stripped its title and left a row of raw preview
  text you couldn't match to the session you meant — the transcript was never
  lost, but you couldn't tell which row to resume. Names are now kept per
  session id in the workspace file, so History and the sidebar always call a
  session the same thing.
- **Resuming a session keeps its name** instead of renaming the tab after the
  transcript's opening line, which was the other half of the same mismatch.
- **Scrolling in a down-split** — the transcript half of a top/bottom split
  wouldn't scroll; it now scrolls like the side-by-side split does.

## [0.18.0] - 2026-08-13

### Changed
- **Home is now a metrics dashboard** instead of the night-skyline session
  picker. The idle screen reads your own Claude Code history — sessions, turns,
  tokens and cache-hit rate up top; a per-day **cadence** of every session
  tinted by its folder; **top shell commands**, sessions per folder, your
  daily rhythm and streaks, session depth and model split; plus the live 5h/7d
  rate-limit gauges. A **7 days / 30 days / All** switch rescopes everything.
  All of it is read locally from the transcripts Claude Code already writes —
  offline, nothing uploaded.

### Added
- A live session's tab context menu now has **Open in VS Code**, handing it
  off to the native Claude Code VS Code extension — both tools read the same
  transcript file, so there's nothing to migrate.
- A folder's right-click menu can now spawn a **New Claude session** or shell
  directly, whether the folder is expanded or collapsed — previously the
  "New session" menu only rendered in the expanded body.
- A `requires_response` row now shows how long it's been waiting ("5m",
  "2h"), on the row itself and in the Waiting-on-you strip.
- A `working` row now shows a second line underneath it with what Claude is
  actually doing ("editing Sidebar.tsx", "running pnpm test"), read from the
  PreToolUse hook's own tool call — the target is highlighted, the verb
  stays muted.
- A folder with a live session inside it gets a soft activity tint (amber for
  working, orange for needs-you) whether expanded or collapsed; collapsed, it
  also gets a small status glyph next to the chevron, since collapsing a
  folder otherwise hides every child row's own status dot. A folder just
  holding the currently-selected tab gets the same tint treatment, neutrally,
  when nothing else is happening in it.
- The collapsed sidebar rail's expand button now carries a count badge when
  sessions are waiting on you.
- A new **"Just finished"** strip lists Claude sessions that just went from
  working to idle and haven't been looked at yet — selecting one (or it going
  back to work) clears it.
- Interrupting a Claude session (Escape/Ctrl+C) now flips it to "waiting on
  you" instead of leaving it stuck on "working" forever — Claude Code's Stop
  hook doesn't fire on a user interrupt, so the app now notices the
  keystroke itself instead.

### Changed
- The **Files** panel toggle moved out of the sidebar's "⋯" (History/Settings)
  menu into its own always-visible header button, next to Search — unlike
  History/Settings it's a workspace-wide panel that's open by default, not an
  occasional detour.
- Sidebar decluttered: **Search sessions** folded into a header icon button
  (was its own full-width row), and a folder's **Remove folder** action moved
  from a hover icon into its right-click menu, next to how every other rare
  per-item action already works.
- A folder's header now leads with a neutral `Folder` glyph instead of its
  colored hue dot — the name already identifies the folder, so the dot was
  decoration there. The hue still marks a folder in the Pinned/Attention
  strips' cross-folder chips, where it disambiguates a mixed list.

### Fixed
- A folder's name in the sidebar could get truncated before its breadcrumb
  path did, or vice versa, since neither had a defined shrink priority — the
  name now always renders in full and the (already-secondary) breadcrumb
  yields space first.
- The folder breadcrumb now shows only the one ancestor nearest the project
  ("…/prog/vps") instead of two ("Desktop /prog/vps") — the nearer one is
  the useful one for telling folders apart, and showing just it means the
  breadcrumb is short enough to not need mid-path truncation at all.

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

[Unreleased]: https://github.com/Exorsky/too-many-terminals/compare/v0.18.0...HEAD
[0.18.0]: https://github.com/Exorsky/too-many-terminals/compare/v0.17.0...v0.18.0
[0.17.0]: https://github.com/Exorsky/too-many-terminals/compare/v0.16.1...v0.17.0
[0.16.1]: https://github.com/Exorsky/too-many-terminals/compare/v0.16.0...v0.16.1
[0.16.0]: https://github.com/Exorsky/too-many-terminals/compare/v0.15.0...5054537
