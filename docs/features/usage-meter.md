# Usage meter

The sidebar footer shows two rolling rate-limit windows, both reconstructed
entirely from Claude Code's own local transcripts
(`~/.claude/projects/**/*.jsonl`) — no network calls, no credentials, works
identically on Windows/macOS/Linux:

1. **Session** — the current 5-hour block: tokens used, a percentage and
   progress bar against an estimated ceiling, a live countdown to reset.
2. **This week** — the same, but for the current 7-day block. Expands into a
   per-model breakdown (+ cache reads) scoped to that week's active block.

Either row shows "no active window" when idle; the whole meter disappears on
a fresh install with no transcript history yet. There's no calendar-day
metric anymore — both windows are rolling, matching how Claude's actual rate
limits work, rather than resetting arbitrarily at UTC midnight.

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

## How each window is computed

`src-tauri/src/session_usage.rs`:

- Scans transcripts modified in the last 90 days (bounds the read; also gives
  the 7-day window enough history to calibrate from — five 7-day blocks alone
  need 35 days).
- Extracts one `Turn` per assistant entry (timestamp, fresh tokens, cache-read
  tokens, model), deduped by `message.id` (fallback `requestId`). **Fresh
  tokens** = input + output + cache-write; cache reads are tracked separately
  (near-free re-reads that would dwarf everything else).
- **Blocks**: sorts every turn chronologically and groups them into rolling
  windows of a given duration (5 hours for the session, 7 days for the week)
  — a block starts at its first turn and absorbs everything until the
  duration passes; the next turn after that starts a new block. Both windows
  run this over the *same* scanned turns, just with a different duration —
  this mirrors Claude's own rolling-window rate limiting, reconstructed
  rather than queried since the exact boundary algorithm isn't published.
- **Active block**: the most recent block for that duration, if "now" still
  falls before its end. If it's already expired, the window is idle —
  `tokensUsed: 0`, no countdown, next block starts on your next message. (The
  session can idle out on its own 5-hour clock while the week block it's
  nested inside is still very much active.)
- **Estimated limit**: the biggest *completed* block on record for that
  duration (fewer than 5 of them) or their 90th percentile (5+) — a personal
  "your usual ceiling" reference, explicitly not an official number. `null`
  until at least one block of that duration has fully closed, shown as
  "still calibrating".
- **Model breakdown**: fresh tokens and cache reads, summed only over turns
  falling inside the *current week's* active block — not all-time, not the
  session block.

## Display

`UsageMeter.tsx` — one `WindowRow` per window (`Session` and `This week`,
sharing the same component):

- `NN% · resets in Hh Mm` (or `Nd Hh` past a day) plus `Xk / ~Yk tokens`, with
  a bar colored success (<70%) / warning (70–90%) / destructive (≥90%)
  against the estimate. The countdown ticks locally every second (no extra
  IPC calls); the token count and estimate refresh on the poll interval. No
  estimate yet → a calibrating notice instead of the bar.
- **Breakdown by model**, shown only when the week has data — click to expand
  the per-model list plus a cache-reads line, both scoped to the current
  week's block.
- Polled on **Settings → General → Usage → Refresh interval**
  (`usageRefreshSeconds`, default 5 minutes; see [settings.md](settings.md)).

## Files

- `src-tauri/src/session_usage.rs` (+ unit tests: block splitting/boundary at
  both durations, P90 vs. max estimate, session-idle-but-week-active,
  breakdown scoping, dedupe, missing root).
- `src-tauri/src/commands.rs` — `get_session_usage_stats`.
- `src-tauri/src/settings.rs` — `usage_refresh_seconds` (default 300).
- `src/components/UsageMeter.tsx` (+ `UsageMeter.test.tsx`) — `WindowRow` +
  the breakdown section.
- `src/components/SettingsView.tsx` — the refresh-interval dropdown.
- `src/types.ts` — `UsageWindow`, `SessionUsageStats`,
  `AppSettings.usageRefreshSeconds`.
