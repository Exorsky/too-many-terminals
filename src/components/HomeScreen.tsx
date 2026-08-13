import { useEffect, useMemo, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import * as ipc from '@/lib/ipc';
import { cn, folderName } from '@/lib/utils';
import { projectHue, type SessionUsageStats } from '@/types';
import {
  cadence, cadenceDayCount, depth, filterRange, formatCompact, formatDuration,
  hourHistogram, modelShare, perProject, streaks, summarize, topCommands,
  type ModelFamily, type ProjectStat, type Range,
} from '@/lib/stats';

interface HomeScreenProps {
  projects: string[];
  onAddProject: () => void;
}

const RANGES: { value: Range; label: string }[] = [
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 'all', label: 'All' },
];

/** Decorative identity hues for the three model families — labelled, so they
 *  read by name, not by colour alone. Not status colours. */
const MODEL_HUE: Record<ModelFamily, string> = {
  opus: 'hsl(268 48% 60%)',
  sonnet: 'hsl(176 42% 50%)',
  haiku: 'hsl(220 12% 46%)',
  other: 'hsl(32 40% 52%)',
};

const hue = (h: number, l = 58) => `hsl(${h} 55% ${l}%)`;

/** An uppercase panel eyebrow. */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return <span className="text-[10px] tracking-[0.16em] uppercase text-muted-foreground">{children}</span>;
}

/** One labelled horizontal bar (command / folder rows). */
function BarRow({ label, swatch, value, frac, barColor }: {
  label: string; swatch?: string; value: string; frac: number; barColor: string;
}) {
  return (
    <div className="grid grid-cols-[76px_1fr_46px] items-center gap-2.5">
      <span className="flex items-center gap-2 min-w-0 text-[11px] text-muted-foreground">
        {swatch && <span className="w-[7px] h-[7px] rounded-[2px] shrink-0" style={{ background: swatch }} />}
        <span className="truncate">{label}</span>
      </span>
      <span className="h-2 rounded-[2px] bg-white/5 overflow-hidden">
        <span className="dash-grow block h-full rounded-[2px]" style={{ width: `${(frac * 100).toFixed(1)}%`, background: barColor }} />
      </span>
      <span className="text-[11px] text-right tabular-nums text-muted-foreground/80">{value}</span>
    </div>
  );
}

/** A small "big number + caption" cell used in the Rhythm / Depth panels. */
function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="text-[17px] font-medium text-foreground tabular-nums leading-none">{value}</div>
      <div className="mt-1 text-[9px] tracking-[0.1em] uppercase text-muted-foreground/70">{label}</div>
    </div>
  );
}

