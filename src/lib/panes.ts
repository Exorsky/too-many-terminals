/**
 * The pane grid: up to four panes on a 2×2 of cells, each with its own strip
 * of tabs.
 *
 * The v0.24 geometry, with the thing that was actually wrong about it fixed.
 * Back then a tab was a **session**, which meant the sidebar's list of sessions
 * appeared a second time above every terminal — the duplicate navigation the
 * redesign set out to remove. Here a tab is a **thing you put on the
 * workspace**: one of a session's tools, or a file. The sidebar stays the only
 * list of sessions; the strip is how you arrange what you're looking at, and
 * every tab in it can be dragged into another pane or onto an edge to split.
 *
 * Two invariants hold at all times: **every cell is filled**, and **every
 * pane's cells form a rectangle**. Everything else falls out of them.
 *
 * Pure layout algebra: no React, no Tauri, so `tabsReducer` can call it and the
 * tests can enumerate every reachable shape. See docs/features/panes.md.
 */
import type { SessionTool } from '@/types';

/** What a tab can be. */
export type PaneContent =
  | { kind: 'session'; sessionId: string; tool: SessionTool }
  | { kind: 'file'; dir: string; path: string };

export interface Pane {
  id: string;
  /** This pane's tabs, in strip order. Empty means it shows Home. */
  contents: PaneContent[];
  /** `contentKey` of the tab on top. Keyed rather than indexed, so a tab
   *  leaving the strip can't silently promote whoever slid into its index. */
  activeKey: string | null;
}

/** A tab as one comparable value, so "where is this" is a string compare.
 *
 *  A session appears under as many keys as it has tools — which is what lets
 *  Claude and its own shell be two tabs in two panes at once. Two tabs can
 *  never share a key: one terminal has one DOM node, and painting it in two
 *  places would blank one of them. */
export function contentKey(content: PaneContent | null | undefined): string | null {
  if (!content) return null;
  return content.kind === 'session'
    ? `session:${content.sessionId}:${content.tool}`
    : `file:${content.path}`;
}

export function sessionContent(sessionId: string, tool: SessionTool = 'claude'): PaneContent {
  return { kind: 'session', sessionId, tool };
}

/** Which pane owns each cell. A pane owning several cells spans them. */
export type Grid = [[string, string], [string, string]];

export type Edge = 'left' | 'right' | 'top' | 'bottom';

export interface Layout {
  panes: Pane[];
  grid: Grid;
  /** The pane that takes your keystrokes. */
  focusedPaneId: string;
  /** Where the shared column and row seams sit, 0–1. */
  colFrac: number;
  rowFrac: number;
}

export const MIN_FRAC = 0.15;
export const MAX_FRAC = 0.85;

let paneSeq = 0;
function nextPaneId(): string {
  paneSeq += 1;
  return `pane-${paneSeq}`;
}

export function singlePaneLayout(contents: PaneContent[] = []): Layout {
  const id = nextPaneId();
  return {
    panes: [{ id, contents, activeKey: contentKey(contents[0]) }],
    grid: [[id, id], [id, id]],
    focusedPaneId: id,
    colFrac: 0.5,
    rowFrac: 0.5,
  };
}

export const initialLayout: Layout = singlePaneLayout();

/** The tab on top of a pane. Falls back to the first, so a stale `activeKey`
 *  shows something rather than an empty pane over a populated strip. */
export function activeContent(pane: Pane | undefined): PaneContent | null {
  if (!pane) return null;
  return pane.contents.find((c) => contentKey(c) === pane.activeKey) ?? pane.contents[0] ?? null;
}

/** Where a pane sits on the grid, as a CSS-grid-shaped rectangle. */
export function paneRect(grid: Grid, paneId: string): { row: number; col: number; rowSpan: number; colSpan: number } {
  let row = 2;
  let col = 2;
  let lastRow = -1;
  let lastCol = -1;
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 2; c++) {
      if (grid[r][c] !== paneId) continue;
      row = Math.min(row, r);
      col = Math.min(col, c);
      lastRow = Math.max(lastRow, r);
      lastCol = Math.max(lastCol, c);
    }
  }
  if (lastRow === -1) return { row: 0, col: 0, rowSpan: 0, colSpan: 0 };
  return { row, col, rowSpan: lastRow - row + 1, colSpan: lastCol - col + 1 };
}

