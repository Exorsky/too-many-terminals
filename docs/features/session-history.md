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
- Panel UX: search across preview text, folder name, and the session's name if it has
  one (`/`), Today/Yesterday/Earlier day groups, ↑↓/Enter keyboard nav.

## Files

- `src-tauri/src/session_history.rs` (+ unit tests on tempfile fixtures) — unchanged by
  multi-project support; it already only ever took a single `project_dir` per call
- `src/components/SessionHistoryPanel.tsx` (per-project fetch + merge), `src/lib/relative-time.ts`
- `src/lib/tabs.ts` `learnSessionNames` + `UNNAMED_TAB`; `src-tauri/src/workspace.rs`
  `session_names` (`#[serde(default)]`, so pre-existing workspace files still load)
- Wiring: `App.tsx` `sessionNames` state (loaded/saved with the workspace) and
  `handleResumeSession`
