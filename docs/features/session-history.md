# Session history

The History item (sidebar footer menu) opens a panel of past Claude Code sessions merged
across every open project folder, read from the transcripts Claude Code itself writes
under `~/.claude/projects/<encoded-dir>/*.jsonl`. Read-only and offline; nothing uploaded.

- **Dir encoding** mirrors Claude Code's scheme: `:`/`\`/`/` → `-`
  (`C:\Users\x` → `C--Users-x`).
- **Entries**: `ipc.listSessions` is called once per open project and the results are
  merged client-side (`SessionHistoryPanel.tsx`), tagged with which project they came
  from; newest 50 per project by file mtime. Preview = first non-synthetic user message
  (synthetic = starts with `<`, e.g. slash-command echoes), whitespace-collapsed,
  100 chars max.
- **Name** (when known): a transcript file carries no name of its own — `SessionHistoryEntry`
  has no `name` field. Names live in `workspace.json`'s `sessionNames` map (session id →
  name), folded in from every tab that carries a real name by `learnSessionNames`
  (`src/lib/tabs.ts`) and **kept after that tab is closed** — otherwise a closed session
  would lose its title and become an unrecognizable row of raw preview text. The name is
  the row's title, above the preview, and matches search too. The same map names a
  **resumed** tab, so the sidebar and History always call a session the same thing.
  Sessions never named in TMT (e.g. started in the VS Code extension — see
  [vscode-handoff.md](vscode-handoff.md)) fall back to the preview alone.
  The placeholder `Claude` a fresh tab starts with is not a name and never enters the map.
- With more than one folder open, a project filter chip row appears (mirroring the
  original multi-project app) alongside the folder name shown on each row.
- **Resume** (click / Enter / →) opens a new Claude tab, in that entry's project, with
  `claude --resume <sessionId>`.
- **Read** (`▤` action / Space) opens the transcript as a rendered document — see
  [session-reader.md](session-reader.md).
- A live session's tab context menu also has **Open in VS Code**, handing it off to the
  native Claude Code VS Code extension — see [vscode-handoff.md](vscode-handoff.md).
  Works because both tools read the same transcript files this page describes.
- **Delete** (trash / Del) removes the transcript file after inline confirmation.
  Session ids are validated (`[A-Za-z0-9_-]+`) so no path escapes.
- **Calendar** (`c`, or the header's calendar button): a three-month grid above the list —
  one square per day, filled by how many sessions ran and tinted with the hue of the folder
  that ran most of them. Click a day to scope the list to it; the picked day shows as a chip
  next to the folder chips, and clicking the chip, the day again, or `esc` clears it. The grid
  itself is drawn from everything the search and folder filters left, *not* from the day
  filter — so picking a day never empties the grid you picked it from. Hovering a day reads
  out date · sessions · folders under the grid.
  Same `SessionCalendar` component Home's cadence uses; passing `onSelectDay` is what makes
  the days clickable there and not on Home. History lists transcripts without scanning them,
  so its squares carry no token figure — the caption simply leaves it out.
- Panel UX: search across preview text, folder name, and the session's name if it has
  one (`/`), Today/Yesterday/Earlier day groups, ↑↓/Enter keyboard nav.

## Searching inside transcripts

The panel's search box covers session names, folder names — and the full text of
every transcript on disk. That last part is the point: `preview` is only a
session's *first* message, so before this the only way to find a conversation by
something said in the middle of it was to ask Claude to go looking.

`search_transcripts` (`session_history.rs`) streams every `*.jsonl` under
`~/.claude/projects`, keeps the first match per session and counts the rest,
and returns a whitespace-collapsed snippet around the hit. It runs over **all**
projects, not just the folders open in the sidebar: the session you half-
remember is usually in a project you closed months ago, which is exactly when
search beats scrolling. A hit from a closed project is carried into the list as
a first-class row.

**No index, on purpose.** The corpus measured 253 files / 204 MB on a working
machine and reads end to end in about half a second; an index would have to be
invalidated on every turn Claude writes, which is a cache-coherency problem
bought in exchange for nothing. Revisit if the numbers stop holding.

The frontend keeps the two searches apart: the metadata filter is local and
instant, the transcript scan is debounced by 220ms and crosses to Rust. That
split is why the list reacts on the first keystroke. While the scan runs the
panel shows a `Searching transcripts…` status row — without it, a short list
reads as "there is nothing else" rather than "still looking". Queries shorter
than two characters never start a scan.

### Recovering a project directory

Claude Code's folder names map `/`, `\` and `:` all onto `-`, so they can't be
inverted. A transcript records the `cwd` it ran in, and the folder is always
that path or one of its ancestors, so `recover_project_dir` walks up until the
encodings agree. Two things that bite there, both covered by tests:

- It trims segments on either separator rather than using `Path::parent`, which
  is host-aware — on Unix `Path` doesn't treat `\` as a separator at all, so a
  transcript recorded on Windows would be one opaque component and never
  resolve. Transcripts travel between machines; the parsing must not care which
  one is reading.
- Comparison uses full Unicode case folding, not `eq_ignore_ascii_case`: people
  name project folders, and a Cyrillic or accented one folds to itself under the
  ASCII version and silently never matches.

Snippets are sliced by `char`, never by byte — transcripts are full of non-ASCII
and byte slicing panics mid-codepoint.

## Files

- `src-tauri/src/session_history.rs` (+ unit tests on tempfile fixtures) — unchanged by
  multi-project support; it already only ever took a single `project_dir` per call
- `src/components/SessionHistoryPanel.tsx` (per-project fetch + merge), `src/lib/relative-time.ts`
- `src/components/SessionCalendar.tsx` (+ test); `calendarMonths`/`dayKey` in `src/lib/stats.ts`
- `src/lib/tabs.ts` `learnSessionNames` + `UNNAMED_TAB`; `src-tauri/src/workspace.rs`
  `session_names` (`#[serde(default)]`, so pre-existing workspace files still load)
- Wiring: `App.tsx` `sessionNames` state (loaded/saved with the workspace) and
  `handleResumeSession`
