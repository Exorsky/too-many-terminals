import { useEffect, useState } from 'react';
import { CalendarClock, Zap, type LucideIcon } from 'lucide-react';
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

/** One rate-limit window: the official percentage Anthropic reports, plus a
 *  countdown to reset that ticks locally every second so it doesn't stall
 *  between polls. */
function WindowRow({ label, icon: Icon, window: w, now }: { label: string; icon: LucideIcon; window: UsageWindow; now: number }) {
  const secondsLeft = (new Date(w.resetsAtIso).getTime() - now) / 1000;

  return (
    <div className="flex flex-col gap-1.5 px-3 py-1.5">
      <div className="flex items-center gap-1.5 text-[11px]">
        <Icon size={11} className="shrink-0 text-primary" />
        <span className="text-foreground">{label}</span>
        <span className="tabular-nums text-foreground">{w.percent}%</span>
        <span className="ml-auto tabular-nums text-muted-foreground shrink-0">resets in {formatDuration(secondsLeft)}</span>
      </div>
      <div
        className="h-1 rounded-full bg-border-hover overflow-hidden"
        role="progressbar"
        aria-label={`${label} usage`}
        aria-valuenow={w.percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={cn('h-full rounded-full transition-[width] duration-300', barColor(w.percent))} style={{ width: `${w.percent}%` }} />
      </div>
    </div>
  );
}

export default function UsageMeter() {
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

  if (!stats?.available) return null;

  // A live fetch is current by definition. A cached fallback is only as fresh
  // as the last time Claude Code rendered usage itself — which can be hours —
  // so age it rather than passing a stale percentage off as live.
  const staleMinutes = stats.fromCache && stats.fetchedAtMs ? Math.floor((now - stats.fetchedAtMs) / 60_000) : 0;

  return (
    <div className="border-t border-border shrink-0">
      {stats.session && <WindowRow label="Session" icon={Zap} window={stats.session} now={now} />}
      {stats.week && (
        <div className={cn(stats.session && 'border-t border-border')}>
          <WindowRow label="This week" icon={CalendarClock} window={stats.week} now={now} />
        </div>
      )}
      {staleMinutes >= 5 && (
        <div className="px-3 pb-1.5 text-[10px] text-muted-foreground/60 tabular-nums">cached — as of {formatDuration(staleMinutes * 60)} ago</div>
      )}
    </div>
  );
}
