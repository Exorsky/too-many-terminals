# The session ledger

Live counts in the sidebar's top row — one chip for each cross-cutting
collection that isn't empty: **waiting on you**, **running**, **just finished**,
**pinned**. They answer "which of my twelve terminals needs me?" without
rendering a single session row, and clicking one filters the list instead of
duplicating it.

They share that row with the filter field (`SidebarLens`), because both do the
same job to the same list — narrow it. Which folder to show is the *other*
question, and lives in its own row of [folder pills](terminals.md#folders-are-a-filter-not-a-heading)
below.

The ledger is the payoff of a simple idea: the app already knows each Claude
tab's live state from Claude Code's hooks (see
[tab-status-and-naming.md](tab-status-and-naming.md)); this collects those states
across every folder instead of leaving each one as a dot on a single row.

## What replaced what

This used to be three stacked strips — Pinned, "Waiting on you", "Just finished"
— each with its own header, count badge and internally-scrolling list, pinned
above the folder tree. The strips worked at three or four sessions and fell over
at twenty, for one reason: **a session in a strip also rendered in its folder
below**, so n sessions cost up to 2n rows, and the folder list (the thing you
actually navigate) was squeezed into whatever the three capped strips left. With
all three non-empty they could claim the entire panel.

The chips carry the same information in ~30px that never scrolls, and the
filtered view *is* the old strip — given the full sidebar height instead of a
`max-h-[38vh]` box stacked on top of the list it repeated.

## The buckets

`bucketsOf(tab)` in `Sidebar.tsx` is the single definition, read by the ledger
counts and the status filter. A tab can be in two at once (a pinned session
that's also waiting on you).

Note what buckets are *not* used for: the list's own
[sort order](terminals.md#order) comes from `segOf()`, a separate function that
mirrors the status vocabulary directly. Buckets answer "show me what just
finished"; `segOf` answers "what is this session doing". Deriving one from the
other is what once ranked a plain `idle` session down with the sleepers.

| Bucket | Condition | Color |
|---|---|---|
| `waiting` | `kind === 'claude'`, `status === 'requires_response'` | `attention`, pulsing |
| `working` | `kind === 'claude'`, `status === 'working'` | `warning`, spinning |
| `done` | `kind === 'claude'`, `justFinished` | `success` |
| `pinned` | `Tab.pinned` — shells included | `primary` |

Exited tabs are in no bucket at all. `dormant` suppresses `waiting`/`working`
the same way `TabIndicator` draws a moon over them: there's no live process
behind that status, so counting it as running would contradict the row's own
glyph. Every color is the one that status already owns — no new hues (see
[design.md](../design.md#status-vocabulary)).

**`requires_response`** means Claude fired its **Notification** hook because it
needs input or permission. That hook doubles as an idle timer — it also fires
~60s after a turn ends with a "Claude is waiting for your input" message, even
when Claude asked nothing. That idle nudge is filtered out in
`hook_server::route_message` (it inspects the forwarded notification `message`),
so a finished-but-unanswered session doesn't land in the waiting count.

**`justFinished`** is set by `tabsReducer`'s `status` case only on the specific
`working` → `idle` transition — reaching `idle` from `new` or
`requires_response` doesn't count, since those aren't "was busy, now isn't".
`idle` alone was rejected in an earlier pass for exactly that reason: it's
Claude's resting state after *any* turn. "Seen" is simply selecting the tab —
`tabsReducer`'s `select` case clears `justFinished` — so no dismiss control was
needed. Nothing in this bucket pulses: pulsing is reserved for things waiting on
a human, and a finished session is reporting, not asking.

## Filtering the list

Clicking a chip, typing in the filter field, or picking a folder pill all narrow
the same list — they compose rather than replace each other, so "running, in
this folder, matching auth" is three clicks and a word. Rows keep their normal
shape and behaviour; only which ones are present changes.

Whatever is active is spelled out in one line above the list — folder, then
bucket, then quoted query, joined by `·`, with the result count. That line is
not decoration: a folder pill can scroll out of its own wrapped row, and a list
that silently got shorter with no stated reason is the bug this fixes. When
nothing matches, the same line's wording turns into the empty state, with a
**Show all sessions** button that clears all three at once.

All three are ephemeral, deliberately. A filter is a momentary lens on the list,
not a workspace setting you'd want restored days later next to a stale count.
The one piece of state that does persist is which folders are open and in what
order — something you arranged on purpose.

## Collapsed rail

With the sidebar itself collapsed to the 44px icon rail there's no list to
filter, so `CollapsedLedger` shows the same counts stacked vertically and
read-only, under the "Show sidebar" toggle — enough to know whether to expand.
The rail used to badge only the waiting count, which meant "3 just finished" was
invisible until you opened the sidebar back up.

## Files

- `src/components/Sidebar.tsx` — `bucketsOf` (the bucket definition),
  `SidebarLens` (filter field + chips), `CollapsedLedger`, `matchesQuery`, and
  the `lensParts` line that names whatever is active.
- `src/lib/tabs.ts` — `statusChangedAt` and `justFinished` bookkeeping in the
  `status` and `select` reducer cases.
- `src/lib/tabs.test.ts` — `statusChangedAt` stamped on every transition,
  `justFinished` set only on working→idle and cleared by a subsequent status
  change or by `select`.
- `src/components/Sidebar.test.tsx` — `describe('session ledger')`,
  `describe('bucketsOf')`, `describe('filter field')`, `describe('folder pills')`:
  chips appear only while non-zero, counts are right across folders,
  exited/dormant/shell exclusions, a chip narrows the list and clicking it again
  restores it, a filter composes with an active bucket, the lens line names the
  selected folder, and the collapsed rail's stacked counts.
