/** The window manager's layout model: up to four panes on a 2x2 grid of cells.
 *
 *  A pane owns one or more *cells*, and its cells always form a rectangle — that
 *  single invariant is what the whole model rests on. The five reachable shapes:
 *
 *    one pane   2 across   2 down     three (L)   2x2
 *    [[A,A]     [[A,B]     [[A,A]     [[A,B]      [[A,B]
 *     [A,A]]     [A,B]]     [B,B]]     [C,C]]      [C,D]]
 *
 *  Deliberately *not* a recursive pane tree. Four cells plus two fractions covers
 *  every shape above, makes "at most four panes" true by construction (there is no
 *  cap to check — a fifth split has nowhere to go), and keeps `collapsePane` total
 *  instead of a per-shape decision table. The cost is that both rows share one
 *  vertical seam, which is what "grid" means.
 *
 *  ponytail: one shared column seam. Per-row column seams need the tree model,
 *  which is a different feature with a much larger surface.
 */

/** One pane: its own tab strip, in its own order, with its own active tab. */
export interface Pane {
  id: string;
  /** The tabs docked in this pane's strip, in strip order. */
  tabIds: string[];
  /** Which of `tabIds` this pane is showing. Null only for the last pane when
   *  every tab has been closed — that's the Home resting state. */
  activeTabId: string | null;
}

/** `grid[row][col]` — which pane owns each of the four cells. Never empty: every
 *  cell always names a live pane. */
export type Grid = [[string, string], [string, string]];

/** Which edge of a pane a drop landed on. `'center'` isn't an edge — it means
 *  "put it in this pane's strip" rather than "split". */
export type Edge = 'left' | 'right' | 'top' | 'bottom';

export interface Layout {
  panes: Pane[];
  grid: Grid;
  /** The pane that has the keyboard. Always names a pane present in `grid`. */
  focusedPaneId: string;
  /** The one vertical seam, as a fraction of the width. */
  colFrac: number;
  /** The one horizontal seam, as a fraction of the height. */
  rowFrac: number;
}

/** Both seams stop here, so a pane squeezed to the edge still shows its strip
 *  and enough columns for a terminal to be worth having. */
export const MIN_FRAC = 0.15;
export const MAX_FRAC = 0.85;

let paneSeq = 0;

/** Pane ids only have to be unique within a session — they're never persisted
 *  and never cross the IPC boundary, so a counter beats a uuid here. */
function nextPaneId(): string {
  paneSeq += 1;
  return `pane-${paneSeq}`;
}

export function singlePaneLayout(tabIds: string[] = [], activeTabId: string | null = null): Layout {
  const id = nextPaneId();
  return {
    panes: [{ id, tabIds: [...tabIds], activeTabId: activeTabId ?? tabIds[0] ?? null }],
    grid: [[id, id], [id, id]],
    focusedPaneId: id,
    colFrac: 0.5,
    rowFrac: 0.5,
  };
}

export const initialLayout: Layout = singlePaneLayout();

// --- reading the grid ---

/** Where a pane sits, as a grid rectangle. Scans all four cells rather than
 *  keeping bookkeeping in sync — at this size the scan *is* the cheap option. */
export function paneRect(grid: Grid, paneId: string): { row: number; col: number; rowSpan: number; colSpan: number } {
  const rows: number[] = [];
  const cols: number[] = [];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 2; c++) {
      if (grid[r][c] === paneId) { rows.push(r); cols.push(c); }
    }
  }
  if (rows.length === 0) return { row: 0, col: 0, rowSpan: 0, colSpan: 0 };
  const row = Math.min(...rows);
  const col = Math.min(...cols);
  return {
    row,
    col,
    rowSpan: Math.max(...rows) - row + 1,
    colSpan: Math.max(...cols) - col + 1,
  };
}

/** Every pane on the grid, in reading order (top-left first) so render order is
 *  stable across re-layouts and React never reorders a pane for no reason. */
export function panesOf(grid: Grid): string[] {
  const out: string[] = [];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 2; c++) {
      if (!out.includes(grid[r][c])) out.push(grid[r][c]);
    }
  }
  return out;
}

export function findPane(layout: Layout, paneId: string): Pane | undefined {
  return layout.panes.find((p) => p.id === paneId);
}

export function focusedPane(layout: Layout): Pane {
  // The focused id always names a live pane (every mutation below re-establishes
  // that), but fall back rather than throw — a layout bug shouldn't blank the app.
  return findPane(layout, layout.focusedPaneId) ?? layout.panes[0];
}

export function paneOfTab(layout: Layout, tabId: string): Pane | undefined {
  return layout.panes.find((p) => p.tabIds.includes(tabId));
}

