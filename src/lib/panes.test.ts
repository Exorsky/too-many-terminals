import { describe, expect, it } from 'vitest';
import {
  activateTab,
  closePaneTab,
  collapsePane,
  focusedPane,
  movePaneTab,
  paneOfTab,
  paneRect,
  panesOf,
  resizeSeam,
  seamBands,
  singlePaneLayout,
  splitPane,
  visibleTabIds,
  type Edge,
  type Grid,
  type Layout,
} from './panes';

const EDGES: Edge[] = ['left', 'right', 'top', 'bottom'];

/** A layout holding `n` tabs named t0..t(n-1), all in one pane. */
function withTabs(n: number): Layout {
  return singlePaneLayout(Array.from({ length: n }, (_, i) => `t${i}`));
}

/** Every cell names a live pane, and every pane's cells form a rectangle.
 *  These two together are the invariant the whole model rests on. */
function expectWellFormed(layout: Layout) {
  const ids = panesOf(layout.grid);
  for (const row of layout.grid) {
    for (const cell of row) {
      expect(ids).toContain(cell);
      expect(layout.panes.some((p) => p.id === cell)).toBe(true);
    }
  }
  for (const id of ids) {
    const rect = paneRect(layout.grid, id);
    let owned = 0;
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 2; c++) if (layout.grid[r][c] === id) owned++;
    }
    // A rectangle's cell count is exactly its spans multiplied.
    expect(owned).toBe(rect.rowSpan * rect.colSpan);
  }
  // Focus always names a live pane.
  expect(ids).toContain(layout.focusedPaneId);
}

/** Every layout reachable by splitting up to three times, for exhaustive tests. */
function reachableLayouts(): Layout[] {
  const out: Layout[] = [];
  const walk = (layout: Layout, depth: number) => {
    out.push(layout);
    if (depth === 0) return;
    for (const paneId of panesOf(layout.grid)) {
      for (const edge of EDGES) {
        const spare = layout.panes.flatMap((p) => p.tabIds)[0];
        if (!spare) continue;
        const next = splitPane(layout, paneId, edge, `x${out.length}-${paneId}-${edge}`);
        if (panesOf(next.grid).length > panesOf(layout.grid).length) walk(next, depth - 1);
      }
    }
  };
  walk(withTabs(6), 3);
  return out;
}

describe('paneRect', () => {
  it('reads all five shapes', () => {
    const one: Grid = [['a', 'a'], ['a', 'a']];
    expect(paneRect(one, 'a')).toEqual({ row: 0, col: 0, rowSpan: 2, colSpan: 2 });

    const cols: Grid = [['a', 'b'], ['a', 'b']];
    expect(paneRect(cols, 'a')).toEqual({ row: 0, col: 0, rowSpan: 2, colSpan: 1 });
    expect(paneRect(cols, 'b')).toEqual({ row: 0, col: 1, rowSpan: 2, colSpan: 1 });

    const rows: Grid = [['a', 'a'], ['b', 'b']];
    expect(paneRect(rows, 'b')).toEqual({ row: 1, col: 0, rowSpan: 1, colSpan: 2 });

    const ell: Grid = [['a', 'b'], ['c', 'c']];
    expect(paneRect(ell, 'c')).toEqual({ row: 1, col: 0, rowSpan: 1, colSpan: 2 });

    const quad: Grid = [['a', 'b'], ['c', 'd']];
    expect(paneRect(quad, 'd')).toEqual({ row: 1, col: 1, rowSpan: 1, colSpan: 1 });
  });

  it('reports a zero span for a pane that is not on the grid', () => {
    expect(paneRect([['a', 'a'], ['a', 'a']], 'nope').rowSpan).toBe(0);
  });
});

describe('panesOf', () => {
  it('lists each pane once, in reading order', () => {
    expect(panesOf([['b', 'a'], ['c', 'a']])).toEqual(['b', 'a', 'c']);
  });
});

