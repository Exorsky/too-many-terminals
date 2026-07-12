# Session history

The History button (sidebar footer) opens a panel of past Claude Code sessions merged
across every open project folder, read from the transcripts Claude Code itself writes
under `~/.claude/projects/<encoded-dir>/*.jsonl`. Read-only and offline; nothing uploaded.

- **Dir encoding** mirrors Claude Code's scheme: `:`/`\`/`/` → `-`
  (`C:\Users\x` → `C--Users-x`).
- **Entries**: `ipc.listSessions` is called once per open project and the results are
  merged client-side (`SessionHistoryPanel.tsx`), tagged with which project they came
  from; newest 50 per project by file mtime. Preview = first non-synthetic user message
  (synthetic = starts with `<`, e.g. slash-command echoes), whitespace-collapsed,
  100 chars max.
- With more than one folder open, a project filter chip row appears (mirroring the
  original multi-project app) alongside the folder name shown on each row.
- **Resume** (click / Enter / →) opens a new Claude tab, in that entry's project, with
  `claude --resume <sessionId>`.
- **Delete** (trash / Del) removes the transcript file after inline confirmation.
  Session ids are validated (`[A-Za-z0-9_-]+`) so no path escapes.
- Panel UX: search across preview text and folder name (`/`), Today/Yesterday/Earlier
  day groups, ↑↓/Enter keyboard nav.

## Files

- `src-tauri/src/session_history.rs` (+ unit tests on tempfile fixtures) — unchanged by
  multi-project support; it already only ever took a single `project_dir` per call
- `src/components/SessionHistoryPanel.tsx` (per-project fetch + merge), `src/lib/relative-time.ts`
- Wiring: `App.tsx` `handleResumeSession`
