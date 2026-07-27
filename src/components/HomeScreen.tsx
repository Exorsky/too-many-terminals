import { useEffect, useMemo, useRef, useState } from 'react';
import { FolderOpen, History, Plus } from 'lucide-react';
import * as ipc from '@/lib/ipc';
import { relativeTime } from '@/lib/relative-time';
import { cn, folderName } from '@/lib/utils';
import { projectHue, type SessionHistoryEntry, type Tab, type TabStatus } from '@/types';

/** Windows per tower column, capped so even a 50-session folder stays short
 *  enough to fit the pane without measuring it. */
const MAX_ROWS = 12;
/** Dark floors left above the lit ones — the room this folder has left to grow. */
const EMPTY_FLOORS = 2;
/** How often a single lit window flickers. Paused while the window is unfocused. */
const FLICKER_MS = 4200;
/** How long a session takes to cool from "just now" to as dim as it ever gets. */
const COLD_AFTER_DAYS = 60;

/** A live Claude tab standing behind a window. */
interface Live {
  tabId: string;
  status: TabStatus;
}

/** One window. Either a past session you can resume, or a session running right
 *  now — including one so new it hasn't been written to history yet, which has
 *  no `entry` and can only be opened by its tab. */
interface Win {
  key: string;
  preview: string;
  /** Null for a live session with no history entry yet. */
  entry: SessionHistoryEntry | null;
  live: Live | null;
}

interface Tower {
  dir: string;
  name: string;
  hue: number;
  /** Newest first — index 0 lights the top floor. */
  wins: Win[];
  cols: number;
}

interface HomeScreenProps {
  projects: string[];
  /** Open tabs, so a running session's window shows its live state. */
  tabs: Tab[];
  onResume: (projectDir: string, entry: SessionHistoryEntry) => void;
  onSelectTab: (tabId: string) => void;
  onNewSession: (projectDir: string) => void;
  onAddProject: () => void;
  onOpenHistory: () => void;
}

/** Grid width that keeps a tower under MAX_ROWS floors. */
function columnsFor(count: number): number {
  return Math.min(6, Math.max(2, Math.ceil(count / MAX_ROWS)));
}

/** How warm a session still is, 1 (minutes ago) to 0 (cold), from *elapsed
 *  time* rather than its rank in the folder's list. Rank would light the newest
 *  session of a folder you abandoned in March exactly as brightly as one from
 *  this morning. Log-scaled, so the first few days carry most of the range —
 *  that's where the difference actually matters. */
export function warmth(iso: string, now: number = Date.now()): number {
  const days = Math.max(0, (now - new Date(iso).getTime()) / 86_400_000);
  if (!Number.isFinite(days)) return 0;
  return Math.max(0, 1 - Math.log1p(days) / Math.log1p(COLD_AFTER_DAYS));
}

/** Same vocabulary the sidebar's status dot uses. */
function statusLabel(status: TabStatus): string {
  switch (status) {
    case 'working': return 'Working';
    case 'requires_response': return 'Waiting on you';
    case 'idle': return 'Open, resting';
    case 'new': return 'Starting';
  }
}