describe('splitPane', () => {
  it('splits right, leaving the old pane on the left', () => {
    const base = withTabs(2);
    const next = splitPane(base, base.focusedPaneId, 'right', 't1');
    expectWellFormed(next);
    expect(panesOf(next.grid)).toHaveLength(2);
    expect(next.grid[0][0]).toBe(next.grid[1][0]);
    expect(next.grid[0][1]).toBe(next.grid[1][1]);
    expect(next.grid[0][0]).not.toBe(next.grid[0][1]);
    // The dragged tab is alone in the new pane, and the new pane takes focus.
    expect(focusedPane(next).tabIds).toEqual(['t1']);
    expect(next.focusedPaneId).toBe(next.grid[0][1]);
  });

  it('splits left, putting the new pane in the near half', () => {
    const base = withTabs(2);
    const next = splitPane(base, base.focusedPaneId, 'left', 't1');
    expect(next.grid[0][0]).toBe(next.focusedPaneId);
    expect(next.grid[0][1]).toBe(base.focusedPaneId);
  });

  it('splits down, stacking the new pane underneath', () => {
    const base = withTabs(2);
    const next = splitPane(base, base.focusedPaneId, 'bottom', 't1');
    expectWellFormed(next);
    expect(next.grid[0][0]).toBe(next.grid[0][1]);
    expect(next.grid[1][0]).toBe(next.grid[1][1]);
    expect(next.grid[1][0]).toBe(next.focusedPaneId);
  });

  it('reaches a three-pane L and then a full 2x2', () => {
    const base = withTabs(4);
    const cols = splitPane(base, base.focusedPaneId, 'right', 't1');
    const ell = splitPane(cols, cols.focusedPaneId, 'bottom', 't2');
    expectWellFormed(ell);
    expect(panesOf(ell.grid)).toHaveLength(3);

    const quad = splitPane(ell, ell.grid[1][0], 'bottom', 't3');
    expectWellFormed(quad);
    expect(panesOf(quad.grid)).toHaveLength(4);
  });

  it('degrades to a move when the pane has no room in that axis', () => {
    const base = withTabs(3);
    const cols = splitPane(base, base.focusedPaneId, 'right', 't1');
    const narrow = cols.focusedPaneId; // one cell wide, two cells tall

    const next = splitPane(cols, narrow, 'right', 't2');
    expect(panesOf(next.grid)).toHaveLength(2); // no third pane appeared
    expect(paneOfTab(next, 't2')?.id).toBe(narrow); // it just landed in the strip
  });

  it('never exceeds four panes — a fifth split becomes a move', () => {
    const base = withTabs(6);
    const a = splitPane(base, base.focusedPaneId, 'right', 't1');
    const b = splitPane(a, a.focusedPaneId, 'bottom', 't2');
    const quad = splitPane(b, b.grid[1][0], 'bottom', 't3');
    expect(panesOf(quad.grid)).toHaveLength(4);

    for (const edge of EDGES) {
      const next = splitPane(quad, quad.grid[0][0], edge, 't4');
      expect(panesOf(next.grid)).toHaveLength(4);
      expectWellFormed(next);
    }
  });

  it('moving a pane’s only tab into its own edge collapses back to one pane', () => {
    const base = withTabs(1);
    const next = splitPane(base, base.focusedPaneId, 'right', 't0');
    expectWellFormed(next);
    expect(panesOf(next.grid)).toHaveLength(1);
  });
});

describe('collapsePane', () => {
  // The test that earns its keep: whatever shape you reached, removing any pane
  // leaves a well-formed grid with exactly one fewer pane. If the rectangle rule
  // ever fails to find a merge, this is what catches it.
  it('leaves a well-formed grid for every pane of every reachable shape', () => {
    for (const layout of reachableLayouts()) {
      const ids = panesOf(layout.grid);
      if (ids.length < 2) continue;
      for (const id of ids) {
        const next = collapsePane(layout, id);
        expect(panesOf(next.grid)).toHaveLength(ids.length - 1);
        expect(panesOf(next.grid)).not.toContain(id);
        expectWellFormed(next);
      }
    }
  });

  it('prefers the row neighbour in a full 2x2', () => {
    const grid: Grid = [['a', 'b'], ['c', 'd']];
    const layout: Layout = {
      panes: ['a', 'b', 'c', 'd'].map((id) => ({ id, tabIds: [id], activeTabId: id })),
      grid,
      focusedPaneId: 'a',
      colFrac: 0.5,
      rowFrac: 0.5,
    };
    // Both b (row) and c (column) could legally absorb a; row wins.
    expect(collapsePane(layout, 'a').grid).toEqual([['b', 'b'], ['c', 'd']]);
  });

  it('grows both top panes down when an L-shape loses its bottom row', () => {
    const grid: Grid = [['a', 'b'], ['c', 'c']];
    const layout: Layout = {
      panes: ['a', 'b', 'c'].map((id) => ({ id, tabIds: [id], activeTabId: id })),
      grid,
      focusedPaneId: 'c',
      colFrac: 0.5,
      rowFrac: 0.5,
    };
    // No single pane can absorb the whole bottom row rectangularly.
    const next = collapsePane(layout, 'c');
    expect(next.grid).toEqual([['a', 'b'], ['a', 'b']]);
    expect(next.focusedPaneId).toBe('a');
    expectWellFormed(next);
  });

  it('is a no-op at one pane, so the last pane survives empty', () => {
    const one = withTabs(0);
    expect(collapsePane(one, one.focusedPaneId)).toBe(one);
  });

  it('moves focus off a pane it removes', () => {
    const base = withTabs(2);
    const cols = splitPane(base, base.focusedPaneId, 'right', 't1');
    const next = collapsePane(cols, cols.focusedPaneId);
    expect(next.focusedPaneId).toBe(base.focusedPaneId);
  });
});

