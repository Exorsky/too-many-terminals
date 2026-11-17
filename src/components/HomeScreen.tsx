import { useEffect, useMemo, useState } from 'react';
import {
  Activity, BarChart3, CalendarDays, Clock, FolderOpen, Folders, Gauge, Lightbulb, Terminal, Trophy, Zap,
} from 'lucide-react';
import * as ipc from '@/lib/ipc';
import { cn, folderName } from '@/lib/utils';
import { useUsageStats } from '@/lib/usage-store';
import { projectHue, type SessionHistoryEntry } from '@/types';
import {
  calendarMonthCount, calendarMonths, chartDays, dailyTokens, dayTotal, depth, filterRange, formatCompact,
  formatDuration, hourHistogram, largestSessions, modelShare, pctChange, perProjectTokens, previousRange,
  recentSessions, sessionTokens, streaks, summarize, topCommands,
  type CalendarMark, type DayTokens, type ModelFamily, type ProjectStat, type Range,
} from '@/lib/stats';
import SessionCalendar from './SessionCalendar';

interface HomeScreenProps {
  projects: string[];
  onAddProject: () => void;
  /** Open a session named on the dashboard — the same resume History does:
   *  the tab it already has, or a new `--resume` one. */
  onOpenSession?: (dir: string, entry: SessionHistoryEntry) => void;
}

/** A dashboard row that opens its session. */
const SESSION_ROW = 'w-full -mx-2 px-2 py-1.5 rounded-sm border-none bg-transparent text-left font-inherit cursor-pointer hover:bg-hover';

const RANGES: { value: Range; label: string }[] = [
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
  { value: 'all', label: 'All' },
];

/** The token chart's three series, bottom to top. Identity hues, validated
 *  together on the dark card surface (dataviz validate_palette.js, all checks
 *  pass) — none is a status colour or `primary`. Always shown with their names. */
const SERIES = [
  { key: 'input', label: 'Input', color: '#5b8def' },
  { key: 'cache', label: 'Cache', color: '#2fa89e' },
  { key: 'output', label: 'Output', color: '#a77be0' },
] as const;
const seriesValue = (d: DayTokens, key: (typeof SERIES)[number]['key']) =>
  key === 'input' ? d.input : key === 'cache' ? d.cacheRead + d.cacheWrite : d.output;

/** Decorative identity hues for the three model families — labelled, so they
 *  read by name, not by colour alone. Not status colours. */
const MODEL_HUE: Record<ModelFamily, string> = {
  opus: 'hsl(268 48% 60%)',
  sonnet: 'hsl(176 42% 50%)',
  haiku: 'hsl(220 12% 46%)',
  other: 'hsl(32 40% 52%)',
};

const hue = (h: number, l = 58) => `hsl(${h} 55% ${l}%)`;

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/** An axis top that's a round number: 1 / 2 / 2.5 / 5 × 10ⁿ per quarter. */
function niceTop(max: number): number {
  if (max <= 0) return 4;
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((v) => v >= raw)!;
  return step * 4;
}

function Card({ title, icon: Icon, aside, className, children }: {
  title: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  aside?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn('flex flex-col min-w-0 rounded-md border border-border bg-card', className)}>
      <div className="flex items-center gap-2 h-10 px-4 shrink-0">
        <Icon size={13} className="shrink-0 text-muted-foreground" />
        <h2 className="m-0 text-[11px] font-normal tracking-[0.16em] uppercase text-muted-foreground">{title}</h2>
        {aside && <div className="ml-auto flex items-center gap-3 text-[11px] text-muted-foreground">{aside}</div>}
      </div>
      <div className="flex-1 min-h-0 px-4 pb-4">{children}</div>
    </section>
  );
}

/** A trend line under a stat tile: 2px line, a 10% wash under it, one point
 *  per day with its value on hover. Days with nothing to say are gaps. */
