# Usage meter

The sidebar footer shows two independent token metrics, both read straight from
Claude Code's own local transcripts (`~/.claude/projects/**/*.jsonl`) — no
network calls, no credentials, works identically on Windows/macOS/Linux:

1. **Session window** — an estimate of the current 5-hour rate-limit block:
   tokens used, a live countdown to reset, and a progress bar.
2. **Today** — total tokens for the calendar day (UTC), expandable into a
   per-model breakdown. Unchanged from before.

Either section renders only when it has something to show; the whole meter
disappears on a fresh install with no transcript history yet.

## Why "estimate" and not a real limit

There is no public Anthropic API for a Claude Code user's current rate-limit
usage or their plan's exact token ceiling — confirmed by checking (a) the
`claude` CLI for a machine-readable equivalent of the interactive `/usage`
command (none exists — see
[anthropics/claude-code#40793](https://github.com/anthropics/claude-code/issues/40793)),
and (b) whether Claude Code caches usage/rate-limit state locally in a
readable file (it doesn't; only transcripts are on disk). The only other route
— reading the OAuth token Claude Code stores locally and calling Anthropic's
API directly to read rate-limit response headers — is undocumented,
credential-handling, and platform-inconsistent (a plain JSON file on Windows;
OS keychains on macOS/Linux), so it was deliberately not built. Everything
below is reconstructed from your own transcript timestamps instead, the same
technique community "Claude usage monitor" tools use.

## How the session window is computed

`src-tauri/src/session_usage.rs`:

- Scans transcripts modified in the last 30 days (bounds the read; also keeps
  the ceiling estimate current, since limits can change over time).
- Extracts `(timestamp, fresh tokens)` per assistant turn, deduped by
  `message.id` (fallback `requestId`) — same fresh-token definition as the
  daily meter (input + output + cache-write, cache reads excluded).
- **Blocks**: sorts every turn chronologically and groups them into rolling
  5-hour windows — a block starts at its first turn and absorbs everything
  until 5 hours pass; the next turn after that starts a new block. This
  mirrors Claude's own rolling-window rate limiting, reconstructed rather than
  queried since the exact boundary algorithm isn't published.
- **Active block**: the most recent block, if "now" still falls before its
  end. If it's already expired, there's no active session — `tokensUsed: 0`,
  no countdown, next block starts on your next message.
- **Estimated limit**: the biggest *completed* block on record (fewer than 5
  of them) or their 90th percentile (5+) — a personal "your usual ceiling"
  reference, explicitly not an official number. `null` until at least one
  block has fully closed, which the UI shows as "still calibrating".

## Display

`UsageMeter.tsx`:

- **Session row**: `Xk / ~Yk this session · resets in Hh Mm`, with a bar
  colored success (<70%) / warning (70–90%) / destructive (≥90%) against the
  estimate. The countdown ticks locally every second (no extra IPC calls);
  the token count and estimate refresh on the poll interval. No active block
  → "No active session". No estimate yet → a calibrating notice instead of
  the bar.
- **Today row**: unchanged — click to expand into the per-model breakdown
  plus a cache-reads line.
- Both `getUsageStats` and `getSessionUsageStats` are polled together on
  **Settings → General → Usage → Refresh interval** (`usageRefreshSeconds`,
  default 60s; see [settings.md](settings.md)).

## Files

- `src-tauri/src/session_usage.rs` (+ unit tests: block splitting/boundary,
  P90 vs. max estimate, idle detection, dedupe, missing root) and
  `src-tauri/src/usage.rs` (+ tests) — the two independent scans.
- `src-tauri/src/commands.rs` — `get_usage_stats`, `get_session_usage_stats`.
- `src-tauri/src/settings.rs` — `usage_refresh_seconds` (default 60).
- `src/components/UsageMeter.tsx` (+ `UsageMeter.test.tsx`) — both rows.
- `src/components/SettingsView.tsx` — the refresh-interval dropdown.
- `src/types.ts` — `SessionUsageStats`; `AppSettings.usageRefreshSeconds`.
