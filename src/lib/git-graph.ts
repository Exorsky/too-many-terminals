/**
 * Lanes for drawing a commit graph, `git log --graph` style: each commit gets
 * a column, and each row says which lines pass through it and where they go.
 * Input is newest-first in topo order (what `git_graph` returns).
 */
import type { GitCommit } from './ipc';

export interface GraphRow {
  commit: GitCommit;
  /** The commit's own column. */
  col: number;
  /** Lines from the row above: [fromColumn, toColumn]. A line ending at
   *  `col` arrives at the commit's dot; the rest pass through. */
  top: [number, number][];
  /** Lines to the row below: [fromColumn, toColumn]; from `col` they leave
   *  the dot toward its parents. */
  bottom: [number, number][];
  /** Columns in use, for the gutter width. */
  width: number;
}

export function layoutGraph(commits: GitCommit[]): GraphRow[] {
  // What each lane is waiting for: the oid it will reach next.
  let lanes: (string | null)[] = [];
  const rows: GraphRow[] = [];
  for (const commit of commits) {
    let col = lanes.indexOf(commit.oid);
    if (col < 0) {
      // A branch tip nothing below has pointed at yet: a fresh lane.
      col = lanes.indexOf(null);
      if (col < 0) { col = lanes.length; lanes.push(null); }
    }
    const before = lanes.slice();
    // Every lane waiting for this commit converges on its dot.
    const top: [number, number][] = [];
    before.forEach((oid, i) => {
      if (oid === null) return;
      top.push([i, oid === commit.oid ? col : i]);
    });
    const after = before.map((oid) => (oid === commit.oid ? null : oid));
    /** Lanes moved left this row: a lane further right that already waits
     *  for this commit's first parent folds into the commit's own column, so
     *  the mainline stays leftmost. */
    const moved = new Map<number, number>();
    const [first, ...rest] = commit.parents;
    if (first) {
      const j = after.indexOf(first);
      if (j > col) { after[j] = null; moved.set(j, col); }
      after[col] = j >= 0 && j < col ? null : first;
    }
    for (const p of rest) {
      if (after.includes(p)) continue;
      const free = after.indexOf(null);
      if (free >= 0 && free !== col) after[free] = p;
      else after.push(p);
    }
    const bottom: [number, number][] = [];
    after.forEach((oid, i) => {
      if (oid === null) return;
      const fromDot = commit.parents.includes(oid) && before[i] !== oid;
      bottom.push([fromDot ? col : i, i]);
    });
    for (const [from, to] of moved) bottom.push([from, to]);
    // A parent already waited on by another lane: the dot reaches over to it.
    for (const p of commit.parents) {
      const j = after.indexOf(p);
      if (j >= 0 && !bottom.some(([f, t]) => f === col && t === j)) bottom.push([col, j]);
    }
    // Trailing empty lanes are dropped so the gutter shrinks back.
    while (after.length && after[after.length - 1] === null) after.pop();
    lanes = after;
    rows.push({ commit, col, top, bottom, width: Math.max(before.length, after.length, col + 1) });
  }
  return rows;
}