/** Every pane on the grid, in reading order. */
export function panesOf(grid: Grid): string[] {
  const seen: string[] = [];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 2; c++) {
      if (!seen.includes(grid[r][c])) seen.push(grid[r][c]);
    }
  }
  return seen;
}

export function findPane(layout: Layout, paneId: string): Pane | undefined {
  return layout.panes.find((p) => p.id === paneId);
}

export function focusedPane(layout: Layout): Pane {
  return findPane(layout, layout.focusedPaneId) ?? layout.panes[0];
}

/** The pane holding this exact tab, if any. */
export function paneOfContent(layout: Layout, content: PaneContent): Pane | undefined {
  const key = contentKey(content);
  return layout.panes.find((p) => p.contents.some((c) => contentKey(c) === key));
}

/** Any pane holding a tab of this session, whichever tool. */
export function paneOfSession(layout: Layout, sessionId: string): Pane | undefined {
  return layout.panes.find((p) =>
    p.contents.some((c) => c.kind === 'session' && c.sessionId === sessionId));
}

/** Every session with a terminal actually painted — the **active** tab of each
 *  pane, not every tab. A background tab keeps its xterm buffer but needs no
 *  live process behind it, which is what auto-sleep keys off. */
export function visibleSessionIds(layout: Layout): Set<string> {
  const ids = new Set<string>();
  for (const id of panesOf(layout.grid)) {
    const content = activeContent(findPane(layout, id));
    if (content?.kind === 'session') ids.add(content.sessionId);
  }
  return ids;
}

/** Which halves of each seam actually divide something. An L-shaped grid
 *  splits only one of its rows, so the vertical seam has to stop at the row
 *  that isn't split (and vice versa). */
export function seamBands(grid: Grid): { vertical: [boolean, boolean]; horizontal: [boolean, boolean] } {
  return {
    vertical: [grid[0][0] !== grid[0][1], grid[1][0] !== grid[1][1]],
    horizontal: [grid[0][0] !== grid[1][0], grid[0][1] !== grid[1][1]],
  };
}

// --- mutating the layout (all pure; every one returns a fresh Layout) ---

function cloneGrid(grid: Grid): Grid {
  return [[grid[0][0], grid[0][1]], [grid[1][0], grid[1][1]]];
}

function cloneLayout(layout: Layout): Layout {
  return {
    ...layout,
    panes: layout.panes.map((p) => ({ ...p, contents: [...p.contents] })),
    grid: cloneGrid(layout.grid),
  };
}

function cellsOf(grid: Grid, paneId: string): [number, number][] {
  const out: [number, number][] = [];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 2; c++) if (grid[r][c] === paneId) out.push([r, c]);
  }
  return out;
}

/** Do these cells form a solid rectangle? Only valid because coordinates are
 *  0 or 1 and every cell is distinct — which lets "distinct rows × distinct
 *  cols === count" stand in for a real region check, in one line. */
function isRect(cells: [number, number][]): boolean {
  const rows = new Set(cells.map((c) => c[0]));
  const cols = new Set(cells.map((c) => c[1]));
  return rows.size * cols.size === cells.length;
}

/** Try to hand every cell of a dying pane to its neighbour along one axis:
 *  'row' takes the pane beside it, 'col' the pane above/below. Returns null
 *  when that axis can't work — either the mirror cell is dying too, or the
 *  result would leave some pane L-shaped.
 *
 *  Two axes are needed rather than one absorbing neighbour: [[A,B],[C,C]]
 *  losing C has no single pane that can take the whole bottom row, because A
 *  and B must *both* grow down into [[A,B],[A,B]]. */