/** The tabs actually on screen right now — one per pane. This is what replaces
 *  the old single `activeTabId` for notifications, auto-sleep and lazy wake:
 *  with a grid, "visible" is a set, and a pane you're looking at but not typing
 *  in must not be treated as hidden. */
export function visibleTabIds(layout: Layout): Set<string> {
  const out = new Set<string>();
  for (const id of panesOf(layout.grid)) {
    const active = findPane(layout, id)?.activeTabId;
    if (active) out.add(active);
  }
  return out;
}

/** Which rows/cols actually straddle two different panes — the L-shape case,
 *  where the vertical seam must stop at the row that isn't split. */
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
    panes: layout.panes.map((p) => ({ ...p, tabIds: [...p.tabIds] })),
    grid: cloneGrid(layout.grid),
    focusedPaneId: layout.focusedPaneId,
    colFrac: layout.colFrac,
    rowFrac: layout.rowFrac,
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
 *  0 or 1 and every cell is distinct — which lets "distinct rows x distinct
 *  cols === count" stand in for a real region check, in one line. */
function isRect(cells: [number, number][]): boolean {
  const rows = new Set(cells.map((c) => c[0]));
  const cols = new Set(cells.map((c) => c[1]));
  return rows.size * cols.size === cells.length;
}

/** Pull a tab out of whichever pane holds it, activating its neighbour — the
 *  same "next, else previous" rule `tabsReducer`'s close already uses, so a tab
 *  leaving a strip behaves identically whether it was closed or dragged away. */
function takeTab(layout: Layout, tabId: string): Layout {
  const next = cloneLayout(layout);
  for (const pane of next.panes) {
    const i = pane.tabIds.indexOf(tabId);
    if (i === -1) continue;
    pane.tabIds.splice(i, 1);
    if (pane.activeTabId === tabId) {
      pane.activeTabId = pane.tabIds[i] ?? pane.tabIds[i - 1] ?? null;
    }
  }
  return next;
}

/** Try to hand every cell of a dying pane to its neighbour along one axis:
 *  'row' takes the pane beside it, 'col' the pane above/below. Returns null when
 *  that axis can't work — either the mirror cell is dying too, or the result
 *  would leave some pane L-shaped.
 *
 *  Two axes are needed rather than one absorbing neighbour: [[A,B],[C,C]] losing
 *  C has no single pane that can take the whole bottom row, because A and B must
 *  *both* grow down into [[A,B],[A,B]]. Filling cell by cell covers that and
 *  every simpler case in the same three lines. */
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

/** Remove a pane, handing its cells to the neighbours that can take them without
 *  breaking the rectangle invariant. A fill always exists whenever two or more
 *  panes share a 2x2, so this never leaves a hole.
 *
 *  At one pane it's a deliberate no-op: the last pane survives with no tabs and
 *  renders Home, which is exactly the app's existing resting state. That's why
 *  there is no "empty layout" branch anywhere. */
export function collapsePane(layout: Layout, paneId: string): Layout {
  const ids = panesOf(layout.grid);
  if (ids.length <= 1 || !ids.includes(paneId)) return layout;

  const dead = cellsOf(layout.grid, paneId);
  // Row first, so a full 2x2 losing A becomes [[B,B],[C,D]] rather than
  // [[C,B],[C,D]] — deterministic, and it matches the reading order the split
  // was most likely made in.
  const grid = fillAlong(layout.grid, dead, 'row', paneId)
    ?? fillAlong(layout.grid, dead, 'col', paneId);
  if (!grid) return layout;

  const [r, c] = dead[0];
  return {
    panes: layout.panes.filter((p) => p.id !== paneId),
    grid,
    focusedPaneId: layout.focusedPaneId === paneId ? grid[r][c] : layout.focusedPaneId,
    colFrac: layout.colFrac,
    rowFrac: layout.rowFrac,
  };
}

/** Collapse every pane left holding nothing, and make sure focus still names a
 *  live pane. Run after any mutation that can empty a strip. */
function prune(layout: Layout): Layout {
  let next = layout;
  // At most four panes, so at most three can go; the bound is a belt-and-braces
  // guard against a future model change turning this into a spin.
  for (let i = 0; i < 4; i++) {
    const ids = panesOf(next.grid);
    if (ids.length <= 1) break;
    const empty = ids.find((id) => findPane(next, id)?.tabIds.length === 0);
    if (!empty) break;
    const after = collapsePane(next, empty);
    if (after === next) break;
    next = after;
  }
  if (!findPane(next, next.focusedPaneId)) {
    next = { ...next, focusedPaneId: panesOf(next.grid)[0] };
  }
  return next;
}

