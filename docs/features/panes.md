# Panes

Up to four terminals on screen at once, each with its own tab strip, laid out on a
2×2 grid you resize by dragging the seams. Drag a tab — or a file out of the
explorer — onto the edge of a pane to split it.

## The model

`src/lib/panes.ts` is a **2×2 array of cells** plus two fractions. Each cell names
the pane that owns it; a pane owning several cells spans them.

```
one pane   2 across   2 down     three (L)   2×2
[[A,A]     [[A,B]     [[A,A]     [[A,B]      [[A,B]
 [A,A]]     [A,B]]     [B,B]]     [C,C]]      [C,D]]
```

Two invariants hold at all times: **every cell is filled**, and **every pane's
cells form a rectangle**. Everything else falls out of them.

This is deliberately *not* a recursive pane tree. Four cells and two numbers reach
every shape above, and buy three things a tree doesn't:

- **"At most four panes" needs no check anywhere.** There are four cells. A fifth
  split has nowhere to go, so `splitPane` falls through to `movePaneTab` and the
  tab simply opens in that pane's strip. The same fallback covers splitting an
  already-one-cell-wide pane sideways. There is no error state to explain and no
  disabled-looking drop zone.
- **Collapse is total.** No per-shape decision table — see below.
- **The shape is the CSS.** Panes are grid items placed from `paneRect`; there is
  no layout arithmetic in JS, and nothing to keep in sync on resize.

The cost is that **both rows share one vertical seam** and both columns share one
horizontal seam. That is what "grid" means, and it is the difference from VS Code,
whose rows split at independent positions because it is a tree. Marked in the
source with a `ponytail:` comment — per-row seams need the tree model, which is a
different feature.

### Closing a pane

When a pane dies its cells go to its neighbours, chosen by trying one axis and
then the other:

- **Row first** — the pane beside it. So `[[A,B],[C,D]]` losing A becomes
  `[[B,B],[C,D]]`, deterministically, matching the reading order the split was
  most likely made in.
- **Then column** — the pane above or below.

An axis is rejected if the mirror cell is also dying, or if the result would leave
some pane L-shaped. Two axes are needed rather than one absorbing neighbour
because `[[A,B],[C,C]]` losing C has no single pane that can take the whole bottom
row: A and B must *both* grow down into `[[A,B],[A,B]]`.

`panes.test.ts` pins this by enumerating every layout reachable in three splits
and, for each, removing every pane and asserting the grid stays well-formed. That
sweep is what caught the L-shape case.

**The last pane never collapses.** It survives with no tabs and Home covers the
grid — which is exactly the app's existing resting state, so there is no "empty
layout" branch anywhere.

## Splitting

Two ways in:

- **Drag** a tab onto a pane. Five zones: the four edges split, the centre moves
  the tab into that pane's strip. Nearest edge wins inside the outer quarter, so
  corners resolve to whichever edge they are actually closer to.
- **Right-click a tab** → Split right / Split down. An action on one item that
  only sometimes applies belongs in that item's context menu rather than another
  always-visible hover icon (see [design.md](../design.md)). The menu hides a
  split the pane has no room for, so it never offers something that would quietly
  become a move.

Files drag too, from the tree and from search results. The payload carries the
project folder as well as the path, because a file tab needs a cwd and the drop
target can't work out which project a path belongs to.

Drops are typed — `application/x-tmt-tab` and `application/x-tmt-file`. The strip
used to reject any drag it hadn't started itself, because a bare `text/plain`
payload is indistinguishable from a text selection. `dataTransfer.types` is
readable during `dragover` (where `getData` is blocked), so a typed payload is
what lets a tab cross panes.

The drop zones **only exist while a drag is in flight**, tracked by one
capture-phase listener on the window. Otherwise they would sit between the pointer
and the terminal.

## Focus

With four terminals on screen, the thing that matters most is which one takes your
next keystroke — in VS Code a misplaced keystroke lands in an undoable text
buffer, here it lands in a live Claude session.

So focus is marked by **subtraction**: the active tab's 2px cyan rule renders only
in the focused pane, and unfocused strips drop to 60%. An unfocused pane keeps its
notch, so you can still read what it is showing; it just gives up the accent.
Nothing is added, and none of the reserved status colours
(success/warning/attention/destructive) are borrowed.

Clicking anywhere in a pane focuses it (`onMouseDownCapture`), and `term.focus()`
is gated on that — without the gate, four panes fight over the keyboard on every
attach.

## Terminals moving between panes

An xterm instance lives in `terminalCache`, outside React, and pty output is
routed straight to it. So a tab dragged into another pane remounts its
`<Terminal>` into a new container and `term.open()` re-parents xterm's existing
element — buffer, scrollback and pty untouched. The cost of a move is one
`open()`.

`Terminal` keys `attachedRef` on **the container**, not its own tab id (which is a
prop that never changes and so could never invalidate). A tab can be in exactly
one pane at a time: the DOM node is singular.

## Resizing

At most two seams ever — one vertical at `colFrac`, one horizontal at `rowFrac`,
both clamped to 0.15–0.85. They are absolutely positioned siblings of the grid
items, so they never perturb track sizing. In an L-shape only one row is actually
split, so `seamBands` stops the vertical seam at the row that isn't.

`useDragValue` is the one drag-to-resize hook, used by both grid seams and the
file explorer's — it was the same twenty lines of window-tracked `mousemove`
three times over. Tracking on `window` rather than the handle is what keeps a fast
drag from outrunning the 1px line.

**Every resize reflows every visible terminal**: `ResizeObserver` →
`fitAddon.fit()` → `pty_resize`, and xterm rewraps every line it is showing. A
seam drag is that at pointer rate, times up to four panes. `Terminal` backs its
debounce off from 50ms to 250ms while a seam is live — longer rather than skipped,
so the trailing call still lands and nothing needs re-fitting on mouseup.

Up to four visible panes also means up to four live WebGL2 contexts. Hidden
terminals still release theirs (see [architecture.md](../architecture.md)).

## What isn't here

- **Layout isn't persisted.** Restart reopens your tabs in a single pane. Restored
  tabs are minted with fresh uuids, so a saved layout would have to reference them
  by index — worth doing, not done.
- **Transcripts are still a view mode, not a tab kind.** The Preview/Split control
  in the strip is a separate axis from the pane grid: it splits *within* a pane.
  Making a transcript its own tab kind would delete that whole mechanism and let
  you drop a transcript into any pane, but it changes shipped UI, so it's its own
  change. The transcript ratio is currently shared by every pane
  (`ponytail:` marked).
- **Home has no strip.** Home, History, Settings and the session reader cover the
  grid rather than living in a pane. The grid is hidden, not unmounted, so coming
  back doesn't re-attach and rewrap every terminal.