function fillAlong(grid: Grid, dead: [number, number][], axis: 'row' | 'col', dying: string): Grid | null {
  const next = cloneGrid(grid);
  for (const [r, c] of dead) {
    const donor = axis === 'row' ? grid[r][c === 0 ? 1 : 0] : grid[r === 0 ? 1 : 0][c];
    if (donor === dying) return null;
    next[r][c] = donor;
  }
  for (const id of panesOf(next)) {
    if (!isRect(cellsOf(next, id))) return null;
  }
  return next;
}

/** Pull a tab out of whichever strip holds it, promoting its neighbour —
 *  "next, else previous", so closing a tab and dragging one away leave the
 *  strip in the same state. */
function takeContent(layout: Layout, key: string): Layout {
  const next = cloneLayout(layout);
  for (const pane of next.panes) {
    const at = pane.contents.findIndex((c) => contentKey(c) === key);
    if (at === -1) continue;
    pane.contents.splice(at, 1);
    if (pane.activeKey === key) {
      pane.activeKey = contentKey(pane.contents[at] ?? pane.contents[at - 1]);
    }
  }
  return next;
}

/** Remove a pane, handing its cells to the neighbours that can take them
 *  without breaking the rectangle invariant. A fill always exists whenever two
 *  or more panes share a 2×2, so this never leaves a hole.
 *
 *  At one pane it empties rather than removes: the last pane survives holding
 *  nothing and renders Home, which is the app's resting state anyway. That is
 *  why there is no "empty layout" branch anywhere. */
export function closePane(layout: Layout, paneId: string): Layout {
  const ids = panesOf(layout.grid);
  if (!ids.includes(paneId)) return layout;
  if (ids.length <= 1) {
    return {
      ...layout,
      panes: layout.panes.map((p) => (p.id === paneId ? { ...p, contents: [], activeKey: null } : p)),
    };
  }

  const dead = cellsOf(layout.grid, paneId);
  // Row first, so a full 2×2 losing A becomes [[B,B],[C,D]] rather than
  // [[C,B],[C,D]] — deterministic, and it matches the reading order the split
  // was most likely made in.
  const grid = fillAlong(layout.grid, dead, 'row', paneId)
    ?? fillAlong(layout.grid, dead, 'col', paneId);
  if (!grid) return layout;

  const [r, c] = dead[0];
  return {
    ...layout,
    panes: layout.panes.filter((p) => p.id !== paneId),
    grid,
    focusedPaneId: layout.focusedPaneId === paneId ? grid[r][c] : layout.focusedPaneId,
  };
}

/** Collapse every pane left with no tabs, except the last one. Run after any
 *  mutation that can empty a strip. */
function prune(layout: Layout): Layout {
  let next = layout;
  // At most four panes, so at most three can go; the bound is a belt-and-braces
  // guard against a future model change turning this into a spin.
  for (let i = 0; i < 4; i++) {
    const ids = panesOf(next.grid);
    if (ids.length <= 1) break;
    const empty = ids.find((id) => findPane(next, id)?.contents.length === 0);
    if (!empty) break;
    const after = closePane(next, empty);
    if (after === next) break;
    next = after;
  }
  if (!findPane(next, next.focusedPaneId)) {
    next = { ...next, focusedPaneId: panesOf(next.grid)[0] };
  }
  return next;
}

/** Put `content` in `paneId`'s strip and bring it to the front.
 *
 *  Moves rather than copies: a tab lives in exactly one strip, because the
 *  terminal behind it has exactly one DOM node. `beforeKey` drops it at a
 *  position, for a reorder inside a strip or a drop between two tabs. */
export function addToPane(
  layout: Layout,
  paneId: string,
  content: PaneContent,
  beforeKey?: string | null,
): Layout {
  if (!findPane(layout, paneId)) return layout;
  const key = contentKey(content)!;
  const next = takeContent(layout, key);
  const pane = findPane(next, paneId);
  if (!pane) return layout;

  const at = beforeKey ? pane.contents.findIndex((c) => contentKey(c) === beforeKey) : -1;
  pane.contents.splice(at === -1 ? pane.contents.length : at, 0, content);
  pane.activeKey = key;
  next.focusedPaneId = paneId;
  return prune(next);
}

