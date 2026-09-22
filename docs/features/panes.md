# Panes (removed in v0.25)

> **This feature no longer exists.** The 2×2 pane grid, its per-pane tab strips,
> and drag-to-split were removed when the app's information architecture was
> rebuilt around one selected session. This page is kept because the reasoning
> is worth having, not because the code is.

## What it was

Up to four terminals on screen at once, each with its own tab strip, on a 2×2 grid
resized by dragging the seams. `src/lib/panes.ts` held a 2×2 array of cells plus
two fractions; a pane owning several cells spanned them, under two invariants —
every cell filled, every pane's cells forming a rectangle.

```
one pane   2 across   2 down     three (L)   2×2
[[A,A]     [[A,B]     [[A,A]     [[A,B]      [[A,B]
 [A,A]]     [A,B]]     [B,B]]     [C,C]]      [C,D]]
```

It worked, it was well covered by tests, and dragging a tab onto a pane edge to
split it was genuinely good.

## Why it went

It made a session appear in two persistent places at once — the sidebar list *and*
a tab strip — on top of the project rail that also listed sessions. With a dozen
sessions open, "where am I?" and "which one needs me?" had no quick answer, because
four surfaces were competing to give it.

The workspace tab strip had to become the session's **tools** (Claude / Shell /
Files) rather than a list of sessions. Those two meanings cannot share one strip:
`tab = session` and `tab = a view of this session` teach opposite mental models,
and every user who learns one is wrong about the other.

Given the choice, the tools won. A grid of terminals is a power feature; knowing
which session you're in is the product.

## What survives

- **Terminal ↔ transcript split.** The Preview/Split controls are untouched — that
  is a split *within* a session, which fits the new model exactly.
- **Files tree ↔ editor split**, inside the Files tool.
- `Seam.tsx`, the draggable hairline, now used by the sidebar and those two.

## If it comes back

It should come back as a **second session** shown beside the first — "compare these
two sessions" — with no tab strip and no drag-to-split, not as a general pane
manager. That keeps one sidebar as the only list of sessions, which is the rule
that was actually being broken. Start from `git show v0.24.0:src/lib/panes.ts`.