/** Drop `tabId` into `paneId`'s strip, optionally at a position relative to a
 *  tab already there. Moves rather than copies — a terminal's DOM node is
 *  singular, so a session can only ever be in one pane at a time. */
export function movePaneTab(
  layout: Layout,
  tabId: string,
  toPaneId: string,
  targetTabId?: string,
  position: 'before' | 'after' = 'after',
): Layout {
  if (!findPane(layout, toPaneId)) return layout;
  const next = takeTab(layout, tabId);
  const pane = findPane(next, toPaneId);
  if (!pane) return layout;

  let at = pane.tabIds.length;
  if (targetTabId) {
    const i = pane.tabIds.indexOf(targetTabId);
    if (i !== -1) at = position === 'before' ? i : i + 1;
  }
  pane.tabIds.splice(at, 0, tabId);
  pane.activeTabId = tabId;
  next.focusedPaneId = toPaneId;
  return prune(next);
}

/** Split `paneId` along `edge`, putting `tabId` alone in the new pane.
 *
 *  A vertical split needs the pane to span both columns, a horizontal one both
 *  rows. When there's no room the split **degrades to a move** — which is what
 *  keeps a fifth split, or a sideways split of an already-narrow pane, from ever
 *  being an error the UI has to explain. */
export function splitPane(layout: Layout, paneId: string, edge: Edge, tabId: string): Layout {
  const rect = paneRect(layout.grid, paneId);
  if (rect.rowSpan === 0) return layout;

  const vertical = edge === 'left' || edge === 'right';
  if (vertical ? rect.colSpan < 2 : rect.rowSpan < 2) {
    return movePaneTab(layout, tabId, paneId);
  }

  const next = takeTab(layout, tabId);
  const newId = nextPaneId();
  const grid = cloneGrid(next.grid);

  // The new pane takes the half the edge points at; the old pane keeps the rest.
  for (let r = rect.row; r < rect.row + rect.rowSpan; r++) {
    for (let c = rect.col; c < rect.col + rect.colSpan; c++) {
      const takes = vertical
        ? (edge === 'right' ? c === rect.col + 1 : c === rect.col)
        : (edge === 'bottom' ? r === rect.row + 1 : r === rect.row);
      if (takes) grid[r][c] = newId;
    }
  }

  next.grid = grid;
  next.panes.push({ id: newId, tabIds: [tabId], activeTabId: tabId });
  next.focusedPaneId = newId;
  return prune(next);
}

/** Close a tab: drop it from its strip, and collapse the pane if that emptied it. */
export function closePaneTab(layout: Layout, tabId: string): Layout {
  if (!paneOfTab(layout, tabId)) return layout;
  return prune(takeTab(layout, tabId));
}

/** Add a tab to the focused pane and show it. */
export function addTabToFocused(layout: Layout, tabId: string): Layout {
  const next = cloneLayout(layout);
  const pane = focusedPane(next);
  if (!pane.tabIds.includes(tabId)) pane.tabIds.push(tabId);
  pane.activeTabId = tabId;
  return next;
}

/** Show a tab. If it already lives in a pane, focus *that* pane rather than
 *  dragging the tab across the screen — clicking a session in the sidebar should
 *  jump to where it is, not move it. Otherwise it opens in the focused pane. */
export function activateTab(layout: Layout, tabId: string): Layout {
  const home = paneOfTab(layout, tabId);
  if (!home) return addTabToFocused(layout, tabId);
  const next = cloneLayout(layout);
  const pane = findPane(next, home.id);
  if (pane) pane.activeTabId = tabId;
  next.focusedPaneId = home.id;
  return next;
}

export function focusPane(layout: Layout, paneId: string): Layout {
  if (!findPane(layout, paneId) || layout.focusedPaneId === paneId) return layout;
  return { ...layout, focusedPaneId: paneId };
}

export function resizeSeam(layout: Layout, axis: 'col' | 'row', frac: number): Layout {
  const clamped = Math.min(MAX_FRAC, Math.max(MIN_FRAC, frac));
  return axis === 'col' ? { ...layout, colFrac: clamped } : { ...layout, rowFrac: clamped };
}

/** Reorder within one strip, or move across strips — the tab-drag path uses this
 *  for both so there's only one place the two can disagree. */
export function dropTab(
  layout: Layout,
  tabId: string,
  toPaneId: string,
  targetTabId?: string,
  position: 'before' | 'after' = 'after',
): Layout {
  return movePaneTab(layout, tabId, toPaneId, targetTabId, position);
}

/** Close the focused pane outright, sending its tabs nowhere — callers close the
 *  tabs themselves first. Exposed for the tab context menu's "Close pane". */
export function closePane(layout: Layout, paneId: string): Layout {
  return collapsePane(layout, paneId);
}