function Sparkline({ values, labels, format }: {
  values: (number | null)[];
  labels: string[];
  format: (v: number) => string;
}) {
  const known = values.filter((v): v is number => v !== null);
  if (known.length < 2) return <div className="h-8" />;
  const max = Math.max(...known), min = Math.min(...known);
  const span = max - min || 1;
  const n = values.length;
  const x = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const y = (v: number) => 30 - ((v - min) / span) * 28;
  const pts = values.map((v, i) => (v === null ? null : `${x(i).toFixed(2)},${y(v).toFixed(2)}`)).filter(Boolean).join(' ');
  const firstX = x(values.findIndex((v) => v !== null));
  const lastX = x(n - 1 - [...values].reverse().findIndex((v) => v !== null));
  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="w-full h-8 overflow-visible text-dim" aria-hidden>
      <polygon points={`${firstX},32 ${pts} ${lastX},32`} fill="currentColor" opacity={0.1} />
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      {values.map((v, i) => (
        <rect key={i} x={x(i) - 50 / n} y={0} width={100 / n} height={32} fill="transparent">
          <title>{`${labels[i]} · ${v === null ? 'no sessions' : format(v)}`}</title>
        </rect>
      ))}
    </svg>
  );
}

function Delta({ value, unit = '%', vs }: { value: number | null; unit?: string; vs: string }) {
  if (value === null) return <span className="text-faint">no earlier data</span>;
  // Direction only, in text ink: more tokens isn't good or bad by itself, and
  // the status colours are reserved for sessions.
  const arrow = value > 0 ? '↑' : value < 0 ? '↓' : '→';
  return <span>{arrow} {Math.abs(value)}{unit} <span className="text-faint">vs {vs}</span></span>;
}

function Kpi({ label, value, delta, spark }: {
  label: string; value: string; delta: React.ReactNode; spark: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 min-w-0 rounded-md border border-border bg-card px-4 py-3.5">
      <h2 className="m-0 text-[11px] font-normal tracking-[0.16em] uppercase text-muted-foreground">{label}</h2>
      <div className="flex items-end gap-4">
        <span className="text-[30px] leading-none font-medium text-foreground font-mono tabular-nums shrink-0">{value}</span>
        <div className="flex-1 min-w-0">{spark}</div>
      </div>
      <div className="text-[11.5px] text-muted-foreground font-mono tabular-nums">{delta}</div>
    </section>
  );
}

/** Stacked columns — input, cache, output — one per day. Pointing at a day
 *  reads it out in the caption below, the same way the calendar does. */
