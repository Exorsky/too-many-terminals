# Workspace persistence

The app remembers the current folder, sidebar collapse state, and open tabs across
restarts, so closing and reopening the app continues where you left off.

## What's saved

`src-tauri/src/workspace.rs` writes `<config dir>/claude-terminal/workspace.json`
(`dirs::config_dir()` — `%APPDATA%` / `~/Library/Application Support` / `~/.config`):

```json
{
  "cwd": "C:\\Users\\me\\project",
  "collapsed": false,
  "tabs": [
    { "kind": "claude", "name": "Claude", "shellId": null, "resumeSessionId": "…" },
    { "kind": "powershell", "name": "PowerShell", "shellId": "powershell", "resumeSessionId": null }
  ]
}
```

Exited tabs are dropped before saving. The frontend (`App.tsx`) debounces writes 300ms
after any change to tabs/cwd/collapsed, via `ipc.saveWorkspace`.

## Restoring on launch

On startup `App.tsx` calls `ipc.loadWorkspace()` once; if a folder was saved, it respawns
every saved tab at that folder:

- **Shell tabs** just start fresh (there's no shell state to resume).
- **Claude tabs** pass `resumeSessionId` as `--resume <id>` if one was captured, so the
  exact conversation continues; otherwise they start a new session.

## Learning a fresh Claude tab's session id

A brand-new (non-resumed) Claude tab has no session id at spawn time — Claude Code
assigns one by creating a transcript file once the CLI starts. `commands.rs::pty_spawn`
snapshots the project's existing transcript ids (`session_history::existing_session_ids`)
right before spawning, then polls (`session_history::find_new_session`, every 1s for up to
30s) for a new file that appeared after the spawn. Once found, it emits a
`claude-session-resolved` event; the frontend records it on the tab
(`tabsReducer` `sessionResolved` action) so the next debounced save can persist it.

## Files

- `src-tauri/src/workspace.rs` (+ unit tests: round-trip, missing/corrupt file, directory creation)
- `src-tauri/src/session_history.rs` — `existing_session_ids`, `find_new_session` (+ tests)
- `src-tauri/src/commands.rs` — `load_workspace`, `save_workspace`, spawn-time session watcher
- `src/App.tsx` — restore-on-mount effect, debounced save effect
- `src/lib/tabs.ts` — `sessionResolved` action