function UsagePanel({ usage }: { usage: SessionUsageStats | null }) {
  const windows = usage?.available
    ? ([['Session · 5h', usage.session], ['Week · 7d', usage.week]] as const).filter(([, w]) => w)
    : [];
  return (
    <section className="border-b border-border">
      <div className="flex items-center justify-between px-4 pt-2.5 pb-2">
        <Eyebrow>Rate limit — live</Eyebrow>
        <span className="text-[9.5px] tracking-[0.08em] uppercase text-muted-foreground/70">official /usage</span>
      </div>
      <div className="px-4 pb-4">
        {windows.length === 0 ? (
          <p className="text-[11px] text-muted-foreground/70 m-0 py-1.5">Usage unavailable — sign in with Claude Code to see your limits.</p>
        ) : windows.map(([label, w]) => (
          <div key={label} className="mt-3 first:mt-1">
            <div className="flex items-baseline justify-between gap-2.5">
              <span className="text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground">{label}</span>
              <span className="text-[15px] font-medium text-foreground tabular-nums">{Math.round(w!.percent)}%</span>
            </div>
            <span className="mt-1.5 block h-[5px] rounded-[3px] bg-white/8 overflow-hidden">
              <span className="dash-grow block h-full rounded-[3px]" style={{ width: `${Math.min(100, w!.percent)}%`, background: 'var(--usage)' }} />
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function HomeScreen({ projects, onAddProject }: HomeScreenProps) {
  const [stats, setStats] = useState<ProjectStat[] | null>(null);
  const [usage, setUsage] = useState<SessionUsageStats | null>(null);
  const [range, setRange] = useState<Range>(30);
  const [caption, setCaption] = useState<{ name: string; preview: string; hue: number } | null>(null);
  // Fixed for the component's life so the day-bucketing memos stay stable;
  // Home remounts whenever you leave and come back, so it's always fresh.
  const now = useMemo(() => Date.now(), []);

  // One full-transcript scan per open folder, same trigger as the old skyline's
  // listSessions read — runs off the main thread (the command is async).
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

  useEffect(() => {
    let cancelled = false;
    ipc.getSessionUsageStats().then((u) => { if (!cancelled) setUsage(u); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const scoped = useMemo(() => (stats ? filterRange(stats, range, now) : []), [stats, range, now]);
  const summary = useMemo(() => summarize(scoped), [scoped]);
  const days = useMemo(() => cadence(scoped, cadenceDayCount(range), now), [scoped, range, now]);
  const commands = useMemo(() => topCommands(scoped), [scoped]);
  const folders = useMemo(() => perProject(scoped), [scoped]);
  const hours = useMemo(() => hourHistogram(scoped), [scoped]);
  const run = useMemo(() => streaks(scoped, now), [scoped, now]);
  const dpt = useMemo(() => depth(scoped), [scoped]);
  const models = useMemo(() => modelShare(scoped), [scoped]);

  const cmdMax = commands[0]?.[1] ?? 1;
  const folderMax = folders[0]?.count ?? 1;
  const hourMax = Math.max(1, ...hours);
  const peakHour = hours.some((h) => h > 0) ? hours.indexOf(Math.max(...hours)) : null;

  const headline: [string, string][] = [
    [String(summary.sessions), 'sessions'],
    [summary.turns.toLocaleString(), 'turns'],
    [formatCompact(summary.tokens), 'tokens'],
    [summary.cacheHitPct === null ? '—' : `${summary.cacheHitPct}%`, 'cache hit'],
  ];

  return (
    <div className="absolute inset-0 bg-background flex flex-col overflow-hidden select-none">
      <header className="flex items-center justify-between gap-4 h-10 px-4 shrink-0 border-b border-border">
        <span className="text-[10.5px] tracking-[0.32em] uppercase text-muted-foreground">
          <b className="font-medium text-foreground">Too many</b> terminals
          <span className="text-muted-foreground/60"> · logbook</span>
        </span>
        <div className="flex gap-0.5" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <button
              key={String(r.value)}
              aria-pressed={range === r.value}
              onClick={() => setRange(r.value)}
              className={cn(
                'text-[9.5px] tracking-[0.14em] uppercase px-2.5 py-1 rounded-sm border border-transparent transition-colors cursor-pointer',
                range === r.value ? 'text-foreground bg-white/6 border-border' : 'text-muted-foreground/70 hover:text-muted-foreground',
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
            className="flex items-center gap-2 px-3.5 py-2 text-[11.5px] text-foreground/90 border border-border-hover rounded-sm hover:bg-white/5 cursor-pointer"
          >
            <FolderOpen size={13} /> Open folder
          </button>
        </div>
      ) : stats === null ? (
        <div className="flex-1 grid place-items-center text-[11px] tracking-[0.1em] uppercase text-muted-foreground/60">
          Reading your sessions…
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {/* headline readout */}
          <section className="px-4 py-4 border-b border-border">
            <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-2">
              {headline.map(([v, u], i) => (
                <span key={u} className="flex items-baseline gap-1.5">
                  {i > 0 && <span className="text-border-hover text-lg self-center mr-2">·</span>}
                  <span className="text-[30px] leading-none font-medium text-foreground tabular-nums">{v}</span>
                  <span className="text-[10px] tracking-[0.13em] uppercase text-muted-foreground">{u}</span>
                </span>
              ))}
            </div>
            <p className="mt-2.5 text-[10px] tracking-[0.04em] text-muted-foreground/70 m-0">
              Read from the transcripts Claude Code writes under <span className="text-muted-foreground">~/.claude/projects</span> — offline, nothing uploaded.
            </p>
          </section>

          {/* cadence — the hero: one mark per session, tinted by folder */}
          <section className="border-b border-border">
            <div className="flex items-center justify-between px-4 pt-2.5 pb-1.5">
              <Eyebrow>Cadence — each mark a session, tinted by folder</Eyebrow>
              <span className="text-[9.5px] tracking-[0.08em] uppercase text-muted-foreground/70">
                {range === 'all' ? '90 days' : `${range} days`}
              </span>
            </div>
            <div className="px-4 pb-4">
              <div
                className="grid items-end gap-[3px] h-[132px] pt-1.5"
                style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
                role="img"
                aria-label={`${summary.sessions} sessions across ${days.length} days`}
                onPointerLeave={() => setCaption(null)}
              >
                {days.map((day, di) => (
                  <div key={day.key} className="flex flex-col-reverse gap-[2px] min-w-0" title={`${day.label} · ${day.marks.length} session${day.marks.length === 1 ? '' : 's'}`}>
                    {day.marks.length === 0 ? (
                      <span className="h-[3px] rounded-[1px] bg-white/5" />
                    ) : day.marks.map((m, mi) => (
                      <span
                        key={mi}
                        className="dash-mark h-[9px] rounded-[1px] last:rounded-t-[3px] hover:brightness-[1.35]"
                        style={{ background: hue(m.hue), animationDelay: `${di * 12 + mi * 8}ms` }}
                        onPointerEnter={() => setCaption({ name: m.projectName, preview: m.preview, hue: m.hue })}
                      />
                    ))}
                  </div>
                ))}
              </div>
              <div className="flex justify-between mt-2 text-[9px] tracking-[0.1em] uppercase text-muted-foreground/70">
                <span>{days[0]?.label}</span>
                <span>{days[days.length - 1]?.label} · today</span>
              </div>
              {/* hover caption — your own words come back in serif */}
              <div className="mt-2 h-5 flex items-center gap-2.5 text-[10px] tracking-[0.1em] uppercase text-muted-foreground">
                {caption ? (
                  <>
                    <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: hue(caption.hue, 60) }} />
                    <b className="font-medium text-foreground normal-case tracking-normal">{caption.name}</b>
                    <span className="dash-serif normal-case tracking-normal text-[13px] text-muted-foreground truncate">{caption.preview}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground/60">Point at a session to read the prompt that started it.</span>
                )}
              </div>
            </div>
          </section>

          {/* readouts */}
          <div className="grid grid-cols-1 sm:grid-cols-2">
            <div className="sm:border-r border-border">
              <UsagePanel usage={usage} />
            </div>

            {/* top commands */}
            <section className="border-b border-border">
              <div className="flex items-center justify-between px-4 pt-2.5 pb-2">
                <Eyebrow>Top commands</Eyebrow>
                <span className="text-[9.5px] tracking-[0.08em] uppercase text-muted-foreground/70 tabular-nums">
                  {commands.reduce((s, [, n]) => s + n, 0).toLocaleString()} runs
                </span>
              </div>
              <div className="px-4 pb-4 flex flex-col gap-2">
                {commands.length === 0
                  ? <p className="text-[11px] text-muted-foreground/70 m-0 py-1">No shell commands in this window.</p>
                  : commands.map(([name, n]) => (
                    <BarRow key={name} label={name} value={n.toLocaleString()} frac={n / cmdMax} barColor="rgb(255 255 255 / 0.22)" />
                  ))}
              </div>
            </section>

            {/* where the time went */}
            <section className="border-b border-border sm:border-r">
              <div className="px-4 pt-2.5 pb-2"><Eyebrow>Where the time went</Eyebrow></div>
              <div className="px-4 pb-4 flex flex-col gap-2">
                {folders.length === 0
                  ? <p className="text-[11px] text-muted-foreground/70 m-0 py-1">Nothing in this window.</p>
                  : folders.map((f) => (
                    <BarRow key={f.projectDir} label={f.name} swatch={hue(f.hue)} value={String(f.count)} frac={f.count / folderMax} barColor={hue(f.hue, 50)} />
                  ))}
              </div>
            </section>

            {/* rhythm */}
            <section className="border-b border-border">
              <div className="flex items-center justify-between px-4 pt-2.5 pb-2">
                <Eyebrow>Rhythm</Eyebrow>
                <span className="text-[9.5px] tracking-[0.08em] uppercase text-muted-foreground/70">local time</span>
              </div>
              <div className="px-4 pb-4">
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
                <div className="flex justify-between mt-1.5 text-[8.5px] tracking-[0.08em] text-muted-foreground/70 tabular-nums">
                  <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
                </div>
              </div>
            </section>

            {/* depth + models — full width */}
            <section className="border-b border-border sm:col-span-2">
              <div className="flex items-center justify-between px-4 pt-2.5 pb-2">
                <Eyebrow>Depth &amp; models</Eyebrow>
                <span className="text-[9.5px] tracking-[0.08em] uppercase text-muted-foreground/70 tabular-nums">
                  {summary.turns.toLocaleString()} turns total
                </span>
              </div>
              <div className="px-4 pb-4">
                <div className="flex flex-wrap gap-x-8 gap-y-3">
                  <Stat value={String(dpt.avgTurns)} label="avg turns / session" />
                  <Stat value={String(dpt.longestTurns)} label="longest — turns" />
                  <Stat value={dpt.longestDurationMs === null ? '—' : formatDuration(dpt.longestDurationMs)} label="longest — duration" />
                  <Stat value={dpt.avgDurationMs === null ? '—' : formatDuration(dpt.avgDurationMs)} label="avg duration" />
                </div>
                {models.length > 0 && (
                  <>
                    <div className="flex gap-[2px] h-[9px] mt-4">
                      {models.map((m) => (
                        <span key={m.family} className="h-full first:rounded-l-[2px] last:rounded-r-[2px]" style={{ flex: m.pct, background: MODEL_HUE[m.family] }} />
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-2.5">
                      {models.map((m) => (
                        <span key={m.family} className="flex items-center gap-2 text-[10px] text-muted-foreground">
                          <span className="w-2 h-2 rounded-[2px]" style={{ background: MODEL_HUE[m.family] }} />
                          {m.family}<span className="text-muted-foreground/70 tabular-nums ml-0.5">{m.pct}%</span>
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
