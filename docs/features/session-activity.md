# Session activity

> **What did this session change outside the machine, and what is it asking
> for right now?** Both answered without reading the transcript.

Three pieces, one source each:

| Where | Shows | Source |
|---|---|---|
| Sidebar row | a muted pencil + count once a session has written outside the machine | PostToolUse hook, live; persisted as `writes` on the saved tab |
| Sidebar row, waiting | `🔒 Permission · running api jira POST …` instead of a bare "needs you" | Notification hook + the PreToolUse summary just before it |
| Desktop notification | the same words as the row | same |
| Inspector › Activity | every write with its time, then reads / shell / edits counted | the transcript (`get_session_activity`) |
| Inspector › Tokens | total tokens, cache-hit rate, turns | the transcript |

## What counts as a write

`activity::write_label` (`src-tauri/src/activity.rs`) decides, from the tool
name and its input:

- **Shell** (`Bash`, `PowerShell`): any command segment (split on `&& ; | \n`)
  that sends an HTTP write — `POST`/`PUT`/`PATCH`/`DELETE` as an HTTP client's
  method argument (`api jira POST …`, `http PUT …`, `xh`) or after
  `-X`/`--request`/`--method` (`curl -X PUT`, `gh api --method PATCH`) — or
  `git push` (past git's own `-C dir` / `-c k=v`), `glab`/`gh mr|pr|issue
  create|merge|note|comment|approve|close`, `curl -d/--data/--json/-F`,
  `kubectl apply|delete|patch|scale|rollout…`, `terraform|terragrunt
  apply|destroy`, `helm install|upgrade|uninstall`, `aws … create-*/delete-*/
  put-*/update-*…`, `gcloud`/`az … create|delete|update|deploy`. A capitalised
  verb anywhere else is text (`grep -rn DELETE src/`), and `gcloud config set` /
  `az account set` change local config, so neither counts.
- **MCP tools**: the tool's name, split on `_`/`-`, contains a verb such as
  create, update, delete, send, reply, assign, revoke, suspend, transfer,
  upload — and no read word (get, list, search, view, read, fetch, find, query,
  describe, status, or `tabs` for the browser extension's own tabs).
  `users_suspend` is a write; `users_get`, `get_issue_comments` and
  `tabs_create_mcp` are not.
- **Subagents' calls** aren't counted by the badge: the hook skips any payload
  with an `agent_id` (set when it fires inside a subagent — see Claude Code's
  hooks reference). Those calls live in the subagent's own transcript, not the
  session's, so Activity couldn't list them.
- **Local edits** (`Edit`, `Write`) are not writes. They are counted as edits.
  The Changes panel ([git.md](git.md)) is where those are reviewed.

The label is the command segment that wrote (or `server · tool` for MCP),
capped at 72 characters.

It's a heuristic and says so in a `ponytail:` note: a write hidden inside
`./deploy.sh` is missed, and a `curl -d` against a search endpoint is counted.
The badge answers "did this session touch anything". The transcript is still
the record.

## Only writes that happened

- **Live**: PostToolUse fires only after a tool call succeeds, so a denied
  permission or a failed command never reaches the badge. Its matcher is
  `Bash|PowerShell|mcp__.*`, so a Read or Grep doesn't spawn a hook process.
- **Transcript**: a write is held by its `tool_use` id until its
  `tool_result` comes back. An `is_error` result (denied, failed) drops it, and
  one with no result yet isn't listed.

The badge is a live count persisted in `workspace.json`, so after a restart or
a `/clear` it can say something the transcript doesn't. Whenever Activity reads
the transcript, the badge takes the transcript's count (`writesSeen` — up or
down), so the two agree.

Activity reads the transcript once when the inspector shows the session, then
once each time a turn ends — not when a turn starts and not on each write, since
the transcript is still growing then and the turn's end reads it whole.

## What a waiting session is asking

Claude Code's Notification hook says only which tool needs permission
("Claude needs your permission to use Bash"). The PreToolUse hook that fired a
moment earlier already said which command (`running api jira POST /rest/a…`).
`askDetail` in `src/lib/tabs.ts` joins the two as `Permission · <command>`. Any
other notification message is shown as is. The row draws a `Lock` in
`attention` before it, since this is the live needs-you state. The
notification body uses the same string.

## Files

- `src-tauri/src/activity.rs` (+ tests) — `write_label`
- `src-tauri/src/hooks.rs` — the PostToolUse entry and its matcher, the
  `post-tool-use` hook client case
- `src-tauri/src/hook_server.rs` (+ tests) — `tab:write` → `claude-tab-write`,
  the Notification message as `detail`
- `src-tauri/src/session_stats.rs` (+ tests) — `writes`, `reads`, `edits`,
  `shell`, `read_session_stat`
- `src-tauri/src/commands.rs` — `get_session_activity`
- `src-tauri/src/workspace.rs` — the persisted `writes` count
- `src/lib/tabs.ts` (+ tests) — `askDetail`, the `write` / `writesSeen` actions
- `src/components/SessionActivity.tsx` (+ test) — the inspector sections
- `src/components/SessionsSidebar.tsx` — the badge and the asking line
- `src/App.tsx` — `onTabWrite`, the notification body
