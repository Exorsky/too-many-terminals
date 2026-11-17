# Home screen

> **Also a tab.** Click the usage meter in the title bar and the logbook opens as
> its own tab at the leading edge of the session strip, beside whatever you have
> open — not only when nothing is. See [usage-meter.md](usage-meter.md).

What fills the terminal pane when no tab is open. Instead of a line of grey
text, Home draws a **metrics dashboard built from your own session history** —
a quiet readout of how much you've worked and what Claude did, in the app's own
dark/monospace vocabulary. Everything is read locally from the transcripts
Claude Code itself writes under `~/.claude/projects/<encoded-dir>/*.jsonl`
(the same files [session history](session-history.md) lists). Offline, read-only,
nothing uploaded.

> **Previously** Home was a night skyline: each folder a tower, each past
> session a lit window you clicked to resume. That doubled as a session picker;
> resuming now lives in the sidebar and the [History panel](session-history.md),
> and Home is a readout. The skyline component, its `warmth()` cooling curve and
> the `.home-*` scene CSS were all removed.

## The time range

A **7 days / 30 days / 90 days / All** switch in the header rescopes every panel
at once. "All" is bounded by the same 50-newest-per-folder cap the history read
uses, so it means "everything on record" rather than an unbounded scan. The KPI
deltas compare with the window just before this one ("vs previous 30d"); All has
none.

## What each panel shows

A grid of cards (one column, two at `md`, a 12-column layout at `xl`), in this
order — the KPI tiles, then the readouts row (Token insights · Rate limit · Depth &
models), then Token flow + Project consumption, then the session lists and the
calendar, then Top commands · Rhythm:

| Panel | Reads | From the transcript |
| --- | --- | --- |
| KPI tiles | total tokens · cache hit · avg tokens per turn · sessions — each with a per-day sparkline (hover a day for its value) and a delta vs the previous window | `message.usage` + counts |
| **Token flow** | stacked columns per day — input, cache (read + write), output — on one axis with round ticks; pointing at a day reads it out in the caption, which otherwise names the peak day | `message.usage` |
| Project consumption | tokens per folder, biggest first, with its share of the window | `message.usage` + folder |
| Largest sessions | the five biggest sessions by tokens: when, folder, first prompt, a bar in the folder's hue — click one to open it | `message.usage` |
| **Activity** | the month grid (`SessionCalendar`) — one square per day, filled by how many sessions ran, tinted by folder | file mtime + folder |
| Recent activity | the five latest sessions: time, folder, tokens · turns, first prompt — click one to open it | file mtime + counts |
| Token insights | daily average, peak day, 30-day pace (daily average × 30), tokens per session | derived |
| Rate limit — live | the official 5h / 7d rate-limit percentages — the same read the title-bar meter shows (`useUsageStats`, `src/lib/usage-store.ts`: one poll for the whole app, on the Settings refresh interval) | the `/usage` endpoint, **not** the transcripts — see [usage-meter.md](usage-meter.md) |
| Top commands | first word of every Bash/PowerShell call, ranked | `tool_use` inputs |
| Rhythm | current & best day streak, busiest hour, a 24-hour histogram | message timestamps |
| Depth & models | avg/longest turns, avg/longest duration, token share by model | timestamps + `message.usage` |

**The token series colours** (input `#5b8def`, cache `#2fa89e`, output `#a77be0`)
are identity hues, validated together on the card surface with the dataviz
palette validator (lightness band, chroma, colour-blind separation, contrast — all
pass). None is a status colour or `primary`, and each always appears with its
name in the legend and the caption. **A session lands whole on its last-used
day**: the scan sums tokens per session, not per message, so a session that ran
over midnight counts on the day it ended. **Est. cost** from the mock-up isn't
shown — it needs per-model pricing the app doesn't have.

**Turns** counts the prompts you actually typed — real, non-synthetic user
messages, the same "is this something the human wrote" test the history preview
uses. **Tokens** is a raw sum of input/output/cache tokens; that's an honest
count, unlike the percentage-of-limit estimate the old usage meter derived and
deleted (see [usage-meter.md](usage-meter.md)). The live rate-limit gauges are
the only percentages here, and they come from Anthropic's endpoint, not a guess.