describe('closePaneTab', () => {
  it('activates the next tab, else the previous one', () => {
    let layout = withTabs(3);
    layout = activateTab(layout, 't1');
    layout = closePaneTab(layout, 't1');
    expect(focusedPane(layout).activeTabId).toBe('t2');

    layout = closePaneTab(layout, 't2');
    expect(focusedPane(layout).activeTabId).toBe('t0');
  });

  it('collapses the pane when its last tab goes', () => {
    const base = withTabs(2);
    const cols = splitPane(base, base.focusedPaneId, 'right', 't1');
    expect(panesOf(cols.grid)).toHaveLength(2);

    const next = closePaneTab(cols, 't1');
    expect(panesOf(next.grid)).toHaveLength(1);
    expectWellFormed(next);
  });

  it('keeps the last pane when its last tab goes — that is the Home state', () => {
    const next = closePaneTab(withTabs(1), 't0');
    expect(panesOf(next.grid)).toHaveLength(1);
    expect(focusedPane(next).activeTabId).toBeNull();
    expect(focusedPane(next).tabIds).toEqual([]);
  });

  it('ignores a tab that is in no pane', () => {
    const layout = withTabs(2);
    expect(closePaneTab(layout, 'nope')).toBe(layout);
  });
});

describe('movePaneTab', () => {
  it('moves a tab across panes and follows it with focus', () => {
    const base = withTabs(3);
    const cols = splitPane(base, base.focusedPaneId, 'right', 't2');
    const left = base.focusedPaneId;
    const right = cols.focusedPaneId;

    const next = movePaneTab(cols, 't0', right);
    expect(paneOfTab(next, 't0')?.id).toBe(right);
    expect(next.panes.find((p) => p.id === left)?.tabIds).toEqual(['t1']);
    expect(next.focusedPaneId).toBe(right);
    expect(next.panes.find((p) => p.id === right)?.activeTabId).toBe('t0');
  });

  it('honours before/after when a target tab is named', () => {
    const base = withTabs(3);
    const next = movePaneTab(base, 't2', base.focusedPaneId, 't0', 'before');
    expect(focusedPane(next).tabIds).toEqual(['t2', 't0', 't1']);
  });

  it('collapses a pane the move emptied', () => {
    const base = withTabs(2);
    const cols = splitPane(base, base.focusedPaneId, 'right', 't1');
    const next = movePaneTab(cols, 't1', base.focusedPaneId);
    expect(panesOf(next.grid)).toHaveLength(1);
    expectWellFormed(next);
  });

  it('ignores an unknown destination', () => {
    const layout = withTabs(2);
    expect(movePaneTab(layout, 't0', 'nope')).toBe(layout);
  });
});

describe('activateTab', () => {
  it('focuses the pane a tab already lives in rather than moving the tab', () => {
    const base = withTabs(3);
    const cols = splitPane(base, base.focusedPaneId, 'right', 't2');
    const left = base.focusedPaneId;

    const next = activateTab(cols, 't0');
    expect(next.focusedPaneId).toBe(left);
    expect(paneOfTab(next, 't0')?.id).toBe(left); // did not move
  });

  it('opens a tab that is in no pane into the focused pane', () => {
    const base = withTabs(1);
    const next = activateTab(base, 'brand-new');
    expect(focusedPane(next).tabIds).toEqual(['t0', 'brand-new']);
    expect(focusedPane(next).activeTabId).toBe('brand-new');
  });
});

describe('visibleTabIds', () => {
  it('returns one tab per pane, not just the focused one', () => {
    const base = withTabs(3);
    const cols = splitPane(base, base.focusedPaneId, 'right', 't2');
    expect(visibleTabIds(cols)).toEqual(new Set(['t0', 't2']));
  });

  it('skips a pane with nothing in it', () => {
    expect(visibleTabIds(withTabs(0)).size).toBe(0);
  });
});

describe('seamBands', () => {
  it('marks only the split row for an L shape', () => {
    expect(seamBands([['a', 'b'], ['c', 'c']])).toEqual({
      vertical: [true, false],
      horizontal: [true, true],
    });
  });

  it('marks neither axis for a single pane', () => {
    expect(seamBands([['a', 'a'], ['a', 'a']])).toEqual({
      vertical: [false, false],
      horizontal: [false, false],
    });
  });
});

describe('resizeSeam', () => {
  it('clamps both ends so a pane never disappears', () => {
    const layout = withTabs(1);
    expect(resizeSeam(layout, 'col', 0.01).colFrac).toBe(0.15);
    expect(resizeSeam(layout, 'col', 0.99).colFrac).toBe(0.85);
    expect(resizeSeam(layout, 'row', 0.4).rowFrac).toBe(0.4);
    // The other axis is untouched.
    expect(resizeSeam(layout, 'row', 0.4).colFrac).toBe(0.5);
  });
});