/** Split `paneId` along `edge`, putting `content` alone in the new pane.
 *
 *  A vertical split needs the pane to span both columns, a horizontal one both
 *  rows. When there's no room the split **degrades to a plain move** into that
 *  pane's strip — which is what keeps a fifth split, or a sideways split of an
 *  already-narrow pane, from being an error the UI has to explain. */
export function splitPane(layout: Layout, paneId: string, edge: Edge, content: PaneContent): Layout {
  const rect = paneRect(layout.grid, paneId);
  if (rect.rowSpan === 0) return layout;

  const vertical = edge === 'left' || edge === 'right';
  if (vertical ? rect.colSpan < 2 : rect.rowSpan < 2) {
    return addToPane(layout, paneId, content);
  }

  const key = contentKey(content)!;
  const next = takeContent(layout, key);
  const newId = nextPaneId();
  const grid = next.grid;
  // The new pane takes the half the edge points at; the old pane keeps the rest.
  for (let r = rect.row; r < rect.row + rect.rowSpan; r++) {
    for (let c = rect.col; c < rect.col + rect.colSpan; c++) {
      const takes = vertical
        ? (edge === 'right' ? c === rect.col + 1 : c === rect.col)
        : (edge === 'bottom' ? r === rect.row + 1 : r === rect.row);
      if (takes) grid[r][c] = newId;
    }
  }

  next.panes.push({ id: newId, contents: [content], activeKey: key });
  next.focusedPaneId = newId;
  return prune(next);
}

/** Bring a tab already in `paneId` to the front. */
export function activateInPane(layout: Layout, paneId: string, key: string): Layout {
  const pane = findPane(layout, paneId);
  if (!pane || !pane.contents.some((c) => contentKey(c) === key)) return layout;
  return {
    ...layout,
    panes: layout.panes.map((p) => (p.id === paneId ? { ...p, activeKey: key } : p)),
    focusedPaneId: paneId,
  };
}

/** Close one tab, wherever it is. The pane collapses if that was its last. */
export function closeContent(layout: Layout, key: string): Layout {
  return prune(takeContent(layout, key));
}

/** A session is gone (closed or archived): drop every tab of it.
 *
 *  Goes through `takeContent` one tab at a time rather than filtering in
 *  place, so closing a session promotes the same neighbour that closing its
 *  tab by hand would. One rule for what a strip does when a tab leaves. */
export function removeSession(layout: Layout, sessionId: string): Layout {
  const keys = layout.panes.flatMap((p) => p.contents
    .filter((c) => c.kind === 'session' && c.sessionId === sessionId)
    .map((c) => contentKey(c)!));
  if (keys.length === 0) return layout;
  return prune(keys.reduce(takeContent, layout));
}

export function focusPane(layout: Layout, paneId: string): Layout {
  if (!findPane(layout, paneId)) return layout;
  return { ...layout, focusedPaneId: paneId };
}

export function resizeSeam(layout: Layout, axis: 'col' | 'row', frac: number): Layout {
  const clamped = Math.min(MAX_FRAC, Math.max(MIN_FRAC, frac));
  return axis === 'col' ? { ...layout, colFrac: clamped } : { ...layout, rowFrac: clamped };
}

/** Put `content` on the workspace without being told where: as a tab of the
 *  focused pane. Already open? Bring it to the front where it is, rather than
 *  dragging it across the screen into the pane you happen to be in. */
export function addToWorkspace(layout: Layout, content: PaneContent): Layout {
  const existing = paneOfContent(layout, content);
  if (existing) return activateInPane(layout, existing.id, contentKey(content)!);
  return addToPane(layout, layout.focusedPaneId, content);
}

/** Open a session — what clicking a sidebar row does. An open tab for it comes
 *  to the front wherever it lives; otherwise its Claude view becomes a tab of
 *  the focused pane. */
export function activateSession(layout: Layout, sessionId: string): Layout {
  const pane = paneOfSession(layout, sessionId);
  if (pane) {
    const tab = pane.contents.find((c) => c.kind === 'session' && c.sessionId === sessionId);
    return activateInPane(layout, pane.id, contentKey(tab)!);
  }
  return addToPane(layout, layout.focusedPaneId, sessionContent(sessionId));
}
