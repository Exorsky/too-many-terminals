# Changelog

All notable changes to Too Many Terminals are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [SemVer](https://semver.org/). Entries land under
`[Unreleased]` as user-facing commits are made (see docs/development.md) —
cutting a release retitles that section with the version and date. Internal
changes (`chore`, `docs`, `test`, `build`, non-user-visible refactors) aren't
listed here; see `git log` for the full history.

## [Unreleased]

## [0.25.0] - 2026-09-22

### Added

- **Sessions are organised, not just listed.** The tab strip is gone. Sessions
  live in a sidebar under **Inbox** (anything unfiled) and **Projects**, each
  with its own status dot and age, and the workspace shows one session's tools —
  Claude, Shell, Files — laid out on the pane grid. Selecting a session opens an
  inspector on the right rather than a row of buttons on every row.
- **Scratch sessions.** ⌘N starts a session immediately in a temporary
  directory, with no folder to choose first; file it into a project later, or
  never.
- **To-Do**, the app's second mode. A plain developer to-do list stored beside
  your workspace: due dates, projects, tags, priority. It knows about Claude —
  a task can start a session or be handed to a running one — but those live in
  the ⋯ menu, because most of a real list is not work for Claude.
- **A Completed filter in To-Do.** Finished tasks were written out of every
  view — the `Done` group existed but nothing could reach it — so ticking one
  off made it vanish. They now collect under **Completed**, most recently
  finished first.
- **Search inside your past sessions.** The history panel's search box now reads
  the full text of every transcript on disk, not just each session's first
  message, and covers every project rather than only the folders you have open —
  a hit from a project you closed months ago is carried into the list with the
  matching text and a count. Matching happens in Rust and takes about half a
  second over a couple of hundred megabytes, with a `Searching transcripts…`
  status row while it runs.

### Changed

- **The interface has a second typeface.** Chrome moved to the system sans;
  the terminal — and anything that lines up in a column, so timestamps, counts,
  durations, paths and key hints — stays monospace. Making the terminal the only
  monospaced surface is what marks it as the content. Nothing about terminal
  rendering changed.
- **A new default palette.** Darker ground (`#0a0a0c`), violet accent
  (`#8b7df7`). The blue palette the app shipped with through 0.24 is still
  there as the **Classic blue** preset in Settings → Customize, and any theme
  you made yourself is untouched.
- **On macOS the mode row is now the title bar.** Sessions/To-Do sit centred in
  it, with the sidebar toggle on the left and ⌘K on the right, so the window
  spends one 32px row on chrome instead of two. The traffic lights stay native.
  Windows and Linux keep their normal window frame.
- **The chrome reads as three tiers instead of one.** Session and task names now
  sit a step above their own timestamps, counts and status text, so a long list
  scans by name rather than as a wall of equal-weight text. The row states that
  carry selection and hover were fourteen slightly different shades of white
  across the app; they're four now, shared by every row, button and tab, and
  they follow whichever theme you have on.
- **Empty To-Do lists answer the filter you're looking at** — "Nothing due
  today" under Today, "No unassigned tasks" under No project — instead of
  reading the filter's own name back at you. The state sits centred in the list
  with one way out.
- **The active mode is marked, not just tinted.** Sessions and To-Do carry an
  accent underline when they're the one you're on; a background tint alone
  looked like one more hover state.
- **Scrollbars stay out of the way.** Thin and nearly invisible until you're
  over the list they belong to, so a sidebar of forty sessions stops
  advertising its own scrollbar.

### Fixed

- **Keyboard focus is visible again throughout.** Custom buttons and rows drew
  no focus ring at all, which made the app unusable without a mouse in places;
  everything now gets the accent ring unless it deliberately styles its own.
- **Muted text meets contrast minimums.** Metadata, counts and section labels
  were drawn at opacities that fell as low as 1.7:1 against the background.

## [0.24.0] - 2026-09-14

### Added

- **Split the window into up to four panes.** Drag a tab onto the edge of a
  pane to split it — left, right, top or bottom — or drop it in the middle to
  move it into that pane's strip. Right-click a tab for **Split right** /
  **Split down** if you'd rather not drag. Each pane keeps its own tab strip
  and its own active tab, so you can watch two Claude sessions work at once, or
  put a file next to the session editing it.
- **Files drag out of the explorer into a pane.** From the tree or from search
  results, onto whichever pane edge you want it opened against.
- **Drag the seams to resize.** Both rows share one vertical seam and both
  columns share one horizontal seam, clamped so no pane can be squeezed away.

### Changed

- **The session list is ordered newest first.** A session you just opened, and one
  that is working right now, both sit at the top; everything else falls back by
  how long ago it was last touched, using its transcript's date for sessions
  restored from a previous run. Status no longer has a ranking tier of its own —
  it didn't need one, and it couldn't express "I just opened this". What you
  pinned still sits above everything.
- **Markdown no longer rebuilds itself on every render.** The renderer handed
  react-markdown a fresh set of components each time, so React threw away the
  whole document and built it again — losing any text you had selected, and
  resetting every mermaid diagram, which flashed its own source and jumped the
  page while you tried to select around it. Diagrams also show a quiet
  placeholder until they have actually been drawn, instead of their source.
- **A live transcript no longer re-reads while you are selecting text in it.**
  Re-reading rebuilds the document, and WebKit drops a selection as soon as the
  nodes under it are replaced, so copying out of a running session's preview was
  close to impossible on macOS. The transcript body also skips re-rendering
  entirely when a re-read finds nothing new.
- **The tab strip is per-pane**, not one bar across the top. Closing a pane's
  last tab collapses the pane and hands its space to a neighbour; the grid
  never leaves a hole.
- **Only the focused pane shows the cyan active-tab rule**, and other strips
  dim — with four terminals on screen, which one takes your next keystroke is
  the thing worth marking.
- **A session visible in any pane is never auto-slept.** Previously only the
  one tab you were typing into counted as on-screen.
- Home, History, Settings and the session reader now cover the whole grid
  rather than leaving a tab strip above them.

## [0.23.1] - 2026-09-08

### Added

- **A link in a Markdown preview opens the file it names.** Clicking
  `docs/architecture.md` in a preview opens that file as a tab, resolved
  against the file the link was written in — no more finding it by hand in the
  explorer. `#anchor` links jump within the document; web links still go to the
  browser.
- **`mermaid` fences render as diagrams** in the preview. A diagram that
  doesn't parse shows its own source instead of blanking, and `mermaid` only
  loads the first time one actually appears.
- **Ctrl/Cmd+F in the file preview**, the same find bar the session reader has,
  and **Ctrl/Cmd+Shift+V** to flip Source/Preview.
- **A copy button on every fenced code block.**

### Changed

- **Markdown now renders as full CommonMark + GitHub extensions.** Headings
  past `###`, task lists, strikethrough, ordered lists that keep their start
  number, and — the reason for the change — links that survive punctuation:
  parentheses inside a URL, `]` inside link text, and `[a](x "title")` titles
  all used to break the link or the line around it.
- **The Markdown preview keeps its place.** It stays mounted across a
  Source/Preview switch instead of scrolling back to the top, remembers which
  half you were last on across restarts, and sits on a reading measure instead
  of the full panel width.

## [0.23.0] - 2026-09-08

### Added

- **Files keeps up with the disk.** An open file tab and every expanded folder
  now re-read themselves while they're on screen, so a file being written by a
  session in the next pane updates in place instead of needing the tab closed
  and reopened. Unsaved edits are never overwritten: the header says the file
  changed on disk and offers to load it. Nothing polls while the window is
  unfocused.
- **Files can be peeked at instead of docked.** An 8px strip at the right edge
  brings the panel up over the terminal — hover it, or click it — and it closes
  on Escape, on a click outside, or by itself once you open a file. Pin it from
  the panel header to dock it the old way. Peeking doesn't resize the terminal,
  so it no longer rewraps every visible line each time you glance at your
  files.
- **The rail spells out its folders.** Hovering the folder squares (or tabbing
  onto one) opens a panel of every open folder's full name, flush against the
  rail: click a name to filter to that folder, or add a folder from the same
  list. One letter stops being enough the moment two projects share it —
  `clients/api` and `internal/api` are both "A" — and a tooltip can only ever
  show one name at a time, which is exactly what makes two of them impossible
  to compare. Hovering a name lights its square, and vice versa.

### Changed

- **The collapse toggle moved to the top of the rail**, in both the folded and
  unfolded states. It was at the bottom of both; what matters is that the two
  agree, so clicking it never moves it.

### Fixed

- **The collapsed sidebar obeys the filter.** Folding the sidebar away used to
  drop whichever folder, status chip or search you had set and show every
  session again, back in the order the tabs were opened. It now shows the same
  list the expanded sidebar would, in the same order — minus sessions that have
  been auto-slept, which at 44px are a glyph that has nothing to report. Shells
  and exited sessions keep their square, and so does the session you're looking
  at. Each square is tinted with its folder's color, so two sessions of the
  same status are no longer identical dots.

## [0.22.0] - 2026-09-07

### Added

- **A "New session" row above the list.** The one control in the sidebar that
  creates rather than filters now gets its own row, in the list's own rhythm,
  and it names where the session will land — "New session · api" — so clicking
  it is never a guess. The old `+` at the end of the folder row is gone; the
  rail's dashed `+` still adds a folder.
- **Compact session list** (Settings → Interface). Drops the search field and
  the status chips, leaving the sessions under a 4px spectrum: one segment per
  live state, its width the share of sessions in it. For when you know your
  sessions by name and filter from the command palette.

### Changed

- **Picking a folder fades the others.** The unselected squares in the rail
  drop to 35% opacity so the one you filtered to is unmistakable; hovering
  any of them brings it straight back, so switching folders never means
  aiming at something greyed out.
- **Folders and navigation moved to a rail.** The sidebar is now two columns:
  a 44px rail on the left holding every open folder as a colored square, plus
  Home, Search, History, Files, Settings and the collapse toggle — and the
  session list beside it. Folder pills used to wrap, so the chrome above the
  list grew every time you opened another project and the list jumped down the
  screen. A column doesn't wrap.
- **The search field got the whole width.** It used to share 32px with four
  status chips, which left 92px — not enough for one word. Search and the
  chips now have a band each, and the chips' band disappears entirely when
  nothing is running, waiting or pinned.
- **Usage says what it is measuring.** The footer's `⚡ 42%  📅 18%` is now two
  labeled rows — Session and Week, each with a bar, its percentage and the
  countdown to reset, all in the open instead of behind a "⋯" menu. Each bar
  carries a mark for where the clock stands in that window: fill past the mark
  means you're burning the limit faster than the window is passing. When
  neither window is available the band renders nothing at all.

### Fixed

- **The collapse toggle stopped jumping.** It sat at the bottom of the rail
  when the sidebar was open and at the top when it was collapsed, so every
  click threw the button the full height of the sidebar. Both are at the
  bottom now — collapse and expand happen under the cursor.

## [0.21.0] - 2026-09-04

### Changed
- **A new sidebar, built for a lot of sessions.** Folders are no longer
  collapsible groups you scroll through — every session now sits in one flat
  list, ordered by what it is doing: pinned first, then waiting on you, running,
  idle, and finally everything asleep. Thirteen sessions are thirteen rows,
  where before they cost nineteen.
- **Folders became a filter.** Each open folder is a pill under the search box,
  with its own color, session count and right-click menu. Click one to see just
  that folder, click it again for all of them. The selected pill is painted in
  the folder's own color, scrolls itself into view, and the line above the list
  always names what you are looking at.
- **Session names get the whole row.** The folder, what Claude is doing, and the
  time moved to a smaller second line underneath, so names stop truncating to
  "Commit to ma…". That second line only appears when it has something to say.
- **Sessions show when they were last used** — "3d 4h ago", read from the
  session's own transcript, so it is right even for one restored from a past
  run.
- **One row of chrome instead of three.** The title bar is gone; the search box
  and the status counts share a single line, and Home, Files and the collapse
  toggle moved into the footer next to the usage percentages. Search sessions
  joined History and Settings in the footer menu.
- The counts row (waiting / running / just finished / pinned) replaced the three
  stacked strips that used to list those sessions a second time above the folder
  list.

### Fixed
- A finished session no longer reads as asleep. Sessions that were idle but not
  freshly-finished were sorted and colored as if nothing had happened, next to
  their own row showing a green check.

### Removed
- **Show folder paths** setting — the breadcrumb it controlled lived on the
  folder headings that no longer exist. Two folders with the same name now show
  their parent automatically, which is what the setting was for.
- Dragging sessions to reorder them. The list sorts itself by status now, so
  there is no manual order to keep. Folders are still reorderable by dragging
  their pills.

## [0.20.0] - 2026-08-14

### Changed
- **Real tab management up top.** The tab strip used to hold only your open
  files plus a single slot for the last session you touched. Now every session
  you go into is *added* to it and stays: click a session in the sidebar and it
  appears up there, click another and both are there to switch between.
  Sessions, shells and files share the row, in the order you opened them.
  Drag tabs to reorder the strip, middle-click to close, and the active tab is
  always scrolled into view. Closing a session's tab up here only takes it out
  of the strip — it keeps running and stays in the sidebar; files still close
  for real.

### Added
- **Hand a session to another machine.** Export a Claude Code session to a file
  (the upload button on a Session History row) and import it on another computer
  (right-click a folder → Import session…) to resume it there — so a colleague
  can pick up your shift where you left off. The transcript is re-homed under the
  importing machine's path; the code travels separately via git. See
  docs/features/session-transfer.md.

## [0.19.0] - 2026-08-13

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

[Unreleased]: https://github.com/Exorsky/too-many-terminals/compare/v0.25.0...HEAD
[0.25.0]: https://github.com/Exorsky/too-many-terminals/compare/v0.24.0...v0.25.0
[0.24.0]: https://github.com/Exorsky/too-many-terminals/compare/v0.23.1...v0.24.0
[0.23.1]: https://github.com/Exorsky/too-many-terminals/compare/v0.23.0...v0.23.1
[0.23.0]: https://github.com/Exorsky/too-many-terminals/compare/v0.22.0...v0.23.0
[0.22.0]: https://github.com/Exorsky/too-many-terminals/compare/v0.21.0...v0.22.0
[0.21.0]: https://github.com/Exorsky/too-many-terminals/compare/v0.20.0...v0.21.0
[0.20.0]: https://github.com/Exorsky/too-many-terminals/compare/v0.19.0...v0.20.0
[0.19.0]: https://github.com/Exorsky/too-many-terminals/compare/v0.18.0...v0.19.0
[0.18.0]: https://github.com/Exorsky/too-many-terminals/compare/v0.17.0...v0.18.0
[0.17.0]: https://github.com/Exorsky/too-many-terminals/compare/v0.16.1...v0.17.0
[0.16.1]: https://github.com/Exorsky/too-many-terminals/compare/v0.16.0...v0.16.1
[0.16.0]: https://github.com/Exorsky/too-many-terminals/compare/v0.15.0...5054537
