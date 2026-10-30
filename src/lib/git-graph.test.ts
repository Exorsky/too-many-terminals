import { describe, expect, it } from 'vitest';
import type { GitCommit } from './ipc';
import { layoutGraph } from './git-graph';

const c = (oid: string, parents: string[] = []): GitCommit => ({ oid, short: oid, parents, refs: [], subject: oid, time: 0, files: [] });

describe('commit graph lanes', () => {
  it('a straight history is one lane', () => {
    const rows = layoutGraph([c('c', ['b']), c('b', ['a']), c('a')]);
    expect(rows.map((r) => r.col)).toEqual([0, 0, 0]);
    expect(rows[2].bottom).toEqual([]);
  });

  it('a branch forks into a second lane and a merge brings it back', () => {
    // m merges f (feature) into b (main); both come from a.
    const rows = layoutGraph([c('m', ['b', 'f']), c('f', ['a']), c('b', ['a']), c('a')]);
    expect(rows.map((r) => r.col)).toEqual([0, 1, 0, 0]);
    // The merge leaves its dot toward both parents.
    expect(rows[0].bottom).toEqual(expect.arrayContaining([[0, 0], [0, 1]]));
    // f's lane folds back into the mainline on its way to a, as `|/` does.
    expect(rows[2].bottom).toEqual(expect.arrayContaining([[1, 0]]));
    expect(rows[3].width).toBe(1);
  });

  it('two branch tips get their own lanes', () => {
    const rows = layoutGraph([c('x', ['a']), c('y', ['a']), c('a')]);
    expect(rows[0].col).toBe(0);
    expect(rows[1].col).toBe(1);
    expect(rows[2].col).toBe(0);
  });
});