## The activity calendar

A **month grid** (`SessionCalendar`, shared with the
[History panel](session-history.md)) where each day is a square, filled by how
many sessions ran that day and tinted with the hue of the folder that ran most
of them ([`projectHue`](../../src/types.ts)). Density is drawn as *alpha over
that hue* rather than as its own colour ramp — a GitHub-style ramp would have to
pick a colour, and every candidate green/orange is reserved for the status
vocabulary (see [design.md](../design.md)). Four steps: 1, 2–3, 4–5, 6+.

The range switch sets how many months are drawn — 1 / 2 / 3 / 3 for 7 days / 30
days / 90 days / All (`calendarMonthCount`). Point at a day and the caption under the grid reads
out **date · sessions · tokens · which folders**, so it answers what the square
is made of rather than quoting one prompt out of context.

Days here are a readout, not buttons: to reopen a past session, click it in
Largest sessions or Recent activity (the same resume the
[History panel](session-history.md) does — the tab it already has, or a new
`--resume` one), or use History or the sidebar. Home passes no
`onSelectDay`, and that absent prop is the whole difference between the two
surfaces — History's grid is the same component with days you can click.

## Data & cost

One `get_session_stats` call per open folder on mount — the same trigger the old
skyline used for `listSessions`, but a **fuller** read: it scans each transcript
end-to-end to sum turns, tokens, commands and model use, rather than stopping at
the first message. The command is `async`, so the scan runs off the main thread
and the pane shows "Reading your sessions…" until it lands. Capped at the newest
50 transcripts per folder. There is no cache today — an idle screen scanning at
most 50 files per folder is cheap enough; if a very large history ever drags,
the fix is an mtime-keyed parse cache (noted in `session_stats.rs`).

Stats load once per `projects` change, and `now` is fixed at mount, so the
day-bucketing is stable while Home is open. Home unmounts the moment you enter a
session, so every visit already reads fresh.

## Getting there

**Every launch opens on Home**, restored workspace or not — you land on the
dashboard and pick where to go. Restored tabs stay dormant while Home is up, so
nothing spawns a process until you open it. Home is also implicit whenever no
tab is open; click the **Too Many Terminals** wordmark (or, collapsed, the app's
terminal-square icon) to toggle back to it with sessions running. Anything that
puts you into a session leaves Home automatically.

## States

- **No folders open** — a dashed empty lot and an Open-folder action.
- **Folders open** — the dashboard; panels read zero where a window has no data.

## Motion

Quiet, matching the rest of the chrome (the skyline's ambient animation was the
one sanctioned exception, and it's gone). Calendar squares rise as they appear
(staggered per day, and only the ones that hold something); bars and gauges grow
from their leading edge once on mount, and the token columns grow up from their
baseline (`.dash-grow-y`).
Nothing loops. `prefers-reduced-motion` disables all of it — bars simply appear
at their real width, since the width is the value and the animation only reveals
it.

## Files

- `src/components/HomeScreen.tsx` — the dashboard component.
- `src/components/HomeScreen.test.tsx` — KPI rollup, token-flow columns and their
  hover caption, per-folder tokens, command ranking, live gauges, calendar hover
  caption, range switch, empty state.
- `src/components/SessionCalendar.tsx` (+ test) — the month grid, shared with
  the History panel.
- `src/lib/stats.ts` (+ `stats.test.ts`) — the pure aggregation (range filter,
  previous window and % change, per-day token buckets, summary, calendar
  bucketing, per-folder tokens, largest / recent sessions, top commands, rhythm,
  streaks, depth, model share, formatters).
- `src/lib/ipc.ts` — `getSessionStats`.
- `src-tauri/src/session_stats.rs` (+ tests) — the per-session transcript scan.
- `src-tauri/src/commands.rs` — `get_session_stats` (async adapter).
- `src/globals.css` — `.dash-*` motion/primitive classes.
- `src/App.tsx` — renders Home when `showHome || state.tabs.length === 0` and no
  overlay is up.
