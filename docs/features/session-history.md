# Session history

The History button (sidebar footer) opens a panel of past Claude Code sessions for the
current project directory, read from the transcripts Claude Code itself writes under
`~/.claude/projects/<encoded-dir>/*.jsonl`. Read-only and offline; nothing is uploaded.

- **Dir encoding** mirrors Claude Code's scheme: `:`/`\`/`/` → `-`
  (`C:\Users\x` → `C--Users-x`).
- **Entries**: newest 50 by file mtime. Preview = first non-synthetic user message
  (synthetic = starts with `<`, e.g. slash-command echoes), whitespace-collapsed,
  100 chars max.
- **Resume** (click / Enter / →) opens a new Claude tab with `claude --resume <sessionId>`.
- **Delete** (trash / Del) removes the transcript file after inline confirmation.
  Session ids are validated (`[A-Za-z0-9_-]+`) so no path escapes.
- Panel UX: search (`/`), Today/Yesterday/Earlier day groups, ↑↓/Enter keyboard nav.

## Files

- `src-tauri/src/session_history.rs` (+ unit tests on tempfile fixtures)
- `src/components/SessionHistoryPanel.tsx`, `src/lib/relative-time.ts`
- Wiring: `App.tsx` `handleResumeSession`
