# “Waiting on you” inbox

A strip near the top of the sidebar that gathers every Claude session which
**stopped and is blocked on you** — one place to answer the "which of my twelve
terminals needs me?" question without hunting through collapsed folders. Don't
confuse this with the user-controlled [Pinned section](terminals.md#pinning-a-session)
right above it — this one fills itself automatically from live session state, and
you can't add or remove a row from it directly.

The strip is the first payoff of a simple idea: the app already knows each Claude
tab's live state from Claude Code's hooks (see
[tab-status-and-naming.md](tab-status-and-naming.md)); this just collects one of
those states across every folder instead of leaving it as a dot on a single row.

## What it shows

Every tab where `kind === 'claude'` and `status === 'requires_response'` and the
pty hasn't exited — i.e. Claude fired its **Notification** hook because it needs
input or permission. Working, idle/done, `new`, shell, and exited tabs are all
excluded: `requires_response` is the only state that should chase you.

Note that Claude Code's Notification hook doubles as an idle timer — it also
fires ~60s after a turn ends with a "Claude is waiting for your input" message,
even when Claude asked nothing. That idle nudge is filtered out in
`hook_server::route_message` (it inspects the forwarded notification `message`),
so a finished-but-unanswered session no longer falsely lands in this strip.

Each row shows the pulsing attention icon, the tab name, its folder (with the
folder's accent dot), and — since a `requires_response` tab's `statusChangedAt`
is stamped by `tabsReducer`'s `status` action (`src/lib/tabs.ts`) — how long it's
been waiting (`5m`, `2h`, via `SidebarFooter`'s `formatDuration`), so "waiting
10s" and "waiting 2h" don't look identical. The header carries a live count
badge. Clicking a row selects that tab (same `onSelectTab` path as a normal tab
row), which also closes History/Settings.

## Where it lives

`AttentionStrip` (in `Sidebar.tsx`) renders in the expanded sidebar, fixed
(`shrink-0`) between the Pinned strip above and the scrolling project list
below, so it stays put while you scroll folders. Its own list caps at
`max-h-[38vh]` and scrolls internally if the queue is ever long. When nothing
is waiting the component returns `null`, so it collapses to zero height and
costs no space — the empty state *is* the absence of the strip.

## Collapsed rail

The 11px icon rail already shows each tab's own status icon (the pulsing
`MessageCircle`), but with the sidebar itself collapsed there's no strip to
scan. The rail's "Show sidebar" toggle carries a small count badge
(`waitingCount` in `Sidebar`, same `requires_response`+`!exited` filter as the
strip) when the queue isn't empty — enough to know to expand, without
duplicating the strip's row-by-row detail into the 11px rail.

A collapsed *folder* (its own accordion, not the sidebar rail) gets the same
treatment one level down: see [Project folders](terminals.md#project-folders)
for the per-folder activity card and status glyph.

## "Just finished"

A second, `success`-green strip below Waiting-on-you: every Claude tab whose
last transition was `working` → `idle` and hasn't been looked at since
(`Tab.justFinished`, set by `tabsReducer`'s `status` case only on that specific
transition — reaching `idle` from `new` or `requires_response` doesn't count,
since those aren't "was busy, now isn't"). `idle` alone was rejected in an
earlier pass here for exactly this reason: it's Claude's resting state after
*any* turn, so without the working→idle condition the strip would list nearly
every Claude tab. "Seen" is simply selecting the tab — `tabsReducer`'s `select`
case clears `justFinished` for whatever it activates — so no separate dismiss
control was needed; in normal use a session that goes back to `working` clears
its own entry too. No pulse on this one: design.md's pulsing icons are reserved
for things waiting on a human, and nothing here is.

## Files

- `src/components/Sidebar.tsx` — `AttentionStrip` and `JustFinishedStrip`
  components + their render slots in the expanded sidebar; the collapsed
  rail's badge and a folder's own activity card/glyph (`folderActivity`,
  `ProjectCard`).
- `src/lib/tabs.ts` — `statusChangedAt` and `justFinished` bookkeeping in the
  `status` and `select` reducer cases.
- `src/lib/tabs.test.ts` — `statusChangedAt` stamped on every transition,
  `justFinished` set only on working→idle and cleared by a subsequent status
  change or by `select`.
- `src/components/Sidebar.test.tsx` — strip tests: absent when nothing
  waits/nothing just finished, lists the right tabs across folders with a
  count and elapsed time, excludes shells/exited, selects a tab when its strip
  row is clicked, the collapsed-rail badge, and the folder activity tint.
