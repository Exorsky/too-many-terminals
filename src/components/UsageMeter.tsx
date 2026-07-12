import { useEffect, useState } from 'react';
import { Activity, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import * as ipc from '@/lib/ipc';
import type { UsageStats } from '@/types';

const POLL_INTERVAL_MS = 60_000;

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

export default function UsageMeter() {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchStats = () => {
      ipc.getUsageStats().then((s) => {
        if (!cancelled) setStats(s);
      }).catch(() => {});
    };
    fetchStats();
    const timer = setInterval(fetchStats, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  if (!stats || !stats.available || (stats.totalTokens === 0 && stats.cacheReadTokens === 0)) return null;

  const modelBreakdown = Object.entries(stats.byModel).sort((a, b) => b[1] - a[1]);

  return (
    <div className="border-t border-border shrink-0">
      <button
        className="flex items-center gap-1.5 w-full h-8 px-3 text-[11px] text-muted-foreground hover:text-foreground hover:bg-white/4 border-none cursor-pointer font-inherit"
        onClick={() => setExpanded((e) => !e)}
        title="Fresh tokens used today"
      >
        <Activity size={12} className="shrink-0" />
        <span className="tabular-nums">{formatTokens(stats.totalTokens)} tokens today</span>
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
            {stats.cacheReadTokens > 0 && (
              <div className="flex items-center justify-between gap-2 text-[10.5px] text-muted-foreground/60 py-0.5 mt-0.5 border-t border-border/60 pt-1">
                <span className="truncate">cache reads (near-free)</span>
                <span className="tabular-nums shrink-0">{stats.cacheReadTokens.toLocaleString()}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
