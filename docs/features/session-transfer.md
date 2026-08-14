# Session transfer (Export / Import)

Hand a Claude Code session to another machine — so a colleague can pick up your
shift where you left off — by exporting it to a file and importing that file on
their computer.

## Why this is small

A "session" is a single transcript file:
`~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` (the same files
[session history](session-history.md) reads). Everything `claude --resume` needs
is in that one file. So transfer is just moving it:

- **Export** copies the transcript out to a file you choose.
- **Import** drops a received file into the target folder's Claude Code store
  and opens it as a resumed tab.

The transport in between — Slack, a shared drive, `scp` — is whatever you
already use. TMT only handles the two ends.

Unlike the [VS Code handoff](vscode-handoff.md), the two machines don't share a
disk, so there *is* something to copy here — but only the one file.

## Re-homing on import

The encoded folder name is derived from the absolute working directory, which
differs between machines (`C:\Users\alice\proj` → `C--Users-alice-proj`,
`/home/bob/proj` → `-home-bob-proj`). So import doesn't copy the file verbatim —
it re-homes it under **the importing machine's** encoded path for the folder you
imported into. The `cwd` and file paths recorded *inside* the transcript are
historical context Claude reads back; the folder that resume actually runs in is
the one you imported to.

The session id is the file's own stem and is kept as-is, so `claude --resume
<id>` finds it and both machines call the session the same id.

## Using it

- **Export**: right-click a session in the sidebar → **Export session…**, or in
  [Session History](session-history.md) hover a row → the upload button (`⭱`).
  A live session you're working right now is in History too (its transcript
  updates as you go), so exporting mid-shift just grabs the latest.
- **Import**: right-click a folder in the sidebar → **Import session…**, pick the
  `.jsonl` you received. A resumed Claude tab opens in that folder. The tab
  starts unnamed — the sender's tab name lives in *their* workspace, not the
  transcript — but History shows the real preview and you can rename it.

## Limits

- **The code travels separately.** This moves the *conversation*, not the repo.
  Continuing a shift almost always means the colleague already has the branch
  (via git); commit or push your work before handing off so their working tree
  matches what the session was doing. Uncommitted changes are not part of the
  bundle.
- **Don't run the same session live on two machines at once** — same
  transcript-append conflict the [VS Code handoff](vscode-handoff.md) warns
  about. For a shift handoff this is fine: you stop, they start.
- Import validates the file is a Claude Code transcript (first line is a JSON
  object) and that its name is a valid session id, so a stray file dropped in
  the picker fails with a readable error rather than polluting the store.

## Files

- `src-tauri/src/session_transfer.rs` — `export_session` / `import_session`,
  plain Rust with round-trip + validation tests. Reuses `encode_project_dir`
  and `valid_session_id` from `session_history.rs`.
- `src-tauri/src/commands.rs` — `export_session` / `import_session` Tauri
  adapters; registered in `lib.rs`.
- `src/lib/ipc.ts` — `exportSession` (save dialog) / `importSession` (open
  dialog), both thin wrappers over the native file dialogs.
- `src/components/SessionHistoryPanel.tsx` — the per-row Export button.
- `src/components/Sidebar.tsx` — the session context menu's **Export session…**
  (calls `ipc.exportSession` directly, since the row already holds the tab) and
  the folder context menu's **Import session…**.
- `src/App.tsx` — `handleImportSession` opens the resumed tab.
