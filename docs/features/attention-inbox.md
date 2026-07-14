# “Waiting on you” inbox

A pinned strip at the top of the sidebar that gathers every Claude session which
**stopped and is blocked on you** — one place to answer the "which of my twelve
terminals needs me?" question without hunting through collapsed folder cards.

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

Each row shows the pulsing attention icon, the tab name, and its folder (with the
folder's accent dot), so a waiting session tells you *where* it is at a glance.
The header carries a live count badge. Clicking a row selects that tab (same
`onSelectTab` path as a normal tab row), which also closes History/Settings.

## Where it lives

`AttentionStrip` (in `Sidebar.tsx`) renders in the expanded sidebar, **pinned
between the header and the scrolling project list** (`shrink-0`) so it stays put
while you scroll folders. Its own list caps at `max-h-[38vh]` and scrolls
internally if the queue is ever long. When nothing is waiting the component
returns `null`, so it collapses to zero height and costs no space — the empty
state *is* the absence of the strip.

It needs no new props: `Sidebar` already receives `tabs`, `projects`,
`activeTabId`, `showHistory`, and `onSelectTab`, and the strip derives its list
from `tabs`.

## Not included (yet)

- **Collapsed rail.** The 11px icon rail already shows each tab's status icon
  (the pulsing `MessageCircle`), so the strip is expanded-mode only for now; a
  count badge on the collapsed rail is a possible follow-up.
- **A "just finished" section.** `idle` is Claude's resting state after *any*
  turn, not an unread "done" signal, so listing it would surface nearly every
  Claude tab. A real done/unseen queue needs seen-tracking — left for later.
- Desktop notifications / taskbar badge for the same queue — see the roadmap in
  the feature-exploration artifact; a separate follow-up.

## Files

- `src/components/Sidebar.tsx` — `AttentionStrip` component + its render slot in
  the expanded sidebar.
- `src/components/Sidebar.test.tsx` — strip tests: absent when nothing waits,
  lists `requires_response` Claude tabs across folders with a count, excludes
  shells/exited, and selects a tab when its strip row is clicked.
