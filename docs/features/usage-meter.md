# Usage meter

The sidebar's bottom row is a single always-on strip: both rate-limit
percentages Anthropic actually enforces, with the **official** numbers —
the same figures `/usage` prints inside Claude Code — plus a "more" trigger.
Opening it reveals the detail and the rest of the footer's navigation:

1. **Session** — the 5-hour window: percent used, a progress bar, a live
   countdown to reset.
2. **This week** — the same, for the 7-day window.
3. **History / Files / Settings** — the same three destinations the footer
   always had, now menu items instead of a mismatched row (one wide label
   button next to two bare icon squares). A check mark shows whichever one is
   currently open.

A window the API doesn't return (e.g. no weekly limit on your plan) is
omitted from both the trigger and the menu, rather than faked. If usage is
unavailable entirely, the trigger just drops its percentage chips — History,
Files, and Settings stay reachable regardless, since they're navigation, not
usage display.

## Where the numbers come from

`GET https://api.anthropic.com/api/oauth/usage` — the same endpoint Claude
Code's own `/usage` calls (its binary logs it as `fetchUtilization: GET
/api/oauth/usage`). Authenticated with the OAuth token Claude Code already
stores locally, sent as `Authorization: Bearer <token>` plus
`anthropic-beta: oauth-2025-04-20`.

The response body is the window set directly; `utilization` is a **float**:

```json
{"five_hour": {"utilization": 26.0, "resets_at": "2026-08-03T19:20:00Z"},
 "seven_day": {"utilization": 17.0, "resets_at": "2026-08-08T18:00:00Z"}}
```

**Token handling.** Read-only, never refreshed: `~/.claude/.credentials.json`
→ `claudeAiOauth.accessToken`, skipped if `expiresAt` has passed. Running the
refresh flow ourselves could disturb Claude Code's own session, so an expired
token is a fall-back case, not a re-auth case. macOS keeps the same JSON in
the login keychain instead of a file, read via
`security find-generic-password -s "Claude Code-credentials" -w`.

## Fallback chain

The usage endpoint **has its own rate limit** and answers `429` when leaned on
— two calls ten minutes apart tripped it during development. (This is why
Claude Code caches it at all, and why its changelog has "`/usage` now shows
your last-known usage bars with an 'as of' note when the usage endpoint is
rate-limited".) So:

1. **Live fetch** — but never more than once per `MIN_FETCH_INTERVAL`
   (5 minutes), enforced in the backend regardless of how fast the UI polls.
2. **Our own last good read**, held in memory — covers a 429 or a dropped
   connection without falling all the way back to disk.
3. **Claude Code's cache**, `~/.claude.json` → `cachedUsageUtilization` —
   only when we've never had a live read (cold start while offline). Measured
   going 30+ minutes stale during continuous API traffic (14% cached vs. 26%
   live), and a plain `claude -p` run doesn't refresh it, so it is strictly a
   last resort.

Anything past step 1 is flagged `fromCache`, and the UI appends
"cached — as of Nh Nm ago" past 5 minutes rather than presenting a stale
percentage as live.

> **Previously** this module estimated usage by scanning every transcript in
> `~/.claude/projects/**/*.jsonl`, summing tokens into rolling blocks and
> calibrating a "ceiling" from your own biggest past block. That was
> inherently wrong: a ceiling derived from your own p90 usage puts a typical
> user near 40% by construction, so it read 43% while the real figure was 15%.
> The block chain, the percentile estimator and the per-model token breakdown
> were all deleted.

## Files

- `src-tauri/src/session_usage.rs` — `session_usage_stats()` and the fallback
  chain. Unit tests cover the float parsing, a null window, token expiry,
  corrupt credentials, and the cache fallback. One **network** test,
  `#[ignore]`d so CI never depends on it, proves the URL/headers/response
  shape still hold: `cargo test -- --ignored live_fetch` (it treats a 429 as a
  pass with a note, since that's the endpoint's limit, not a broken build).
- `src-tauri/src/commands.rs` — `get_session_usage_stats` (async).
- `src-tauri/Cargo.toml` — `reqwest` with **rustls** rather than the default
  native-tls, so the one network call needs no system OpenSSL on Linux.
- `src-tauri/src/settings.rs` — `usage_refresh_seconds` (default 300).
- `src/components/SidebarFooter.tsx` (+ `SidebarFooter.test.tsx`) — the trigger
  button, `UsageRow`, and the History/Settings menu items. The reset
  countdown ticks locally every second so it doesn't stall between polls. The
  bar uses the themeable `usage` color below 70%, then escalates to `warning`
  and `destructive` — that escalation is deliberately not themeable, it's a
  signal rather than decoration. See [themes.md](themes.md).
- `src/components/SettingsView.tsx` — the refresh-interval dropdown (5m/15m/
  30m; nothing faster, see above).
- `src/types.ts` — `UsageWindow`, `SessionUsageStats`.
