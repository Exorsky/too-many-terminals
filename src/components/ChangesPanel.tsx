import { Fragment, useEffect, useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import * as ipc from '@/lib/ipc';
import type { FileStat, GitChanges, GitCommit } from '@/lib/ipc';
import { useGitStatus } from '@/lib/git';
import { layoutGraph, type GraphRow } from '@/lib/git-graph';
import { cn } from '@/lib/utils';
import type { Tab } from '@/types';
import GitBranch, { gitCodeClass } from './GitBranch';

type Scope = 'session' | 'uncommitted' | 'graph';

/** Deleted lines: a muted red, not the status red — that one means "this
 *  session errored" and is reserved. */
export const DEL_CLASS = 'text-[color-mix(in_srgb,var(--destructive)_60%,var(--muted-foreground))]';

export function Stat({ added, deleted }: { added: number; deleted: number }) {
  if (!added && !deleted) return null;
  return (
    <span className="shrink-0 font-mono tabular-nums text-[11px] whitespace-nowrap">
      {added > 0 && <span className="text-cyan">+{added}</span>}
      {added > 0 && deleted > 0 && ' '}
      {deleted > 0 && <span className={DEL_CLASS}>−{deleted}</span>}
    </span>
  );
}

/** Five cells, filled in proportion: which files changed a lot, at a glance. */
function Bar({ added, deleted }: { added: number; deleted: number }) {
  const total = added + deleted;
  let a = total ? Math.round((5 * added) / total) : 0;
  let d = deleted ? 5 - a : 0;
  if (deleted && d === 0) { d = 1; a = 4; }
  return (
    <span className="inline-flex gap-px shrink-0" aria-hidden>
      {Array.from({ length: 5 }, (_, i) => (
        <i key={i} className={cn('block w-[5px] h-[7px] rounded-[1px]', i < a ? 'bg-cyan' : i < a + d ? 'bg-[color-mix(in_srgb,var(--destructive)_60%,var(--muted-foreground))]' : 'bg-border-hover')} />
      ))}
    </span>
  );
}

const sum = (files: FileStat[]) => files.reduce((s, f) => ({ added: s.added + f.added, deleted: s.deleted + f.deleted }), { added: 0, deleted: 0 });

/** "14:45" today, "29.10 14:45" before — local time. */
function when(unix: number): string {
  const d = new Date(unix * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  const t = `${p(d.getHours())}:${p(d.getMinutes())}`;
  return d.toDateString() === new Date().toDateString() ? t : `${p(d.getDate())}.${p(d.getMonth() + 1)} ${t}`;
}

/** Release and merge commits only move version numbers or join lines: one
 *  quiet line, no stat. */
const isQuiet = (c: GitCommit) => /^chore\(release\)|^Merge /.test(c.subject);

/** What changed in the session's folder: uncommitted files first (that's
 *  what still needs you), then the session's own commits, or the branch
 *  graph. Read-only; a file opens as a diff beside the session. Refreshes when
 *  the folder's git status does — a run ending, the window regaining focus.
 *  See docs/features/git.md. */
export default function ChangesPanel({ session, onOpenDiff }: {
  session: Tab;
  onOpenDiff: (dir: string, path: string, commit: string | null) => void;
}) {
  const dir = session.cwd;
  const status = useGitStatus(dir);
  const [scope, setScope] = useState<Scope>(session.gitStart ? 'session' : 'uncommitted');
  const [changes, setChanges] = useState<GitChanges | null>(null);
  const [graph, setGraph] = useState<GitCommit[] | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => { setScope(session.gitStart ? 'session' : 'uncommitted'); setOpen(new Set()); }, [session.id, session.gitStart]);

  useEffect(() => {
    if (!status) return;
    let alive = true;
    if (scope === 'graph') {
      Promise.resolve().then(() => ipc.gitGraph(dir)).then((g) => { if (alive) setGraph(g ?? []); }).catch(() => {});
    } else {
      Promise.resolve()
        .then(() => ipc.gitChanges(dir, scope === 'session' ? session.gitStart ?? null : null))
        .then((c) => { if (alive) setChanges(c); })
        .catch(() => {});
    }
    return () => { alive = false; };
  }, [dir, scope, session.gitStart, status]);

  const rows = useMemo(() => (graph ? layoutGraph(graph) : []), [graph]);

  if (!status) {
    return <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">Not a git repository</div>;
  }

  const commits = scope === 'session' ? changes?.commits ?? [] : [];
  const uncommitted = changes?.uncommitted ?? [];
  const total = sum([...uncommitted, ...commits.flatMap((c) => c.files)]);
  const pick = (path: string, commit: string | null) => {
    setSelected(`${commit ?? 'work'}:${path}`);
    onOpenDiff(dir, path, commit);
  };

  const fileRow = (f: FileStat, commit: string | null, nested: boolean) => {
    const key = `${commit ?? 'work'}:${f.path}`;
    const slash = f.path.replace(/\/$/, '').lastIndexOf('/');
    return (
      <button
        key={key}
        type="button"
        title={f.path}
        className={cn(
          'flex items-center gap-2 w-[calc(100%-12px)] h-6 mx-1.5 px-2 rounded-sm border-none cursor-pointer font-inherit text-left text-[12px]',
          selected === key ? 'bg-selected text-foreground' : 'bg-transparent text-dim hover:bg-hover hover:text-foreground',
          nested && 'pl-7',
        )}
        onClick={() => pick(f.path, commit)}
      >
        <span className={cn('w-3 shrink-0 text-center font-mono text-[10.5px] font-semibold', gitCodeClass(f.code))}>{f.code}</span>
        <span className="flex-1 min-w-0 truncate">
          {slash >= 0 && <span className="text-muted-foreground">{f.path.slice(0, slash + 1)}</span>}
          {f.path.slice(slash + 1)}
        </span>
        <Stat added={f.added} deleted={f.deleted} />
        <Bar added={f.added} deleted={f.deleted} />
      </button>
    );
  };

  return (
    <div className="flex flex-col w-full h-full min-h-0">
      <div className="flex items-center gap-1 px-2.5 py-2 shrink-0 border-b border-border">
        {([['session', 'This session'], ['uncommitted', 'Uncommitted'], ['graph', 'Graph']] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={scope === id}
            disabled={id === 'session' && !session.gitStart}
            title={id === 'session' && !session.gitStart ? 'This session started before the app recorded where git stood' : undefined}
            className={cn(
              'h-6 px-2.5 rounded-full border text-[11.5px] cursor-pointer font-inherit disabled:opacity-40 disabled:cursor-default',
              scope === id ? 'border-border-hover bg-selected text-foreground' : 'border-border bg-transparent text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setScope(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 px-3 py-1.5 shrink-0 border-b border-border text-[11.5px] text-muted-foreground">
        <GitBranch status={status} className="min-w-0 text-dim" />
        {scope !== 'graph' && <span className="ml-auto"><Stat {...total} /></span>}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin pb-2">
        {scope === 'graph' ? (
          <GraphList rows={rows} sessionStart={session.gitStart ?? null} />
        ) : !changes ? (
          <div className="px-3 py-4 text-[12px] text-muted-foreground">Loading…</div>
        ) : (
          <>
            <Section label="Uncommitted" right={<Stat {...sum(uncommitted)} />} />
            {uncommitted.length === 0
              ? <div className="px-4 py-1 text-[12px] text-faint">Nothing uncommitted</div>
              : uncommitted.map((f) => fileRow(f, null, false))}
            {scope === 'session' && (
              <>
                <Section label="Committed this session" right={<span className="font-mono">{commits.length}</span>} />
                {changes.diverged && (
                  <div className="px-4 py-1 text-[12px] text-muted-foreground">The branch moved away from where this session started, so its commits can&apos;t be told apart.</div>
                )}
                {!changes.diverged && commits.length === 0 && <div className="px-4 py-1 text-[12px] text-faint">No commits yet</div>}
                {commits.map((c) => {
                  const expanded = open.has(c.oid);
                  return (
                    <Fragment key={c.oid}>
                      <button
                        type="button"
                        aria-expanded={expanded}
                        className="flex items-center gap-2 w-[calc(100%-12px)] h-[26px] mx-1.5 px-2 rounded-sm border-none bg-transparent cursor-pointer font-inherit text-left text-[12px] text-dim hover:bg-hover hover:text-foreground"
                        onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(c.oid)) n.delete(c.oid); else n.add(c.oid); return n; })}
                      >
                        <ChevronRight size={11} className={cn('shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')} />
                        <span className="w-[52px] shrink-0 font-mono text-[11px] text-muted-foreground">{c.short}</span>
                        <span className={cn('flex-1 min-w-0 truncate', expanded && 'text-foreground')} title={c.subject}>{c.subject}</span>
                        {isQuiet(c)
                          ? <span className="shrink-0 font-mono text-[10.5px] text-faint">{when(c.time)}</span>
                          : <Stat {...sum(c.files)} />}
                      </button>
                      {expanded && c.files.map((f) => fileRow(f, c.oid, true))}
                    </Fragment>
                  );
                })}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Section({ label, right }: { label: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 px-3 pt-3 pb-1 text-[11px] font-semibold text-muted-foreground">
      {label}<span className="ml-auto font-normal">{right}</span>
    </div>
  );
}

const ROW = 26;
const LANE = 12;
/** Lane colors cycle through the theme's accents — none of them a status
 *  color. Lane 0, the mainline, is the quietest. */
const LANE_COLORS = ['var(--muted-foreground)', 'var(--primary)', 'var(--cyan)', 'var(--magenta)', 'var(--link)'];
const laneColor = (i: number) => LANE_COLORS[i % LANE_COLORS.length];

/** How the branches fork and merge: a lane per line of history, dots for
 *  commits, branch and tag names beside the commit they point at. The
 *  session's starting commit is marked, so "since I started" has a place. */
function GraphList({ rows, sessionStart }: { rows: GraphRow[]; sessionStart: string | null }) {
  if (rows.length === 0) return <div className="px-3 py-4 text-[12px] text-muted-foreground">Loading…</div>;
  const width = Math.max(...rows.map((r) => r.width));
  const gutter = width * LANE + 8;
  const x = (i: number) => 8 + i * LANE;
  return (
    <div className="py-1">
      {rows.map((r) => {
        const head = r.commit.refs.includes('HEAD');
        const isStart = sessionStart !== null && r.commit.oid === sessionStart;
        return (
          <div key={r.commit.oid} className="flex items-center gap-2 pr-2" style={{ height: ROW }} title={`${r.commit.short} · ${when(r.commit.time)}\n${r.commit.subject}`}>
            <svg width={gutter} height={ROW} className="shrink-0" aria-hidden>
              {r.top.map(([from, to], i) => (
                <line key={`t${i}`} x1={x(from)} y1={0} x2={x(to)} y2={ROW / 2} stroke={laneColor(from)} strokeWidth={1.5} />
              ))}
              {r.bottom.map(([from, to], i) => (
                <line key={`b${i}`} x1={x(from)} y1={ROW / 2} x2={x(to)} y2={ROW} stroke={laneColor(to)} strokeWidth={1.5} />
              ))}
              <circle
                cx={x(r.col)} cy={ROW / 2} r={head ? 4.5 : 3.5}
                fill={head ? 'var(--background)' : laneColor(r.col)}
                stroke={laneColor(r.col)} strokeWidth={head ? 2 : 0}
              />
            </svg>
            <span className="w-[52px] shrink-0 font-mono text-[11px] text-muted-foreground">{r.commit.short}</span>
            {r.commit.refs.filter((ref) => ref !== 'HEAD').map((ref) => (
              <span
                key={ref}
                className={cn(
                  'shrink-0 max-w-[120px] truncate px-1.5 rounded-sm border font-mono text-[10.5px] leading-4',
                  ref.includes('/') ? 'border-border text-muted-foreground' : 'border-border-hover text-foreground',
                )}
              >
                {ref}
              </span>
            ))}
            {isStart && <span className="shrink-0 px-1.5 rounded-sm bg-raised text-[10.5px] leading-4 text-dim">session start</span>}
            <span className={cn('flex-1 min-w-0 truncate text-[12px]', head ? 'text-foreground' : 'text-dim')}>{r.commit.subject}</span>
          </div>
        );
      })}
    </div>
  );
}
