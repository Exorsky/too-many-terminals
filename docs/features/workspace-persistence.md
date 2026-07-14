# Workspace persistence

The app remembers every open folder, sidebar collapse state, and every open tab (with
which folder it belongs to) across restarts, so closing and reopening the app continues
where you left off.

## What's saved

`src-tauri/src/workspace.rs` writes `<config dir>/too-many-terminals/workspace.json`
(`dirs::config_dir()` — `%APPDATA%` / `~/Library/Application Support` / `~/.config`):

```json
{
  "projects": ["C:\\Users\\me\\project", "C:\\Users\\me\\other"],
  "collapsed": false,
  "tabs": [
    { "kind": "claude", "name": "Claude", "shellId": null, "resumeSessionId": "…", "cwd": "C:\\Users\\me\\project" },
    { "kind": "powershell", "name": "PowerShell", "shellId": "powershell", "resumeSessionId": null, "cwd": "C:\\Users\\me\\other" }
  ]
}
```

`projects` is stored separately from `tabs` so a folder with zero open tabs still
reappears as an (empty) card next launch. Exited tabs are dropped before saving. The
frontend (`App.tsx`) debounces writes 300ms after any change to tabs/projects/collapsed,
via `ipc.saveWorkspace`.

## Restoring on launch

On startup `App.tsx` calls `ipc.loadWorkspace()` once, sets `projects` from the saved
list, and re-adds every saved tab at its own saved `cwd`.

### Lazy (dormant) restore

Restored tabs are added **dormant** (`Tab.dormant = true`) — a lightweight placeholder
with no pty/process behind it. A tab's pty is spawned only the first time it's actually
shown as a live terminal, via the lazy-wake effect in `App.tsx` (`startPty` + the `wake`
reducer action clearing the flag). This keeps reopening the app with N sessions from
launching N `claude`/shell processes at once — each Claude session is a ~200 MB Node
process, so restoring seven tabs used to cost ~1.4 GB up front. Now only the last-active
tab (the one `add` leaves active) wakes on launch; the rest stay dormant until you click
them.

Reading a restored Claude session as markdown or having an overlay (History/Settings/
Reader) up does **not** wake the tab — markdown reads straight from the transcript file,
so there's no need to spawn the process.

When a dormant tab does wake:

- **Shell tabs** just start fresh (there's no shell state to resume).
- **Claude tabs** pass `resumeSessionId` as `--resume <id>` if one was captured, so the
  exact conversation continues; otherwise they start a new session.

### Auto-sleep (idle background sessions)

The same dormant machinery reclaims memory from sessions you've left running. An interval
in `App.tsx` (`SLEEP_CHECK_MS`, every 60s) puts a Claude tab **back** to sleep once it has
been idle and off-screen for the configured threshold. Sleeping kills the pty — freeing its
~200 MB Node process — and flips the tab to dormant (`sleep` reducer action); the kept xterm
buffer keeps the last output visible, and the tab respawns via `--resume` the next time it's
shown (the lazy-wake effect).

The threshold is user-configurable: **Settings → General → Sessions → Auto-sleep idle
sessions** (`settings.autoSleepMinutes`, default 15 min; **Off** = 0 disables it entirely).
The interval reads the value live through a ref (`autoSleepMsRef`), so changing it takes
effect without restarting the timer.

Guards, so nothing you're using disappears:

- Only **Claude** tabs with a captured `resumeSessionId` sleep — shell tabs have no resumable
  state, and a Claude tab we couldn't resume is left alone.
- The tab **on screen** never sleeps, nor does one that's `working`. The per-tab idle timer
  (`idleSinceRef`) resets the moment a tab stops being eligible.
- The pty-exit from a sleep kill is expected, so `App.tsx` tracks those ids (`sleepingRef`)
  and swallows the event instead of marking the tab `exited`.

Dormant tabs (restored or slept) show a **moon** in the sidebar (`Sidebar.tsx`
`TabIndicator`), distinct from the live idle/working/awaiting-input states.

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
- `src/App.tsx` — restore-on-mount effect (dormant tabs), lazy-wake effect, auto-sleep interval, `startPty`/`sleepTab`, debounced save effect
- `src/lib/tabs.ts` — `sessionResolved`, `wake`, and `sleep` actions
- `src/types.ts` — `Tab.dormant` flag
- `src/components/Sidebar.tsx` — `TabIndicator` moon for dormant tabs
