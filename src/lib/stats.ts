/**
 * Pure aggregation for the Home dashboard. Takes the per-session stats the
 * backend scans from transcripts (`SessionStat`, tagged client-side with the
 * folder they came from) and rolls them up into the numbers each panel shows.
 * No IO, no React — so it's all unit-tested in stats.test.ts.
 */
import type { SessionStat } from '@/types';

/** A session tagged with the open folder it belongs to and that folder's hue. */
export interface ProjectStat extends SessionStat {
  projectDir: string;
  projectName: string;
  hue: number;
}

/** Days back, or the whole (50-per-folder) history. */
export type Range = 7 | 30 | 'all';

const DAY = 86_400_000;

/** How many month grids the calendar draws for each range. */
export function calendarMonthCount(range: Range): number {
  return range === 7 ? 1 : range === 30 ? 2 : 3;
}

function ms(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** Local-day ordinal (days since epoch in the viewer's timezone), so two
 *  timestamps on the same calendar day collapse to one bucket. */
function dayOrdinal(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return Math.round(d.getTime() / DAY);
}

/** All four token counts — the "tokens processed" figure. */
export function sessionTokens(s: SessionStat): number {
  return s.inputTokens + s.outputTokens + s.cacheReadTokens + s.cacheCreationTokens;
}

export function filterRange<T extends SessionStat>(stats: T[], range: Range, now: number): T[] {
  if (range === 'all') return stats;
  const cutoff = now - range * DAY;
  return stats.filter((s) => {
    const t = ms(s.lastUsedIso);
    return t !== null && t >= cutoff;
  });
}

export interface Summary {
  sessions: number;
  turns: number;
  tokens: number;
  /** cache-read / (cache-read + input + cache-creation), or null with no data. */
  cacheHitPct: number | null;
}

export function summarize(stats: SessionStat[]): Summary {
  let turns = 0, tokens = 0, cacheRead = 0, fresh = 0;
  for (const s of stats) {
    turns += s.turns;
    tokens += sessionTokens(s);
    cacheRead += s.cacheReadTokens;
    fresh += s.inputTokens + s.cacheCreationTokens;
  }
  const denom = cacheRead + fresh;
  return { sessions: stats.length, turns, tokens, cacheHitPct: denom > 0 ? Math.round((cacheRead / denom) * 100) : null };
}

/** One session, ready to be dropped onto a calendar day. Both callers build
 *  this: Home from its `ProjectStat`s, History from its transcript entries —
 *  which is why `tokens` is optional, since a transcript listing hasn't
 *  counted any. */
export interface CalendarMark { iso: string; hue: number; projectName: string; tokens?: number; }

export interface DayFolder { name: string; hue: number; count: number; }

export interface CalendarDay {
  /** Local `year-month-date` — `dayKey()` returns the same string for a
   *  timestamp, so a day filter is a string comparison and nothing more. */
  key: string;
  date: number;
  count: number;
  /** Hue of the folder that ran the most sessions that day; null when empty. */
  hue: number | null;
  tokens: number;
  /** Folders that ran something that day, busiest first. */
  folders: DayFolder[];
}

export interface CalendarMonth {
  key: string;
  label: string;
  /** Blank cells before the 1st, so the grid lines up under S M T W T F S. */
  leading: number;
  days: CalendarDay[];
  total: number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The local calendar day a timestamp falls on. Local, not UTC, for the same
 *  reason `dayOrdinal` is: 11pm and 1am are different days to the person who
 *  worked them, whatever the offset says. */
export function dayKey(iso: string | number): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** The day's folders, busiest first — ties keep the order they were seen in.
 *  The first one's hue is what fills the square. */
function dayFolders(marks: CalendarMark[]): DayFolder[] {
  const tally = new Map<string, DayFolder>();
  for (const m of marks) {
    const f = tally.get(m.projectName) ?? { name: m.projectName, hue: m.hue, count: 0 };
    f.count += 1;
    tally.set(m.projectName, f);
  }
  return [...tally.values()].sort((a, b) => b.count - a.count);
}

/** The `monthCount` calendar months ending with the one `now` falls in. Empty
 *  months are kept rather than dropped, so the grid doesn't reflow under you
 *  as history fills in. */
export function calendarMonths(marks: CalendarMark[], now: number, monthCount = 3): CalendarMonth[] {
  const byDay = new Map<string, CalendarMark[]>();
  for (const m of marks) {
    if (ms(m.iso) === null) continue;
    const k = dayKey(m.iso);
    (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(m);
  }

  const base = new Date(now);
  const months: CalendarMonth[] = [];
  for (let i = monthCount - 1; i >= 0; i--) {
    const first = new Date(base.getFullYear(), base.getMonth() - i, 1);
    const year = first.getFullYear();
    const month = first.getMonth();
    const dayCount = new Date(year, month + 1, 0).getDate();
    const days: CalendarDay[] = [];
    let total = 0;
    for (let date = 1; date <= dayCount; date++) {
      const key = `${year}-${month}-${date}`;
      const list = byDay.get(key) ?? [];
      total += list.length;
      const folders = dayFolders(list);
      days.push({
        key,
        date,
        count: list.length,
        hue: folders[0]?.hue ?? null,
        tokens: list.reduce((n, m) => n + (m.tokens ?? 0), 0),
        folders,
      });
    }
    months.push({ key: `${year}-${month}`, label: `${MONTHS[month]} ${year}`, leading: first.getDay(), days, total });
  }
  return months;
}

/** Merged first-token counts across every session, most-run first. */
export function topCommands(stats: SessionStat[], limit = 8): [string, number][] {
  const m = new Map<string, number>();
  for (const s of stats) for (const [name, n] of s.commands) m.set(name, (m.get(name) ?? 0) + n);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

export interface ProjectCount { projectDir: string; name: string; hue: number; count: number; }

export function perProject(stats: ProjectStat[]): ProjectCount[] {
  const m = new Map<string, ProjectCount>();
  for (const s of stats) {
    const e = m.get(s.projectDir) ?? { projectDir: s.projectDir, name: s.projectName, hue: s.hue, count: 0 };
    e.count += 1;
    m.set(s.projectDir, e);
  }
  return [...m.values()].sort((a, b) => b.count - a.count);
}

/** Sessions per hour of the local day (by start time, falling back to mtime). */
export function hourHistogram(stats: SessionStat[]): number[] {
  const hours = new Array(24).fill(0);
  for (const s of stats) {
    const t = ms(s.startedIso) ?? ms(s.lastUsedIso);
    if (t !== null) hours[new Date(t).getHours()] += 1;
  }
  return hours;
}

/** Consecutive local days with at least one session: the run ending today, and
 *  the longest run ever. A gap today makes the current streak 0. */
export function streaks(stats: SessionStat[], now: number): { current: number; best: number } {
  const days = new Set<number>();
  for (const s of stats) {
    const t = ms(s.lastUsedIso);
    if (t !== null) days.add(dayOrdinal(t));
  }
  if (days.size === 0) return { current: 0, best: 0 };
  const sorted = [...days].sort((a, b) => a - b);
  let best = 1, run = 1;
  for (let i = 1; i < sorted.length; i++) {
    run = sorted[i] === sorted[i - 1] + 1 ? run + 1 : 1;
    if (run > best) best = run;
  }
  let current = 0;
  for (let d = dayOrdinal(now); days.has(d); d--) current += 1;
  return { current, best };
}

export interface Depth {
  avgTurns: number;
  longestTurns: number;
  avgDurationMs: number | null;
  longestDurationMs: number | null;
}

export function depth(stats: SessionStat[]): Depth {
  if (stats.length === 0) return { avgTurns: 0, longestTurns: 0, avgDurationMs: null, longestDurationMs: null };
  let totalTurns = 0, longestTurns = 0;
  const durations: number[] = [];
  for (const s of stats) {
    totalTurns += s.turns;
    if (s.turns > longestTurns) longestTurns = s.turns;
    const a = ms(s.startedIso), b = ms(s.endedIso);
    if (a !== null && b !== null && b >= a) durations.push(b - a);
  }
  const avgDurationMs = durations.length ? Math.round(durations.reduce((x, y) => x + y, 0) / durations.length) : null;
  const longestDurationMs = durations.length ? Math.max(...durations) : null;
  return { avgTurns: Math.round(totalTurns / stats.length), longestTurns, avgDurationMs, longestDurationMs };
}

export type ModelFamily = 'opus' | 'sonnet' | 'haiku' | 'other';

export function modelFamily(model: string | null): ModelFamily {
  const m = (model ?? '').toLowerCase();
  if (m.includes('opus')) return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku')) return 'haiku';
  return 'other';
}

export interface ModelSlice { family: ModelFamily; tokens: number; pct: number; }

/** Token share by model family, each session's tokens attributed to the model
 *  that did most of its output. Fixed opus→sonnet→haiku→other order. */
export function modelShare(stats: SessionStat[]): ModelSlice[] {
  const m = new Map<ModelFamily, number>();
  for (const s of stats) {
    const f = modelFamily(s.model);
    m.set(f, (m.get(f) ?? 0) + sessionTokens(s));
  }
  const total = [...m.values()].reduce((a, b) => a + b, 0);
  const order: ModelFamily[] = ['opus', 'sonnet', 'haiku', 'other'];
  return order
    .filter((f) => (m.get(f) ?? 0) > 0)
    .map((f) => ({ family: f, tokens: m.get(f)!, pct: total > 0 ? Math.round((m.get(f)! / total) * 100) : 0 }));
}

export function formatCompact(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

export function formatDuration(msVal: number): string {
  const mins = Math.round(msVal / 60000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}