export default function HomeScreen({
  projects,
  tabs,
  onResume,
  onSelectTab,
  onNewSession,
  onAddProject,
  onOpenHistory,
}: HomeScreenProps) {
  const [byProject, setByProject] = useState<Map<string, SessionHistoryEntry[]> | null>(null);
  const [hovered, setHovered] = useState<{ tower: Tower; win: Win } | null>(null);
  const skylineRef = useRef<HTMLDivElement>(null);

  // Same read the History panel does — listSessions only scans each session
  // file until it finds the first real user message, so this is cheap enough
  // to run on every visit to Home.
  useEffect(() => {
    if (projects.length === 0) {
      setByProject(new Map());
      return;
    }
    let cancelled = false;
    Promise.all(
      projects.map((dir): Promise<[string, SessionHistoryEntry[]]> =>
        ipc.listSessions(dir).catch((): SessionHistoryEntry[] => []).then((list) => [dir, list]),
      ),
    ).then((pairs) => {
      if (!cancelled) setByProject(new Map(pairs));
    });
    return () => { cancelled = true; };
  }, [projects]);

  /** Running Claude sessions, keyed by the session id their window carries. */
  const liveBySession = useMemo(() => {
    const map = new Map<string, Live>();
    for (const tab of tabs) {
      if (tab.kind !== 'claude' || tab.exited || !tab.resumeSessionId) continue;
      map.set(tab.resumeSessionId, { tabId: tab.id, status: tab.status });
    }
    return map;
  }, [tabs]);

  /** Towers ordered by last activity, most recent on the left. */
  const towers = useMemo<Tower[]>(() => {
    if (!byProject) return [];
    return projects
      .map((dir, index): Tower => {
        const sessions = byProject.get(dir) ?? [];
        const recorded = new Set(sessions.map((s) => s.sessionId));
        // A session started moments ago has no history entry yet — either its id
        // hasn't been resolved or the transcript wasn't on disk when Home read
        // it. Give it a floor of its own, above the recorded ones.
        const unrecorded = tabs
          .filter((t) => t.kind === 'claude' && !t.exited && t.cwd === dir
            && (!t.resumeSessionId || !recorded.has(t.resumeSessionId)))
          .map((t): Win => ({
            key: t.id,
            preview: t.name,
            entry: null,
            live: { tabId: t.id, status: t.status },
          }));
        const wins: Win[] = [
          ...unrecorded,
          ...sessions.map((entry): Win => ({
            key: entry.sessionId,
            preview: entry.preview,
            entry,
            live: liveBySession.get(entry.sessionId) ?? null,
          })),
        ];
        return { dir, name: folderName(dir), hue: projectHue(index), wins, cols: columnsFor(wins.length) };
      })
      // A folder with something running sorts first; otherwise by last activity.
      .sort((a, b) => {
        const liveDiff = Number(b.wins.some((w) => w.live)) - Number(a.wins.some((w) => w.live));
        if (liveDiff) return liveDiff;
        return (b.wins[0]?.entry?.lastUsedIso ?? '').localeCompare(a.wins[0]?.entry?.lastUsedIso ?? '');
      });
  }, [byProject, projects, tabs, liveBySession]);

  const totalSessions = towers.reduce((n, t) => n + t.wins.length, 0);
  const running = towers.flatMap((t) => t.wins).filter((w) => w.live);
  const waiting = running.filter((w) => w.live?.status === 'requires_response').length;

  // Ambient life: one random window dips and comes back. Skipped entirely
  // while the app is in the background so an idle Home costs nothing.
  useEffect(() => {
    if (totalSessions === 0) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const id = setInterval(() => {
      if (document.hidden || !document.hasFocus()) return;
      // Live windows have their own state animation — leave them alone.
      const lit = skylineRef.current?.querySelectorAll<HTMLElement>('.home-win-lit:not(.home-win-live)');
      if (!lit?.length) return;
      const win = lit[Math.floor(Math.random() * lit.length)];
      win.classList.add('home-flicker');
      setTimeout(() => win.classList.remove('home-flicker'), 950);
    }, FLICKER_MS);
    return () => clearInterval(id);
  }, [totalSessions]);

  /** Arrow keys walk the floors of the focused tower; Tab moves between towers. */
  const handleFloorKeys = (e: React.KeyboardEvent<HTMLDivElement>, cols: number) => {
    const target = e.target as HTMLElement;
    if (!target.classList.contains('home-win-lit')) return;
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
    if (!step) return;
    const wins = [...e.currentTarget.querySelectorAll<HTMLElement>('.home-win-lit')];
    const next = wins[Math.min(wins.length - 1, Math.max(0, wins.indexOf(target) + step))];
    if (!next) return;
    e.preventDefault();
    target.tabIndex = -1;
    next.tabIndex = 0;
    next.focus();
  };

  if (!byProject) return <div className="absolute inset-0 bg-background" />;

  const empty = projects.length === 0;
  const now = Date.now();

  return (
    <div className="home absolute inset-0 flex flex-col overflow-hidden select-none">
      <div className="flex items-center justify-between gap-4 h-9 px-4 shrink-0 border-b border-[#14171e]">
        <span className="text-[10.5px] tracking-[0.34em] uppercase text-[#9498a4]">
          <b className="font-medium text-foreground">Too many</b> terminals
        </span>
        {!empty && (
          <span className="flex items-center gap-3.5 text-[10px] tracking-[0.1em] uppercase text-[#4a4e59] tabular-nums">
            <span><i className="not-italic text-[#868b98]">{projects.length}</i> folders</span>
            <span><i className="not-italic text-[#868b98]">{totalSessions}</i> sessions</span>
          </span>
        )}
      </div>

      <div className="home-scene relative flex-1 min-h-0">
        {empty ? (
          <div className="absolute inset-0 flex flex-col items-center justify-end gap-4 pb-14 text-center">
            <div className="w-32 h-[72px] border border-dashed border-[#23262f] border-b-0 grid place-items-center text-[#23262f] text-[22px]">
              +
            </div>
            <p className="home-serif text-[14.5px] text-[#9398a5] max-w-[46ch] m-0">
              No folders open yet. Open one, and every session you run there adds a window.
            </p>
          </div>
        ) : (
          <div className="absolute inset-0 overflow-x-auto overflow-y-hidden flex items-end scrollbar-thin">
            <div
              ref={skylineRef}
              className="flex items-end gap-4 mx-auto px-8 pb-[34px] [justify-content:safe_center]"
            >
              {towers.map((tower, ti) => (
                <div key={tower.dir} className="home-lot flex flex-col items-center">
                  <div
                    className="home-tower"
                    style={{ '--hue': tower.hue, animationDelay: `${ti * 95}ms` } as React.CSSProperties}
                  >
                    {ti === 0 && tower.wins.length > 0 && (
                      <span className="home-beacon" title="Last folder you worked in" />
                    )}
                    <div
                      className="grid gap-1 justify-center"
                      style={{ gridTemplateColumns: `repeat(${tower.cols}, 7px)` }}
                      onKeyDown={(e) => handleFloorKeys(e, tower.cols)}
                    >
                      {/* dark floors first: the newest session sits on the top lit floor */}
                      {Array.from({ length: EMPTY_FLOORS * tower.cols }, (_, i) => (
                        <span key={`e${i}`} className="home-win" />
                      ))}
                      {tower.wins.map((win, si) => {
                        const heat = win.entry ? warmth(win.entry.lastUsedIso, now) : 1;
                        const live = win.live;
                        return (
                          <button
                            key={win.key}
                            className={cn(
                              'home-win home-win-lit',
                              live && 'home-win-live',
                              live?.status === 'working' && 'home-win-working',
                              live?.status === 'requires_response' && 'home-win-waiting',
                            )}
                            style={{
                              '--a': live ? 1 : (0.35 + heat * 0.6).toFixed(2),
                              '--l': live ? '78%' : `${(58 + heat * 14).toFixed(0)}%`,
                              animationDelay: `${420 + ti * 95 + si * 26}ms`,
                            } as React.CSSProperties}
                            tabIndex={si === 0 ? 0 : -1}
                            title={win.preview}
                            aria-label={live
                              ? `Open ${win.preview} in ${tower.name} — ${statusLabel(live.status)}`
                              : `Resume session in ${tower.name}, ${relativeTime(win.entry!.lastUsedIso)}: ${win.preview}`}
                            onPointerEnter={() => setHovered({ tower, win })}
                            onPointerLeave={() => setHovered(null)}
                            onFocus={() => setHovered({ tower, win })}
                            onBlur={() => setHovered(null)}
                            onClick={() => (live ? onSelectTab(live.tabId) : onResume(tower.dir, win.entry!))}
                          />
                        );
                      })}
                      {Array.from(
                        { length: (tower.cols - (tower.wins.length % tower.cols)) % tower.cols },
                        (_, i) => <span key={`p${i}`} className="home-win" />,
                      )}
                    </div>
                  </div>
                  <button
                    className={cn(
                      'home-plate mt-2.5 max-w-[104px] truncate text-[9px] tracking-[0.1em] uppercase',
                      'text-[#4a4e59] hover:text-[#a2a7b4] transition-colors cursor-pointer',
                      hovered?.tower.dir === tower.dir && 'text-[#a2a7b4]',
                    )}
                    aria-label={`New session in ${tower.name}`}
                    title={tower.dir}
                    onClick={() => onNewSession(tower.dir)}
                  >
                    {tower.name} <em className="not-italic text-[#34383f]">{tower.wins.length}</em>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="home-horizon" />
        <div className="home-ground" />
      </div>

      <div className="flex items-center justify-between gap-5 shrink-0 min-h-[62px] px-4 py-2.5 border-t border-[#14171e] bg-[#0a0b0f]">
        <div className="min-w-0">
          {hovered ? (
            <>
              <div className="flex items-baseline gap-2.5 text-[10px] tracking-[0.12em] uppercase text-muted-foreground">
                <span
                  className="w-1.5 h-1.5 rounded-full self-center shrink-0"
                  style={{ background: `hsl(${hovered.tower.hue} 70% 60%)` }}
                />
                <b className="font-medium tracking-[0.06em] text-foreground">{hovered.tower.name}</b>
                <u
                  className={cn(
                    'no-underline tabular-nums',
                    hovered.win.live?.status === 'requires_response' ? 'text-attention'
                      : hovered.win.live?.status === 'working' ? 'text-warning'
                      : 'text-[#4a4e59]',
                  )}
                >
                  {hovered.win.live
                    ? statusLabel(hovered.win.live.status)
                    : relativeTime(hovered.win.entry!.lastUsedIso)}
                </u>
              </div>
              <div className="home-serif mt-0.5 text-[14px] leading-snug text-[#b7bbc6] truncate max-w-[62ch]">
                {hovered.win.preview}
              </div>
            </>
          ) : (
            <>
              <div className="text-[10px] tracking-[0.12em] uppercase text-muted-foreground">
                {running.length > 0 ? (
                  <>
                    <b className="font-medium text-foreground">{running.length} running</b>
                    {waiting > 0 && <u className="no-underline ml-2.5 text-attention">{waiting} waiting on you</u>}
                  </>
                ) : (
                  <>
                    <b className="font-medium text-foreground">Nothing running</b>
                    {totalSessions > 0 && <u className="no-underline ml-2.5 text-[#4a4e59] tabular-nums">{totalSessions} sessions kept</u>}
                  </>
                )}
              </div>
              <div className="home-serif mt-0.5 text-[14px] leading-snug text-muted-foreground">
                {empty
                  ? 'Open a folder to start your first session.'
                  : waiting > 0
                    ? 'The pulsing windows are the ones asking for you.'
                    : running.length > 0
                      ? 'Lit and steady is running; click a window to go back to it.'
                      : totalSessions > 0
                        ? 'Pick a window to pick up where you left off.'
                        : 'Start a session and this folder gets its first window.'}
              </div>
            </>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          {!empty && (
            <button className="home-act home-act-primary" onClick={() => onNewSession(towers[0]?.dir ?? projects[0])}>
              <Plus size={12} /> New session
            </button>
          )}
          <button className="home-act" onClick={onAddProject}>
            <FolderOpen size={12} /> Open folder
          </button>
          {!empty && (
            <button className="home-act" onClick={onOpenHistory}>
              <History size={12} /> All sessions
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
