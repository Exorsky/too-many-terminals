import { useEffect, useState } from 'react';
import { Activity, ChevronRight, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import * as ipc from '@/lib/ipc';
import { useSettings } from '@/lib/settings-store';
import type { SessionUsageStats, UsageStats } from '@/types';

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function barColor(fraction: number): string {
  if (fraction >= 0.9) return 'bg-destructive';
  if (fraction >= 0.7) return 'bg-warning';
  return 'bg-success';
}

/** The current 5-hour rate-limit window: tokens used, a countdown to reset,
 *  and a bar against `estimatedLimitTokens` — a ceiling estimated from your
 *  own biggest past block, not an official Anthropic number (there isn't a
 *  public API for that; see docs/features/usage-meter.md). The countdown
 *  ticks locally every second between polls so it doesn't stall. */
function SessionUsageRow({ stats }: { stats: SessionUsageStats }) {
  const active = stats.blockEndIso !== null;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);

  if (!active) {
    return (
      <div className="flex items-center gap-1.5 px-3 h-7 text-[11px] text-muted-foreground">
        <Zap size={11} className="shrink-0 text-muted-foreground/60" />
        <span>No active session</span>
      </div>
    );
  }

  const secondsLeft = (new Date(stats.blockEndIso!).getTime() - now) / 1000;
  const limit = stats.estimatedLimitTokens;
  const fraction = limit ? Math.min(1, stats.tokensUsed / limit) : null;

  return (
    <div className="flex flex-col gap-1.5 px-3 py-1.5">
      <div className="flex items-center gap-1.5 text-[11px]">
        <Zap size={11} className="shrink-0 text-primary" />
        <span className="tabular-nums text-foreground">
          {formatTokens(stats.tokensUsed)}{limit !== null ? ` / ~${formatTokens(limit)}` : ''}
        </span>
        <span className="text-muted-foreground">this session</span>
        <span className="ml-auto tabular-nums text-muted-foreground shrink-0">resets in {formatDuration(secondsLeft)}</span>
      </div>
      {fraction !== null ? (
        <div className="h-1 rounded-full bg-border-hover overflow-hidden" role="progressbar" aria-valuenow={Math.round(fraction * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className={cn('h-full rounded-full transition-[width] duration-300', barColor(fraction))} style={{ width: `${fraction * 100}%` }} />
        </div>
      ) : (
        <div className="text-[10px] text-muted-foreground/60">Estimating your usual limit — needs a few full sessions first.</div>
      )}
    </div>
  );
}

export default function UsageMeter() {
  const settings = useSettings();
  const [dailyStats, setDailyStats] = useState<UsageStats | null>(null);
  const [sessionStats, setSessionStats] = useState<SessionUsageStats | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchStats = () => {
      ipc.getUsageStats().then((s) => { if (!cancelled) setDailyStats(s); }).catch(() => {});
      ipc.getSessionUsageStats().then((s) => { if (!cancelled) setSessionStats(s); }).catch(() => {});
    };
    fetchStats();
    // Floor of 5s guards against a corrupt/zero setting spinning the timer.
    const timer = setInterval(fetchStats, Math.max(5, settings.usageRefreshSeconds) * 1000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [settings.usageRefreshSeconds]);

  const dailyAvailable = !!dailyStats?.available && (dailyStats.totalTokens > 0 || dailyStats.cacheReadTokens > 0);
  const sessionAvailable = !!sessionStats?.available;
  if (!dailyAvailable && !sessionAvailable) return null;

  const modelBreakdown = dailyStats ? Object.entries(dailyStats.byModel).sort((a, b) => b[1] - a[1]) : [];

  return (
    <div className="border-t border-border shrink-0">
      {sessionAvailable && <SessionUsageRow stats={sessionStats!} />}

      {dailyAvailable && (
        <div className={cn(sessionAvailable && 'border-t border-border')}>
          <button
            className="flex items-center gap-1.5 w-full h-8 px-3 text-[11px] text-muted-foreground hover:text-foreground hover:bg-white/4 border-none cursor-pointer font-inherit"
            onClick={() => setExpanded((e) => !e)}
            title="Fresh tokens used today"
          >
            <Activity size={12} className="shrink-0" />
            <span className="tabular-nums">{formatTokens(dailyStats!.totalTokens)} tokens today</span>
            <ChevronRight size={11} className={cn('shrink-0 ml-auto text-muted-foreground/60 transition-transform duration-150', expanded && 'rotate-90')} />
          </button>

          {expanded && (
            <div className="pb-2 px-3">
              <div className="ml-4 pl-2 border-l border-border flex flex-col gap-0.5">
                {modelBreakdown.map(([model, tokens]) => (
                  <div key={model} className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground py-0.5">
                    <span className="truncate">{model}</span>
                    <span className="tabular-nums shrink-0">{tokens.toLocaleString()}</span>
                  </div>
                ))}
                {dailyStats!.cacheReadTokens > 0 && (
                  <div className="flex items-center justify-between gap-2 text-[10.5px] text-muted-foreground/60 py-0.5 mt-0.5 border-t border-border/60 pt-1">
                    <span className="truncate">cache reads (near-free)</span>
                    <span className="tabular-nums shrink-0">{dailyStats!.cacheReadTokens.toLocaleString()}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
