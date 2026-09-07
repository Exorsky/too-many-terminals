# Usage meter

The sidebar's bottom band is **two labeled rows**, one per rate-limit window
Anthropic actually enforces, carrying the **official** numbers — the same
figures `/usage` prints inside Claude Code:

```
Session  ▬▬▬▬│▬▬▬▬▬▬▬▬   42%   3h 45m
Week     ▬▬│▬▬▬▬▬▬▬▬▬▬   18%   4d 6h
```

Which window, a bar, the percentage, and the countdown to reset. Nothing is
behind a menu any more, because there is no longer a menu: navigation moved to
the [rail](terminals.md#the-rail-folders-and-navigation), which left the band
free to spell out what it was compressing.

It was compressing badly. The old strip showed `⚡ 42%  📅 18%` — two numbers
you had to learn a lightning bolt and a calendar to tell apart, with the labels,
bars and countdowns hidden in a "more" menu next to Search/History/Settings.
Two unnamed numbers save 20px and read as neither.

A window the API doesn't return (e.g. no weekly limit on your plan) is omitted
rather than faked; if neither is available the band renders **nothing at all**,
rather than an empty 38px bar.

## The pace mark

The hairline crossing each bar is where the **clock** stands in that window —
fill past it means the limit runs out before the window does.

That mark is the reason the row exists in this shape. A bare percentage answers
"how much is gone", but the question that changes what you do is whether you're
burning faster than the clock: 42% one hour into a five-hour window and 42% four
hours in are "slow down" and "you're fine", and the number is identical.

`paceFraction()` computes it with no backend change. Both windows have a fixed
length (5 hours, 7 days) and `UsageWindow` already carries `resetsAtIso`, so the
window's start is the reset minus that length. It clamps to 0–1, because a
cached reset time can sit slightly in the past.

The mark deliberately **recolors nothing**. Color stays on the 70/90 thresholds
`barColor` already owns (`usage` → `warning` → `destructive`): a threshold warns,
the mark informs, and folding two signals into one color makes neither readable.

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
