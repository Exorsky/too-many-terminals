import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import * as ipc from '@/lib/ipc';
import { useSettings } from '@/lib/settings-store';
import type { SessionUsageStats, UsageWindow } from '@/types';

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Themeable below the warning threshold; the escalation to warning/red is
 *  deliberately not themeable — it's a signal, not decoration. */
function barColor(percent: number): string {
  if (percent >= 90) return 'bg-destructive';
  if (percent >= 70) return 'bg-warning';
  return 'bg-usage';
}

/** The two official rate-limit windows, in seconds. Fixed lengths, which is
 *  what makes the pace mark below computable without a second API field. */
const WINDOW_SECONDS = { session: 5 * 3600, week: 7 * 86400 } as const;

/** How far the clock has moved through the window, 0–1. `UsageWindow` reports
 *  only a percentage and a reset time, but the window's length is fixed — so
 *  its start is the reset minus that length, and "how much of the window is
 *  gone" needs no backend change. Clamped, because a cached reset time can sit
 *  slightly in the past. */
export function paceFraction(resetsAtIso: string, windowSeconds: number, now: number): number {
  const resetsAt = new Date(resetsAtIso).getTime();
  if (Number.isNaN(resetsAt)) return 0;
  const secondsLeft = (resetsAt - now) / 1000;
  return Math.min(1, Math.max(0, 1 - secondsLeft / windowSeconds));
}

/** One rate-limit window on one line: which window, a bar carrying the pace
 *  mark, the percentage, and the countdown to reset.
 *
 *  The pace mark — a hairline at the clock's position in the window — is the
 *  point of the row. A bare percentage answers "how much is gone", but the
 *  question that changes behavior is whether you're burning faster than the
 *  clock: 42% an hour into a five-hour window and 42% four hours in are
 *  "slow down" and "you're fine", and the number is the same either way. Fill
 *  past the mark means the limit runs out before the window does.
 *
 *  The mark deliberately doesn't recolor anything. Color stays on the 70/90
 *  thresholds `barColor` already owns: a threshold warns, the mark informs,
 *  and folding two signals into one color makes neither readable. */
function UsageRow({ label, window: w, windowSeconds, now }: {
  label: string;
  window: UsageWindow;
  windowSeconds: number;
  now: number;
}) {
  const secondsLeft = (new Date(w.resetsAtIso).getTime() - now) / 1000;
  const pace = paceFraction(w.resetsAtIso, windowSeconds, now);
  const ahead = w.percent / 100 > pace;

  return (
    <div className="flex items-center gap-1.5 h-[15px] text-[9.5px]">
      <span className="w-9 shrink-0 text-muted-foreground">{label}</span>
      <div
        className="relative flex-1 min-w-0 h-[3px] rounded-full bg-border-hover"
        role="progressbar"
        aria-label={`${label} usage`}
        aria-valuenow={w.percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={cn('h-full rounded-full', barColor(w.percent))} style={{ width: `${w.percent}%` }} />
        <span
          className="absolute -top-[3px] -bottom-[3px] w-px bg-foreground/55"
          style={{ left: `${pace * 100}%` }}
          title={ahead ? 'Burning faster than the clock' : 'Behind the clock — the window outlasts the limit'}
        />
      </div>
      <span className="w-6 shrink-0 text-right tabular-nums text-foreground">{w.percent}%</span>
      <span className="w-11 shrink-0 text-right tabular-nums text-muted-foreground" title="Resets in">
        {formatDuration(secondsLeft)}
      </span>
    </div>
  );
}

/** The sidebar's bottom band, and the only thing left in it: how much of each
 *  rate-limit window is gone. Navigation moved to the rail — it's about the
 *  app, not about the list — which left this free to spell out in two labeled
 *  rows what used to be two unnamed numbers behind a lightning bolt and a
 *  calendar. Nothing renders at all when neither window is available, rather
 *  than an empty 38px bar.
 *  See docs/features/usage-meter.md. */
export default function SidebarFooter() {
  const settings = useSettings();
  const [stats, setStats] = useState<SessionUsageStats | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const fetchStats = () => {
      ipc.getSessionUsageStats().then((s) => { if (!cancelled) setStats(s); }).catch(() => {});
    };
    fetchStats();
    // Floor of 5s guards against a corrupt/zero setting spinning the timer.
    const timer = setInterval(fetchStats, Math.max(5, settings.usageRefreshSeconds) * 1000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [settings.usageRefreshSeconds]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!stats?.session && !stats?.week) return null;

  // A live fetch is current by definition. A cached fallback is only as fresh
  // as the last time Claude Code rendered usage itself — which can be hours —
  // so age it rather than passing a stale percentage off as live.
  const staleMinutes = stats.fromCache && stats.fetchedAtMs ? Math.floor((now - stats.fetchedAtMs) / 60_000) : 0;

  return (
    <div
      data-testid="usage-meter"
      className="flex flex-col gap-0.5 px-2 py-[3px] shrink-0 border-t border-border"
      title={staleMinutes >= 5 ? `cached — as of ${formatDuration(staleMinutes * 60)} ago` : undefined}
    >
      {stats.session && (
        <UsageRow label="Session" window={stats.session} windowSeconds={WINDOW_SECONDS.session} now={now} />
      )}
      {stats.week && (
        <UsageRow label="Week" window={stats.week} windowSeconds={WINDOW_SECONDS.week} now={now} />
      )}
    </div>
  );
}
