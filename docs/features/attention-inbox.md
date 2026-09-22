# Status, and what happened to the ledger

> **The ledger chips were removed in v0.25.** "Inbox" now means something else
> entirely — sessions filed under no project. See
> [scratch-sessions.md](scratch-sessions.md).

## What the ledger was

Four live counts in a band above the session list — **waiting on you**, **running**,
**just finished**, **pinned** — each clickable to filter the list. Plus, in compact
mode, a 4px `Spectrum` bar showing the proportion of sessions in each state.

It answered "which of my twelve terminals needs me?" without rendering a session
row, which was a real problem worth solving.

## Why it went

It was the third representation of the same information. A session that needed you
carried an orange pulsing glyph on its row, an orange spine down the row's left
edge, a share of the orange spectrum segment, and a count in the orange chip —
four marks, one fact. Add the folder rail's own badges and the tab strip's icons
and a busy workspace was mostly status decoration.

The redesign's rule: **a status appears once in the sidebar and once in the active
session's header, and nowhere else.**

## The status vocabulary now

`sessionState` in `src/lib/sessions.ts` is the single definition. Four states, and
three of them are deliberately quiet:

| State | Colour | Means |
|---|---|---|
| `running` | green (`--success`) | Claude is working |
| `attention` | yellow (`--warning`) | it's asking you something |
| `idle` | very faint grey | alive, nothing happening |
| `muted` | barely-there grey | asleep, exited, archived, or never started |

A 6px dot, no animation, no icon, no second glyph. Colour is spent on the two
states you'd change your behaviour for; the other two recede, which is the whole
point — in a list of twenty sessions, the two green dots and one yellow one are
found instantly *because* the other seventeen say nothing.

`sessionState` never reports `running` for a session with no live process behind
it. A dormant or exited session's last reported status is history, and a row that
claims to be working while nothing happens is a row you stop trusting.

## Finding things now

- **Counts** — the Inbox group and each project carry a plain count; the To-Do nav
  item carries the number of open tasks. Numbers, not coloured chips.
- **Filtering by status** — the [command palette](command-palette.md) still takes
  status words: `needs`, `working`, `done`.
- **Narrowing the list** — the sidebar's search field, by name, project or path.
