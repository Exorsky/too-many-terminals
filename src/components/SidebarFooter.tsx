import { useEffect, useState } from 'react';
import {
  CalendarClock, Check, Folder, History, MoreHorizontal, PanelLeftClose, Search, Settings, TerminalSquare, Zap,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import * as ipc from '@/lib/ipc';
import { useSettings } from '@/lib/settings-store';
import type { SessionUsageStats, UsageWindow } from '@/types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

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

/** Marks whichever of History/Settings is currently open. */
function ActiveCheck() {
  return <span title="Currently open" className="ml-auto flex"><Check size={13} className="text-primary" /></span>;
}

/** One rate-limit window inside the menu: the official percentage, a progress
 *  bar, and a countdown to reset that ticks locally every second. */
function UsageRow({ label, icon: Icon, window: w, now }: { label: string; icon: LucideIcon; window: UsageWindow; now: number }) {
  const secondsLeft = (new Date(w.resetsAtIso).getTime() - now) / 1000;

  return (
    <div className="flex flex-col gap-1.5 px-2 py-1.5">
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

interface SidebarFooterProps {
  showHome: boolean;
  showFiles: boolean;
  showHistory: boolean;
  showSettings: boolean;
  onGoHome: () => void;
  onToggleFiles: () => void;
  onToggleCollapse: () => void;
  onOpenSearch: () => void;
  onToggleHistory: () => void;
  onToggleSettings: () => void;
}

/** One always-visible navigation square. Home and Files are destinations you
 *  bounce between while working, so they stay in the open rather than behind
 *  the menu — the same call docs/design.md already made for Files. */
function NavButton({ icon: Icon, label, active, onClick }: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-active={active}
      aria-label={label}
      title={label}
      className={cn(
        'flex items-center justify-center w-6 h-6 rounded-sm shrink-0 border-none cursor-pointer bg-transparent',
        active ? 'text-foreground bg-white/8' : 'text-muted-foreground hover:text-foreground hover:bg-white/8',
      )}
      onClick={onClick}
    >
      <Icon size={13} />
    </button>
  );
}

/** The sidebar's bottom row, and now the only place app chrome lives. Both
 *  rows at the top of the sidebar answer a question about *the list* — what to
 *  show, and from where — so navigation moved down here rather than claiming a
 *  third row above it: Home, Files and the collapse toggle as always-visible
 *  squares, both usage percentages glanceable next to them, and the occasional
 *  detours (Search, History, Settings) plus the reset countdowns behind one
 *  "more" menu. History/Settings stay reachable even when usage stats fail to
 *  load — they're navigation, not usage display.
 *  See docs/features/usage-meter.md. */
export default function SidebarFooter({
  showHome, showFiles, showHistory, showSettings,
  onGoHome, onToggleFiles, onToggleCollapse, onOpenSearch, onToggleHistory, onToggleSettings,
}: SidebarFooterProps) {
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

  // A live fetch is current by definition. A cached fallback is only as fresh
  // as the last time Claude Code rendered usage itself — which can be hours —
  // so age it rather than passing a stale percentage off as live.
  const staleMinutes = stats?.fromCache && stats.fetchedAtMs ? Math.floor((now - stats.fetchedAtMs) / 60_000) : 0;

  return (
    <div className="flex items-center gap-0.5 h-8 px-1.5 shrink-0 border-t border-border">
      <NavButton icon={TerminalSquare} label="Home" active={showHome} onClick={onGoHome} />
      <NavButton icon={Folder} label="File explorer" active={showFiles} onClick={onToggleFiles} />
      <NavButton icon={PanelLeftClose} label="Hide sidebar" onClick={onToggleCollapse} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Search, history, settings"
            className="flex items-center gap-2.5 ml-auto h-6 px-1.5 rounded-sm shrink-0 text-[10.5px] text-muted-foreground hover:text-foreground hover:bg-white/8 cursor-pointer bg-transparent border-none font-inherit"
          >
            {stats?.session && (
              <span className="flex items-center gap-1 tabular-nums">
                <Zap size={11} className="text-primary shrink-0" />{stats.session.percent}%
              </span>
            )}
            {stats?.week && (
              <span className="flex items-center gap-1 tabular-nums">
                <CalendarClock size={11} className="text-primary shrink-0" />{stats.week.percent}%
              </span>
            )}
            <MoreHorizontal size={14} className="shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" sideOffset={6} className="w-56">
          {stats?.session && <UsageRow label="Session" icon={Zap} window={stats.session} now={now} />}
          {stats?.week && <UsageRow label="This week" icon={CalendarClock} window={stats.week} now={now} />}
          {staleMinutes >= 5 && (
            <div className="px-2 pb-1 text-[10px] text-muted-foreground/60 tabular-nums">cached — as of {formatDuration(staleMinutes * 60)} ago</div>
          )}
          {(stats?.session || stats?.week) && <DropdownMenuSeparator />}
          <DropdownMenuItem onClick={onOpenSearch}>
            <Search size={13} />
            <span>Search sessions</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onToggleHistory}>
            <History size={13} />
            <span>History</span>
            {showHistory && <ActiveCheck />}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onToggleSettings}>
            <Settings size={13} />
            <span>Settings</span>
            {showSettings && <ActiveCheck />}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
