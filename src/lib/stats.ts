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

/** How many day-columns the cadence draws for each range. */
export function cadenceDayCount(range: Range): number {
  return range === 'all' ? 90 : range;
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

export interface CadenceMark { hue: number; projectName: string; preview: string; }
export interface CadenceDay { key: string; label: string; marks: CadenceMark[]; }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `dayCount` columns ending today, each holding its sessions (newest folders
 *  don't matter here — order within a day is insertion order). */
export function cadence(stats: ProjectStat[], dayCount: number, now: number): CadenceDay[] {
  const byDay = new Map<number, CadenceMark[]>();
  for (const s of stats) {
    const t = ms(s.lastUsedIso);
    if (t === null) continue;
    const ord = dayOrdinal(t);
    const marks = byDay.get(ord) ?? [];
    marks.push({ hue: s.hue, projectName: s.projectName, preview: s.preview });
    byDay.set(ord, marks);
  }
  const base = new Date(now);
  base.setHours(0, 0, 0, 0);
  const days: CadenceDay[] = [];
  for (let i = dayCount - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    const ord = Math.round(d.getTime() / DAY);
    days.push({ key: String(ord), label: `${MONTHS[d.getMonth()]} ${d.getDate()}`, marks: byDay.get(ord) ?? [] });
  }
  return days;
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