function TokenFlow({ days }: { days: DayTokens[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const top = niceTop(Math.max(0, ...days.map(dayTotal)));
  const ticks = [0, 1, 2, 3, 4].map((k) => (top / 4) * k);
  const n = days.length;
  const labelAt = new Set([0, 1, 2, 3, 4, 5].map((k) => Math.round((k * (n - 1)) / 5)));
  const peak = days.reduce((best, d, i) => (dayTotal(d) > dayTotal(days[best]) ? i : best), 0);
  const shown = hover ?? (dayTotal(days[peak]) > 0 ? peak : null);
  const d = shown === null ? null : days[shown];

  return (
    <div className="flex flex-col gap-2">
      <div className="relative h-[200px] ml-11">
        {ticks.map((t) => (
          <div key={t} className="absolute left-0 right-0 border-t border-border" style={{ bottom: `${(t / top) * 100}%` }}>
            <span className="absolute -left-11 w-9 -translate-y-1/2 text-right text-[10.5px] font-mono tabular-nums text-muted-foreground">
              {formatCompact(t)}
            </span>
          </div>
        ))}
        <div className={cn('absolute inset-0 flex', n <= 90 ? 'gap-[2px]' : 'gap-px')} onMouseLeave={() => setHover(null)}>
          {days.map((day, i) => (
            <div
              key={day.key}
              data-day={day.key}
              className={cn('flex-1 min-w-0 flex items-end justify-center rounded-t-[4px]', hover === i && 'bg-hover')}
              onMouseEnter={() => setHover(i)}
            >
              <div
                className="dash-grow-y flex flex-col gap-[2px] w-full max-w-6"
                style={{ height: `${(dayTotal(day) / top) * 100}%` }}
              >
                {[...SERIES].reverse().map((s) => {
                  const v = seriesValue(day, s.key);
                  return v > 0 && (
                    <span key={s.key} className="block min-h-px first:rounded-t-[4px]" style={{ flex: v, background: s.color }} />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="relative h-4 ml-11">
        {days.map((day, i) => labelAt.has(i) && (
          <span
            key={day.key}
            className="absolute -translate-x-1/2 text-[10.5px] font-mono tabular-nums text-muted-foreground whitespace-nowrap"
            style={{ left: `${((i + 0.5) / n) * 100}%` }}
          >
            {day.label}
          </span>
        ))}
      </div>
      <p data-flow-caption className="m-0 ml-11 min-h-4 text-[11.5px] text-muted-foreground font-mono tabular-nums truncate">
        {d ? (
          <>
            <span className="text-foreground">{d.label}</span>
            {hover === null && ' · peak'}
            {' · '}{formatCompact(dayTotal(d))} tokens
            {SERIES.map((s) => ` · ${s.label.toLowerCase()} ${formatCompact(seriesValue(d, s.key))}`).join('')}
            {` · ${d.sessions} session${d.sessions === 1 ? '' : 's'}`}
          </>
        ) : 'No tokens in this window.'}
      </p>
    </div>
  );
}

/** One labelled horizontal bar (command rows). */
function BarRow({ label, value, frac, barColor }: { label: string; value: string; frac: number; barColor: string }) {
  return (
    <div className="grid grid-cols-[76px_1fr_46px] items-center gap-2.5">
      <span className="truncate text-[12px] text-muted-foreground">{label}</span>
      <span className="h-2 rounded-[2px] bg-raised overflow-hidden">
        <span className="dash-grow block h-full rounded-[2px]" style={{ width: `${(frac * 100).toFixed(1)}%`, background: barColor }} />
      </span>
      <span className="text-[12px] text-right font-mono tabular-nums text-muted-foreground">{value}</span>
    </div>
  );
}

/** A small "big number + caption" cell used in the Rhythm / Depth panels. */
function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="text-[17px] font-medium text-foreground font-mono tabular-nums leading-none">{value}</div>
      <div className="mt-1 text-[10.5px] tracking-[0.1em] uppercase text-muted-foreground">{label}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] text-muted-foreground m-0 py-1">{children}</p>;
}

export default function HomeScreen({ projects, onAddProject, onOpenSession }: HomeScreenProps) {
  const [stats, setStats] = useState<ProjectStat[] | null>(null);
  const usage = useUsageStats();
  const [range, setRange] = useState<Range>(30);
  // Fixed for the component's life so the day-bucketing memos stay stable;
  // Home remounts whenever you leave and come back, so it's always fresh.
  const now = useMemo(() => Date.now(), []);

  // One full-transcript scan per open folder — runs off the main thread (the
  // command is async).
  useEffect(() => {
    if (projects.length === 0) { setStats([]); return; }
    let cancelled = false;
    Promise.all(
      projects.map((dir, i) =>
        ipc.getSessionStats(dir)
          .catch(() => [])
          .then((list) => list.map((s): ProjectStat => ({ ...s, projectDir: dir, projectName: folderName(dir), hue: projectHue(i) }))),
      ),
    ).then((all) => { if (!cancelled) setStats(all.flat()); });
    return () => { cancelled = true; };
  }, [projects]);

  const scoped = useMemo(() => (stats ? filterRange(stats, range, now) : []), [stats, range, now]);
  const summary = useMemo(() => summarize(scoped), [scoped]);
  const prev = useMemo(() => {
    const p = stats ? previousRange(stats, range, now) : null;
    return p && p.length ? summarize(p) : null;
  }, [stats, range, now]);
  const days = useMemo(() => dailyTokens(scoped, chartDays(scoped, range, now), now), [scoped, range, now]);
  const months = useMemo(() => calendarMonths(
    scoped.map((s): CalendarMark => ({ iso: s.lastUsedIso, hue: s.hue, projectName: s.projectName, tokens: sessionTokens(s) })),
    now,
    calendarMonthCount(range),
  ), [scoped, range, now]);
  const projectTokens = useMemo(() => perProjectTokens(scoped), [scoped]);
  const largest = useMemo(() => largestSessions(scoped), [scoped]);
  const recent = useMemo(() => recentSessions(scoped), [scoped]);
  const commands = useMemo(() => topCommands(scoped), [scoped]);
  const hours = useMemo(() => hourHistogram(scoped), [scoped]);
  const run = useMemo(() => streaks(scoped, now), [scoped, now]);
  const dpt = useMemo(() => depth(scoped), [scoped]);
  const models = useMemo(() => modelShare(scoped), [scoped]);

  const vs = range === 'all' ? '' : `previous ${range}d`;
  const perTurn = (tokens: number, turns: number) => (turns > 0 ? Math.round(tokens / turns) : 0);
  const labels = days.map((d) => d.label);
  const activeDays = days.filter((d) => d.sessions > 0).length;
  const dailyAvg = days.length ? summary.tokens / days.length : 0;
  const peakDay = days.reduce<DayTokens | null>((b, d) => (dayTotal(d) > (b ? dayTotal(b) : 0) ? d : b), null);
  const cmdMax = commands[0]?.[1] ?? 1;
  const largestMax = largest[0] ? sessionTokens(largest[0]) : 1;
  const hourMax = Math.max(1, ...hours);
  const peakHour = hours.some((h) => h > 0) ? hours.indexOf(Math.max(...hours)) : null;
  const open = (s: ProjectStat) => onOpenSession?.(s.projectDir, { sessionId: s.sessionId, preview: s.preview, lastUsedIso: s.lastUsedIso });
  const windows = usage?.available
    ? ([['Session · 5h', usage.session], ['Week · 7d', usage.week]] as const).filter(([, w]) => w)
    : [];

  return (
    <div className="absolute inset-0 bg-background flex flex-col overflow-hidden select-none">
      <header className="flex items-center justify-between gap-4 h-10 px-4 shrink-0 border-b border-border">
        <span className="text-[11.5px] tracking-[0.32em] uppercase text-muted-foreground">
          <b className="font-medium text-foreground">Too many</b> terminals
          <span className="text-muted-foreground"> · token analytics</span>
        </span>
        <div className="flex gap-0.5" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <button
              key={String(r.value)}
              aria-pressed={range === r.value}
              onClick={() => setRange(r.value)}
              className={cn(
                'text-[11px] tracking-[0.14em] uppercase px-2.5 py-1 rounded-sm border border-transparent transition-colors cursor-pointer',
                range === r.value ? 'text-foreground bg-raised border-border' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </header>

      {projects.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-5 text-center px-6">
          <div className="w-28 h-16 border border-dashed border-border grid place-items-center text-border-hover text-2xl">+</div>
          <p className="dash-serif text-[15px] text-muted-foreground max-w-[42ch] m-0">
            No folders open yet. Open one, and every session you run there fills in your logbook.
          </p>
          <button
            onClick={onAddProject}
            className="flex items-center gap-2 px-3.5 py-2 text-[13px] text-foreground/90 border border-border-hover rounded-sm hover:bg-raised cursor-pointer"
          >
            <FolderOpen size={13} /> Open folder
          </button>
        </div>
      ) : stats === null ? (
        <div className="flex-1 grid place-items-center text-[12px] tracking-[0.1em] uppercase text-muted-foreground">
          Reading your sessions…
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-3 p-4">
            {/* KPI row */}
            <div className="xl:col-span-3">
              <Kpi
                label="Total tokens"
                value={formatCompact(summary.tokens)}
                delta={vs ? <Delta value={prev ? pctChange(summary.tokens, prev.tokens) : null} vs={vs} /> : `${summary.sessions} sessions`}
                spark={<Sparkline values={days.map(dayTotal)} labels={labels} format={(v) => `${formatCompact(v)} tokens`} />}
              />
            </div>
            <div className="xl:col-span-3">
              <Kpi
                label="Cache hit"
                value={summary.cacheHitPct === null ? '—' : `${summary.cacheHitPct}%`}
                delta={vs ? (
                  <Delta
                    value={prev?.cacheHitPct != null && summary.cacheHitPct !== null ? summary.cacheHitPct - prev.cacheHitPct : null}
                    unit=" pt"
                    vs={vs}
                  />
                ) : 'cache reads ÷ all input'}
                spark={(
                  <Sparkline
                    values={days.map((d) => {
                      const denom = d.input + d.cacheRead + d.cacheWrite;
                      return denom > 0 ? Math.round((d.cacheRead / denom) * 100) : null;
                    })}
                    labels={labels}
                    format={(v) => `${v}% cache hit`}
                  />
                )}
              />
            </div>
            <div className="xl:col-span-3">
              <Kpi
                label="Avg / turn"
                value={formatCompact(perTurn(summary.tokens, summary.turns))}
                delta={vs ? (
                  <Delta value={prev ? pctChange(perTurn(summary.tokens, summary.turns), perTurn(prev.tokens, prev.turns)) : null} vs={vs} />
                ) : `${summary.turns.toLocaleString()} turns`}
                spark={(
                  <Sparkline
                    values={days.map((d) => (d.turns > 0 ? Math.round(dayTotal(d) / d.turns) : null))}
                    labels={labels}
                    format={(v) => `${formatCompact(v)} tokens / turn`}
                  />
                )}
              />
            </div>
            <div className="xl:col-span-3">
              <Kpi
                label="Sessions"
                value={String(summary.sessions)}
                delta={vs ? <Delta value={prev ? pctChange(summary.sessions, prev.sessions) : null} vs={vs} /> : `${activeDays} active days`}
                spark={<Sparkline values={days.map((d) => d.sessions)} labels={labels} format={(v) => `${v} session${v === 1 ? '' : 's'}`} />}
              />
            </div>

            {/* readouts */}
            <Card title="Token insights" icon={Lightbulb} className="xl:col-span-4">
              <div className="flex flex-col divide-y divide-border">
                {([
                  ['Daily average', `${formatCompact(Math.round(dailyAvg))} tokens`],
                  ['Peak day', peakDay ? `${peakDay.label} · ${formatCompact(dayTotal(peakDay))}` : '—'],
                  ['30-day pace', `~${formatCompact(Math.round(dailyAvg * 30))} tokens`],
                  ['Per session', summary.sessions ? `${formatCompact(Math.round(summary.tokens / summary.sessions))} tokens` : '—'],
                ] as const).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0 text-[12.5px]">
                    <span className="text-dim">{k}</span>
                    <span className="font-mono tabular-nums text-foreground">{v}</span>
                  </div>
                ))}
              </div>
            </Card>
            <Card title="Rate limit — live" icon={Gauge} className="xl:col-span-4" aside="official /usage">
              {windows.length === 0 ? (
                <Empty>Usage unavailable — sign in with Claude Code to see your limits.</Empty>
              ) : windows.map(([label, w]) => (
                <div key={label} className="mt-3 first:mt-0">
                  <div className="flex items-baseline justify-between gap-2.5">
                    <span className="text-[11.5px] tracking-[0.06em] uppercase text-muted-foreground">{label}</span>
                    <span className="text-[15px] font-medium text-foreground font-mono tabular-nums">{Math.round(w!.percent)}%</span>
                  </div>
                  <span className="mt-1.5 block h-[5px] rounded-[3px] bg-selected overflow-hidden">
                    <span className="dash-grow block h-full rounded-[3px]" style={{ width: `${Math.min(100, w!.percent)}%`, background: 'var(--usage)' }} />
                  </span>
                </div>
              ))}
            </Card>
            <Card title="Depth & models" icon={Activity} className="md:col-span-2 xl:col-span-4" aside={`${summary.turns.toLocaleString()} turns`}>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                <Stat value={String(dpt.avgTurns)} label="avg turns / session" />
                <Stat value={String(dpt.longestTurns)} label="longest — turns" />
                <Stat value={dpt.avgDurationMs === null ? '—' : formatDuration(dpt.avgDurationMs)} label="avg duration" />
                <Stat value={dpt.longestDurationMs === null ? '—' : formatDuration(dpt.longestDurationMs)} label="longest — duration" />
              </div>
              {models.length > 0 && (
                <>
                  <div className="flex gap-[2px] h-[8px] mt-4">
                    {models.map((m) => (
                      <span key={m.family} className="h-full first:rounded-l-full last:rounded-r-full" style={{ flex: m.pct, background: MODEL_HUE[m.family] }} />
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-2.5">
                    {models.map((m) => (
                      <span key={m.family} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="w-2 h-2 rounded-full" style={{ background: MODEL_HUE[m.family] }} />
                        {m.family}<span className="font-mono tabular-nums ml-0.5">{m.pct}%</span>
                      </span>
                    ))}
                  </div>
                </>
              )}
            </Card>

            {/* token flow + where it went */}
            <Card
              title="Token flow"
              icon={BarChart3}
              className="md:col-span-2 xl:col-span-8"
              aside={SERIES.map((s) => (
                <span key={s.key} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                  {s.label}
                </span>
              ))}
            >
              <TokenFlow days={days} />
            </Card>
            <Card title="Project consumption" icon={Folders} className="md:col-span-2 xl:col-span-4">
              <div className="flex flex-col gap-3">
                {projectTokens.length === 0 ? <Empty>Nothing in this window.</Empty> : projectTokens.slice(0, 7).map((p) => (
                  <div key={p.projectDir} data-project-tokens className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2 text-[12.5px]">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: hue(p.hue) }} />
                      <span className="flex-1 truncate text-dim">{p.name}</span>
                      <span className="font-mono tabular-nums text-foreground">{formatCompact(p.tokens)}</span>
                      <span className="w-9 text-right font-mono tabular-nums text-muted-foreground">{p.pct}%</span>
                    </div>
                    <span className="ml-4 h-[5px] rounded-full bg-raised overflow-hidden">
                      <span className="dash-grow block h-full rounded-full" style={{ width: `${p.pct}%`, background: hue(p.hue, 50) }} />
                    </span>
                  </div>
                ))}
              </div>
            </Card>

            {/* sessions: biggest, when, latest */}
            <Card title="Largest sessions" icon={Trophy} className="xl:col-span-4">
              <div className="flex flex-col gap-0.5">
                {largest.length === 0 ? <Empty>Nothing in this window.</Empty> : largest.map((s, i) => (
                  <button
                    key={s.sessionId}
                    type="button"
                    data-open-session={s.sessionId}
                    onClick={() => open(s)}
                    className={cn(SESSION_ROW, 'grid grid-cols-[14px_minmax(0,1fr)_56px] items-center gap-x-2.5 gap-y-1')}
                  >
                    <span className="text-[12px] font-mono tabular-nums text-muted-foreground">{i + 1}</span>
                    <span className="flex items-baseline gap-2 min-w-0 text-[12.5px]">
                      <span className="shrink-0 font-mono tabular-nums text-dim">{when(s.lastUsedIso)}</span>
                      <span className="truncate text-muted-foreground" title={s.preview}>{s.projectName}{s.preview && ` · ${s.preview}`}</span>
                    </span>
                    <span className="text-right text-[12px] font-mono tabular-nums text-foreground">{formatCompact(sessionTokens(s))}</span>
                    <span className="col-start-2 col-span-2 h-[5px] rounded-full bg-raised overflow-hidden">
                      <span className="dash-grow block h-full rounded-full" style={{ width: `${(sessionTokens(s) / largestMax) * 100}%`, background: hue(s.hue, 50) }} />
                    </span>
                  </button>
                ))}
              </div>
            </Card>
            <Card
              title="Activity"
              icon={CalendarDays}
              className="xl:col-span-4"
              aside={range === 'all' ? 'last 3 months' : range === 90 ? 'last 3 months' : `${range} days`}
            >
              <SessionCalendar months={months} now={now} />
            </Card>
            <Card title="Recent activity" icon={Zap} className="md:col-span-2 xl:col-span-4">
              <div className="flex flex-col gap-0.5">
                {recent.length === 0 ? <Empty>Nothing in this window.</Empty> : recent.map((s) => (
                  <button
                    key={s.sessionId}
                    type="button"
                    data-open-session={s.sessionId}
                    onClick={() => open(s)}
                    className={cn(SESSION_ROW, 'grid grid-cols-[44px_minmax(0,1fr)] gap-x-2.5')}
                  >
                    <span className="text-[12px] font-mono tabular-nums text-muted-foreground pt-px">
                      {new Date(s.lastUsedIso).toDateString() === new Date(now).toDateString() ? clock(s.lastUsedIso) : when(s.lastUsedIso).split(',')[0]}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-[12.5px]">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: hue(s.hue) }} />
                        <span className="truncate text-dim">{s.projectName}</span>
                      </div>
                      <div className="text-[11.5px] font-mono tabular-nums text-muted-foreground">
                        {formatCompact(sessionTokens(s))} tokens · {s.turns} turn{s.turns === 1 ? '' : 's'}
                      </div>
                      {s.preview && <div className="text-[11.5px] text-faint truncate" title={s.preview}>{s.preview}</div>}
                    </div>
                  </button>
                ))}
              </div>
            </Card>

            <Card
              title="Top commands"
              icon={Terminal}
              className="xl:col-span-6"
              aside={<span className="font-mono tabular-nums">{commands.reduce((s, [, c]) => s + c, 0).toLocaleString()} runs</span>}
            >
              <div className="flex flex-col gap-2">
                {commands.length === 0
                  ? <Empty>No shell commands in this window.</Empty>
                  : commands.map(([name, c]) => (
                    <BarRow key={name} label={name} value={c.toLocaleString()} frac={c / cmdMax} barColor="rgb(255 255 255 / 0.22)" />
                  ))}
              </div>
            </Card>
            <Card title="Rhythm" icon={Clock} className="xl:col-span-6" aside="local time">
              <div className="flex gap-6">
                <Stat value={`${run.current}d`} label="current streak" />
                <Stat value={`${run.best}d`} label="best streak" />
                <Stat value={peakHour === null ? '—' : `${String(peakHour).padStart(2, '0')}:00`} label="busiest hour" />
              </div>
              <div className="grid grid-cols-24 items-end gap-0.5 h-11.5 mt-3.5">
                {hours.map((c, h) => (
                  <span
                    key={h}
                    className="dash-grow rounded-[1px]"
                    title={`${String(h).padStart(2, '0')}:00 · ${c} session${c === 1 ? '' : 's'}`}
                    style={{ height: `${Math.max(6, (c / hourMax) * 100)}%`, background: h === peakHour ? 'var(--usage)' : 'rgb(255 255 255 / 0.14)' }}
                  />
                ))}
              </div>
              <div className="flex justify-between mt-1.5 text-[10.5px] tracking-[0.08em] text-muted-foreground font-mono tabular-nums">
                <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
              </div>
            </Card>
          </div>
          <p className="m-0 px-4 pb-4 text-[11px] tracking-[0.04em] text-muted-foreground">
            Read from the transcripts Claude Code writes under ~/.claude/projects — offline, nothing uploaded.
          </p>
        </div>
      )}
    </div>
  );
}
