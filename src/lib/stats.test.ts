import { describe, expect, it } from 'vitest';
import {
  cadence, depth, filterRange, formatCompact, formatDuration, hourHistogram,
  modelFamily, modelShare, perProject, streaks, summarize, topCommands,
  type ProjectStat, type Range,
} from './stats';

const NOW = Date.parse('2026-08-13T20:00:00Z');
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

function stat(over: Partial<ProjectStat> = {}): ProjectStat {
  return {
    sessionId: 's', lastUsedIso: daysAgo(0), startedIso: null, endedIso: null,
    turns: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
    model: null, preview: '', commands: [],
    projectDir: '/a', projectName: 'a', hue: 210, ...over,
  };
}

describe('filterRange', () => {
  const stats = [stat({ lastUsedIso: daysAgo(1) }), stat({ lastUsedIso: daysAgo(10) }), stat({ lastUsedIso: daysAgo(40) })];
  it('keeps only sessions within the window', () => {
    expect(filterRange(stats, 7, NOW)).toHaveLength(1);
    expect(filterRange(stats, 30, NOW)).toHaveLength(2);
  });
  it('keeps everything for "all"', () => {
    expect(filterRange(stats, 'all' as Range, NOW)).toHaveLength(3);
  });
});

describe('summarize', () => {
  it('sums turns and tokens and computes cache hit rate', () => {
    const s = summarize([
      stat({ turns: 10, inputTokens: 100, outputTokens: 40, cacheReadTokens: 800, cacheCreationTokens: 100 }),
      stat({ turns: 6, inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheCreationTokens: 0 }),
    ]);
    expect(s.sessions).toBe(2);
    expect(s.turns).toBe(16);
    expect(s.tokens).toBe(100 + 40 + 800 + 100 + 100 + 20);
    // cacheRead 800 / (800 + input 200 + creation 100) = 800/1100 ≈ 73%
    expect(s.cacheHitPct).toBe(73);
  });
  it('reports null cache rate with no token data', () => {
    expect(summarize([stat()]).cacheHitPct).toBeNull();
  });
});

describe('cadence', () => {
  it('lays sessions onto day columns ending today', () => {
    const days = cadence([stat({ lastUsedIso: daysAgo(0) }), stat({ lastUsedIso: daysAgo(0) }), stat({ lastUsedIso: daysAgo(2) })], 7, NOW);
    expect(days).toHaveLength(7);
    expect(days[days.length - 1].marks).toHaveLength(2); // today
    expect(days[days.length - 3].marks).toHaveLength(1); // two days ago
    expect(days[0].marks).toHaveLength(0);
  });
});

describe('topCommands', () => {
  it('merges first-token counts across sessions, most-run first', () => {
    const top = topCommands([
      stat({ commands: [['git', 5], ['pnpm', 2]] }),
      stat({ commands: [['git', 3], ['cargo', 4]] }),
    ]);
    expect(top).toEqual([['git', 8], ['cargo', 4], ['pnpm', 2]]);
  });
});

describe('perProject', () => {
  it('counts sessions per folder, busiest first', () => {
    const counts = perProject([
      stat({ projectDir: '/a', projectName: 'a' }),
      stat({ projectDir: '/a', projectName: 'a' }),
      stat({ projectDir: '/b', projectName: 'b', hue: 140 }),
    ]);
    expect(counts.map((c) => [c.name, c.count])).toEqual([['a', 2], ['b', 1]]);
  });
});

describe('hourHistogram', () => {
  it('buckets by local start hour, falling back to mtime', () => {
    const local = new Date(2026, 7, 13, 14, 30).toISOString();
    const h = hourHistogram([stat({ startedIso: local }), stat({ startedIso: null, lastUsedIso: local })]);
    expect(h[14]).toBe(2);
    expect(h.reduce((a, b) => a + b, 0)).toBe(2);
  });
});

describe('streaks', () => {
  it('counts the run ending today and the longest run', () => {
    const s = streaks([
      stat({ lastUsedIso: daysAgo(0) }), stat({ lastUsedIso: daysAgo(1) }), stat({ lastUsedIso: daysAgo(2) }),
      // a separate older 2-day run
      stat({ lastUsedIso: daysAgo(10) }), stat({ lastUsedIso: daysAgo(11) }),
    ], NOW);
    expect(s.current).toBe(3);
    expect(s.best).toBe(3);
  });
  it('breaks the current streak when today has no session', () => {
    expect(streaks([stat({ lastUsedIso: daysAgo(1) }), stat({ lastUsedIso: daysAgo(2) })], NOW).current).toBe(0);
  });
  it('is zero with no sessions', () => {
    expect(streaks([], NOW)).toEqual({ current: 0, best: 0 });
  });
});

describe('depth', () => {
  it('averages turns and measures durations', () => {
    const d = depth([
      stat({ turns: 10, startedIso: daysAgo(0), endedIso: new Date(NOW - 0 * 86_400_000 + 3_600_000).toISOString() }),
      stat({ turns: 20 }),
    ]);
    expect(d.avgTurns).toBe(15);
    expect(d.longestTurns).toBe(20);
    expect(d.longestDurationMs).toBe(3_600_000);
  });
  it('is empty-safe', () => {
    expect(depth([])).toEqual({ avgTurns: 0, longestTurns: 0, avgDurationMs: null, longestDurationMs: null });
  });
});

describe('modelShare', () => {
  it('maps ids to families and shares tokens in fixed order', () => {
    const slices = modelShare([
      stat({ model: 'claude-sonnet-4-5', outputTokens: 30 }),
      stat({ model: 'claude-opus-4-8', outputTokens: 70 }),
    ]);
    expect(slices.map((s) => s.family)).toEqual(['opus', 'sonnet']); // opus first
    expect(slices.find((s) => s.family === 'opus')!.pct).toBe(70);
  });
  it('classifies model ids', () => {
    expect(modelFamily('claude-haiku-4-5-20251001')).toBe('haiku');
    expect(modelFamily(null)).toBe('other');
  });
});

describe('formatters', () => {
  it('compacts large numbers', () => {
    expect(formatCompact(18_400_000)).toBe('18.4M');
    expect(formatCompact(2_000)).toBe('2K');
    expect(formatCompact(940)).toBe('940');
  });
  it('formats durations', () => {
    expect(formatDuration(41 * 60_000)).toBe('41m');
    expect(formatDuration(3 * 3_600_000 + 4 * 60_000)).toBe('3h 04m');
  });
});
