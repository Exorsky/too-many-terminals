# Tab status & auto-naming

Claude tabs show their live state (spinning while Claude works, a checkmark once
it's done, a pulsing icon when it needs input) and get a short auto-generated title
from their first prompt — both driven by Claude Code's own hooks, not by scraping
terminal *output*. The one exception, [interrupt detection](#detecting-an-interrupt)
below, watches the keystrokes the app itself relays to the pty — input it already
has its hands on — never the text Claude prints back.

## No bundled Node.js

The original Electron implementation used small Node scripts (`on-*.js` +
`pipe-send.js`) as the hook commands. This app has no Node runtime, so instead **the
app's own executable doubles as the hook client**: `main.rs` checks its own argv
before doing anything else — `<exe> --too-many-terminals-hook <event>` runs
`hooks::run_hook_client(event)` (reads the hook's stdin JSON, sends one line over the
pipe, exits) instead of launching the GUI. `.claude/settings.local.json` hook commands
point straight at this executable.

## Wiring per Claude tab

`commands.rs::pty_spawn`, only for `kind == "claude"`:

1. `hooks::install_hooks(cwd, exe_path)` merges hook entries into
   `<cwd>/.claude/settings.local.json` for all six events (SessionStart,
   UserPromptSubmit, PreToolUse, Stop, Notification, SessionEnd) — matching, not
   overwriting, any hooks the user configured themselves (detected by a
   `--too-many-terminals-hook` marker in the command string, so re-installs replace only
   our own entries; the legacy `--claude-terminal-hook` marker is also recognized so
   entries from before the rename get cleaned up, as are the old Electron-based
   ClaudeTerminal app's `node "<bundle>/hooks/on-<event>.js"` commands, which would
   otherwise spam MODULE_NOT_FOUND errors once that app is uninstalled). Runs on every
   spawn, but **skips the write when the merged content is byte-identical** to what's
   on disk — the usual case, since only the exe path is embedded (the PID-scoped pipe
   path travels via env vars, step 2). Rewriting unconditionally used to re-trigger
   file watchers in the project; when the project is itself a dev-served web app whose
   watcher reloads the page (e.g. this repo under `tauri dev` with a tab open in it),
   spawn → write → page reload → respawn became an infinite loop that leaked a `claude`
   process per tab per second.
2. `TOO_MANY_TERMINALS_TAB_ID` / `TOO_MANY_TERMINALS_PIPE` env vars are set on the pty child
   so the hook client (invoked by Claude Code, inheriting the pty's env) knows where
   to send messages and which tab they're for.
3. If resuming a past session, the tab's naming flag is pre-marked (see below) so its
   first prompt in this launch doesn't trigger a redundant rename.

## Transport

One named pipe (Windows, `\\.\pipe\too-many-terminals-hooks-<pid>`) / Unix socket
(`<tmp>/too-many-terminals-hooks-<pid>.sock`), started once at app launch
(`hook_server::start`, via `tauri::async_runtime::spawn`). Every hook invocation opens
a short-lived connection, writes one line of `{"tabId","event","data"}` JSON, and
exits — the server accepts connections in a loop and hands each to
`hook_server::handle_connection`, which reads newline-delimited JSON and routes it
through the pure `route_message` function (fully unit-tested, no I/O).

| hook event | wire event | effect |
| --- | --- | --- |
| SessionStart | `tab:ready` | status → `idle` (has a session id) or `new`; also emits `claude-session-resolved` (reinforces/replaces the poll-based detection in `session_history.rs`) |
| PreToolUse | `tab:status:working` | status → `working`, `data` → an activity summary (see below) |
| Stop | `tab:status:idle` | status → `idle` |
| Notification | `tab:status:input` | status → `requires_response`, **unless** the notification is Claude Code's idle nudge (message contains "waiting for your input", fired ~60s after a turn ends even when nothing was asked) — that's ignored so a finished session doesn't falsely appear in "Waiting on you". The hook client forwards the notification `message` as `data` so the server can tell the two apart; a missing message defaults to `requires_response`. |
| SessionEnd | `tab:closed` | ignored — real exits are already handled by the pty's own exit event; `/clear` is detected via the *next* SessionStart instead |
| UserPromptSubmit (first prompt only) | `tab:generate-name` | queued for naming (see below) |

Status/session-id/naming-result reach the frontend as Tauri events
(`claude-tab-status`, `claude-session-resolved`, `claude-tab-named`), handled in
`App.tsx` by dispatching `tabsReducer` actions (`status`, `sessionResolved`, `rename`).

## The activity caption

`hooks::tool_summary` turns a PreToolUse payload's `tool_name`/`tool_input`
into a short "what Claude is doing right now" string — `reading Sidebar.tsx`,
`running pnpm test`, `searching for TODO`, and so on for the handful of tools
worth a specific phrasing; everything else (every MCP tool included) falls
back to the bare tool name, still better than a bare spinner. Capped at 40
chars and deliberately shows a path/command *prefix*, never full arguments —
the same "names, not values" restraint `envTooltip` already applies to env
var display, since this ends up as glanceable sidebar chrome, not a log.

That string travels as `RoutedAction::Status`'s `detail` field (only ever set
alongside `working`) → `TabStatusPayload.detail` → the frontend's
`claude-tab-status` event → `Tab.statusDetail` (`tabsReducer`'s `status`
case; cleared on any status other than `working`, so it can't outlive the
turn it described). `Sidebar.tsx`'s `ActivityCaption` renders it as a second
line under a working row — `splitActivityDetail` breaks it into a muted verb
and a target highlighted in `warning` (the status vocabulary's own `working`
color, not a new accent) — rather than squeezing it into the row itself,
so a long summary never crowds out the tab name.

## Detecting an interrupt

Claude Code's own docs are explicit that the **Stop hook does not fire when
the user interrupts** (Escape/Ctrl+C) — there's no hook event at all for it
(tracked upstream as [anthropics/claude-code#9516](https://github.com/anthropics/claude-code/issues/9516)).
Left alone, an interrupted tab's status stays `working` forever, since
nothing ever tells the app otherwise.

Since there's no hook to listen for, the app notices the *keystroke* instead:
`Terminal.tsx`'s `onData` handler already sees every byte typed into a pty
before forwarding it; `isInterruptKeystroke` (`src/lib/utils.ts`) flags a
bare Escape (`\x1b`) or Ctrl+C (`\x03`) — exact-match only, so an escape
*sequence* (arrow keys, `\x1b[A`) doesn't false-positive. That fires
`onInterrupt`, which `App.tsx` wires straight to `dispatch({ type:
'interrupt', tabId })`. The reducer (`tabs.ts`) does the actual gating: a
no-op unless the tab is a claude tab currently `working`, in which case it
flips to `requires_response` (an interrupt always leaves Claude asking what
to do next — the same thing that status already means) and clears
`statusDetail`. This is a heuristic, not ground truth from Claude Code
itself — a real hook, if one ships, should replace it outright.

## Auto-naming

`namer.rs` shells out to `claude -p --no-session-persistence --model
claude-haiku-4-5-20251001 --tools "" --setting-sources ""` (same `claude_command`
platform wrapping as regular tabs), prompt on stdin, reply on stdout, run from `$HOME`
so no project `CLAUDE.md` leaks into context. The subprocess gets the login shell's
PATH (`login_shell_path()`, same as pty children) — GUI apps launched from
Finder/dock on macOS/Linux otherwise inherit a minimal PATH without `claude`, which
silently broke auto-naming there. A 30s timeout kills the child
(tree-kill via `taskkill` on Windows, since `cmd.exe` wraps `claude`; plain `kill -9`
elsewhere) and gives up silently. Calls are serialized through a single worker thread
(`NamingQueue`, spawned once in `lib.rs`'s `.setup()`) — concurrent `claude -p` calls
get rate-limited.

The hook client (`run_hook_client`, `prompt-submit` case) gates itself with a flag
file (`hooks::naming_flag_path`, `<tmp>/too-many-terminals-named-<tabId>`) so only the
*first* prompt of a session triggers naming; the flag is written right after sending
the `tab:generate-name` message. Both the hook client and the running app compute this
path independently from `std::env::temp_dir()` — no extra env var needed, since a
child process inherits the same `TMP`/`TMPDIR`. The app resets it when SessionStart
reports `source: "clear"` (a fresh conversation in the same tab), and pre-sets it when
resuming a past session (already has a meaningful name).

Not ported from the original: renaming from resumed/`/clear`d sessions by summarizing
the last two prompts read off the transcript — only first-prompt naming is
implemented. Desktop notifications on status change are also not included (the status
indicator itself covers the "did Claude finish?" need for now).

## Removing hooks

`onRemoveProject` (App.tsx) calls `ipc.uninstallHooks(dir)` → `hooks::uninstall_hooks`,
which strips just our entries from that project's `settings.local.json` (deleting the
file if nothing else is left in it), leaving any user-authored hooks untouched.

## Files

- `src-tauri/src/hooks.rs` — install/uninstall/merge logic (+ tests), hook-client entry point,
  `tool_summary` (+ tests)
- `src-tauri/src/namer.rs` — prompt building, name cleanup, subprocess call, naming queue (+ tests for the pure parts)
- `src-tauri/src/hook_server.rs` — pipe/socket server, message routing incl. the `detail` field (+ tests for `route_message`)
- `src-tauri/src/main.rs` — argv dispatch into hook-client mode
- `src/components/Sidebar.tsx` — `TabIndicator` (status icon), `ActivityCaption` + `splitActivityDetail`
- `src/components/Terminal.tsx` — `onInterrupt`, wired off `isInterruptKeystroke`
- `src/lib/utils.ts` — `isInterruptKeystroke` (+ tests)
- `src/lib/tabs.ts` — `status` action (incl. `statusDetail`), `interrupt` action (+ tests)
- Wiring: `src/App.tsx` (`onTabStatus`, `onTabNamed` listeners, `onInterrupt` → `dispatch({ type: 'interrupt' })`)
