import { useEffect, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import * as ipc from '@/lib/ipc';
import { formatCompact, sessionTokens, summarize } from '@/lib/stats';
import type { SessionStat, Tab } from '@/types';

function clock(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** The inspector's Activity and Tokens: what this session changed outside the
 *  machine, listed, and what it read or ran, counted — read from the
 *  transcript, so it covers the whole session, not just this launch.
 *  See docs/features/session-activity.md. */
export default function SessionActivity({ session, onWritesSeen, Label }: {
  session: Tab;
  onWritesSeen: (count: number) => void;
  Label: (props: { children: React.ReactNode }) => React.ReactElement;
}) {
  const [stat, setStat] = useState<SessionStat | null>(null);
  const sessionId = session.resumeSessionId;
  // Re-read when a turn ends or a new write lands, not on every tool call.
  const settled = session.status !== 'working';

  useEffect(() => {
    if (!sessionId) { setStat(null); return; }
    let live = true;
    ipc.getSessionActivity(session.cwd, sessionId)
      .then((s) => {
        if (!live) return;
        setStat(s);
        if (s) onWritesSeen(s.writes.length);
      })
      .catch(() => {});
    return () => { live = false; };
    // onWritesSeen is a fresh closure each render; the inputs below are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.cwd, sessionId, settled, session.writes]);

  if (!stat) return null;
  const { cacheHitPct } = summarize([stat]);

  return (
    <>
      <Label>
        <span className="flex items-baseline">
          <span className="flex-1">Activity</span>
          <span className="font-mono tabular-nums normal-case tracking-normal font-normal">
            {stat.writes.length === 0 ? 'read-only' : `${stat.writes.length} write${stat.writes.length === 1 ? '' : 's'}`}
          </span>
        </span>
      </Label>
      <div data-session-activity className="px-1">
        {stat.writes.map((w, i) => (
          <div key={i} className="grid grid-cols-[40px_12px_1fr] gap-1.5 items-start px-2 py-1 rounded-sm text-[12px] hover:bg-hover">
            <span className="font-mono tabular-nums text-[10.5px] leading-[18px] text-muted-foreground">{clock(w.atIso)}</span>
            <ArrowUpRight size={12} className="mt-[3px] text-dim" />
            <span className="min-w-0 break-words font-mono text-[11px] leading-[18px] text-dim" title={w.label}>{w.label}</span>
          </div>
        ))}
        <div className="flex gap-3 px-2 py-1 font-mono tabular-nums text-[11px] text-muted-foreground">
          <span>{stat.reads} reads</span>
          <span>{stat.shell} shell</span>
          <span>{stat.edits} edits</span>
        </div>
      </div>

      <Label>Tokens</Label>
      <div className="grid grid-cols-3 gap-1.5 px-3">
        {[
          [formatCompact(sessionTokens(stat)), 'total'],
          [cacheHitPct === null ? '—' : `${cacheHitPct}%`, 'cache hit'],
          [String(stat.turns), 'turns'],
        ].map(([value, label]) => (
          <div key={label} className="px-2 py-1.5 rounded-sm border border-border">
            <div className="font-mono tabular-nums text-[13px] text-foreground">{value}</div>
            <div className="text-[10.5px] text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>
    </>
  );
}
