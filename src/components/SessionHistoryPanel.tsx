import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CalendarDays, FileText, History, Loader2, Search, Trash2, X } from 'lucide-react';
import { projectHue, type SessionHistoryEntry } from '@/types';
import { relativeTime } from '@/lib/relative-time';
import { calendarMonths, dayKey, type CalendarMark } from '@/lib/stats';
import * as ipc from '@/lib/ipc';
import { cn, folderName } from '@/lib/utils';
import SessionCalendar from './SessionCalendar';

interface HistoryEntry extends SessionHistoryEntry {
  /** Which open project this session belongs to. */
  projectDir: string;
}

interface SessionHistoryPanelProps {
  projects: string[];
  /** Session id → name, from the workspace store (see App.tsx). The transcript
   *  carries no name of its own, and a tab's name dies with the tab, so this is
   *  what keeps a row calling a session what the sidebar called it. */
  sessionNames: Record<string, string>;
  onResume: (projectDir: string, entry: SessionHistoryEntry) => void;
  onRead: (projectDir: string, entry: SessionHistoryEntry) => void;
}

type DayGroup = 'Today' | 'Yesterday' | 'Earlier';
const DAY_GROUPS: DayGroup[] = ['Today', 'Yesterday', 'Earlier'];

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Calendar-day comparison, not a fixed hour window — a session from 11pm
 *  yesterday and one from 1am today are both "recent" in elapsed time but
 *  belong in different buckets. */
function dayGroup(iso: string, now: Date): DayGroup {
  const diffDays = Math.round((startOfDay(now) - startOfDay(new Date(iso))) / 86_400_000);
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return 'Earlier';
}

/** Today/Yesterday rows only need a clock time — the day heading already
 *  carries the date. "Earlier" spans many different real days, so show the
 *  calendar date there instead. */
function absoluteLabel(iso: string, group: DayGroup): string {
  const d = new Date(iso);
  const clock = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (group !== 'Earlier') return clock;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${clock}`;
}

/** "Aug 13" from a `dayKey()` string, for the picked-day chip. */
function dayFilterLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function fullTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-primary/25 text-inherit rounded-[2px]">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export default function SessionHistoryPanel({ projects, sessionNames, onResume, onRead }: SessionHistoryPanelProps) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [dayFilter, setDayFilter] = useState<string | null>(null);
  const [showCalendar, setShowCalendar] = useState(true);
  const [activeIndex, setActiveIndex] = useState(-1);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => new Date(), [entries]);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    Promise.all(projects.map((dir) =>
      ipc.listSessions(dir).then((list) => list.map((e): HistoryEntry => ({ ...e, projectDir: dir })))))
      .then((lists) => {
        if (cancelled) return;
        const merged = lists.flat().sort((a, b) => b.lastUsedIso.localeCompare(a.lastUsedIso));
        setEntries(merged);
      })
      .catch(() => { if (!cancelled) setEntries([]); });
    return () => { cancelled = true; };
  }, [projects]);

  // Split in two: the calendar draws `searched`, so picking a day never empties
  // the grid you picked it from, while the list draws that minus the day.
  const searched = useMemo(() => {
    if (!entries) return [];
    const q = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (projectFilter !== 'all' && entry.projectDir !== projectFilter) return false;
      if (!q) return true;
      const name = sessionNames[entry.sessionId];
      return entry.preview.toLowerCase().includes(q)
        || folderName(entry.projectDir).toLowerCase().includes(q)
        || !!name?.toLowerCase().includes(q);
    });
  }, [entries, query, projectFilter, sessionNames]);

  const filteredEntries = useMemo(
    () => (dayFilter ? searched.filter((e) => dayKey(e.lastUsedIso) === dayFilter) : searched),
    [searched, dayFilter],
  );

  const months = useMemo(() => calendarMonths(
    searched.map((e): CalendarMark => ({
      iso: e.lastUsedIso,
      hue: projectHue(Math.max(0, projects.indexOf(e.projectDir))),
      projectName: folderName(e.projectDir),
    })),
    now.getTime(),
  ), [searched, projects, now]);

  // Entries arrive pre-sorted most-recent-first, so a flat filtered list
  // already matches the Today/Yesterday/Earlier render order below.
  const groupedEntries = useMemo(() => {
    const map = new Map<DayGroup, HistoryEntry[]>();
    for (const entry of filteredEntries) {
      const g = dayGroup(entry.lastUsedIso, now);
      (map.get(g) ?? map.set(g, []).get(g)!).push(entry);
    }
    return map;
  }, [filteredEntries, now]);

  useEffect(() => {
    setActiveIndex(-1);
  }, [query, projectFilter, dayFilter]);

  useEffect(() => {
    if (activeIndex < 0) return;
    const entry = filteredEntries[activeIndex];
    if (entry) rowRefs.current.get(entry.sessionId)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, filteredEntries]);

  const handleDelete = useCallback(async (entry: HistoryEntry) => {
    setPendingDeleteId(null);
    setEntries((prev) => prev?.filter((e) => e.sessionId !== entry.sessionId) ?? prev);
    await ipc.deleteSession(entry.projectDir, entry.sessionId).catch(() => {});
  }, []);

  const moveActive = useCallback((delta: number) => {
    setActiveIndex((i) => {
      if (!filteredEntries.length) return -1;
      const base = i < 0 ? (delta > 0 ? -1 : 0) : i;
      return Math.max(0, Math.min(filteredEntries.length - 1, base + delta));
    });
  }, [filteredEntries.length]);

  const handlePanelKeyDown = useCallback((e: React.KeyboardEvent) => {
    const inSearch = document.activeElement === searchInputRef.current;

    if (e.key === '/' && !inSearch) {
      e.preventDefault();
      searchInputRef.current?.focus();
      return;
    }
    if ((e.key === 'c' || e.key === 'C') && !inSearch) {
      e.preventDefault();
      setShowCalendar((v) => !v);
      return;
    }
    if (inSearch) {
      if (e.key === 'Escape') {
        if (query) { setQuery(''); } else { searchInputRef.current?.blur(); }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        searchInputRef.current?.blur();
        moveActive(1);
      }
      return;
    }

    const active = filteredEntries[activeIndex];
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        moveActive(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveActive(-1);
        break;
      case 'Enter':
        if (active && pendingDeleteId !== active.sessionId) onResume(active.projectDir, active);
        break;
      case ' ':
        if (active && pendingDeleteId !== active.sessionId) { e.preventDefault(); onRead(active.projectDir, active); }
        break;
      case 'Delete':
      case 'Backspace':
        if (active) { e.preventDefault(); setPendingDeleteId(active.sessionId); }
        break;
      case 'Escape':
        if (pendingDeleteId) setPendingDeleteId(null);
        else if (dayFilter) setDayFilter(null);
        break;
    }
  }, [filteredEntries, activeIndex, pendingDeleteId, query, dayFilter, moveActive, onResume, onRead]);

  const totalCount = entries?.length ?? 0;
  const shownCount = filteredEntries.length;
  const isFiltering = query.trim().length > 0 || projectFilter !== 'all' || dayFilter !== null;

  return (
    <div className="flex flex-col h-full overflow-hidden" onKeyDown={handlePanelKeyDown}>
      <div className="flex items-center gap-2 h-10 px-4 border-b border-border shrink-0">
        <History size={14} className="text-muted-foreground shrink-0" />
        <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          Session History
        </span>
        {entries !== null && (
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {isFiltering ? (
              <><span className="text-foreground">{shownCount}</span> of {totalCount} sessions</>
            ) : (
              <><span className="text-foreground">{totalCount}</span> sessions</>
            )}
          </span>
        )}
        {entries !== null && entries.length > 0 && (
          <button
            className={cn(
              'ml-auto flex items-center justify-center w-5.5 h-5.5 rounded-sm border cursor-pointer shrink-0',
              showCalendar
                ? 'text-primary bg-primary/10 border-primary/40'
                : 'bg-transparent border-transparent text-muted-foreground hover:text-foreground hover:bg-white/[0.07]',
            )}
            aria-pressed={showCalendar}
            title={showCalendar ? 'Hide the calendar (c)' : 'Show the calendar (c)'}
            onClick={() => setShowCalendar((v) => !v)}
          >
            <CalendarDays size={13} />
          </button>
        )}
      </div>

      {entries !== null && entries.length > 0 && (
        <div className="flex flex-col gap-2 px-4 py-2.5 border-b border-border shrink-0 bg-white/[0.008]">
          <div
            className={cn(
              'flex items-center gap-1.5 h-7 px-2.5 rounded border border-border bg-card',
              'focus-within:border-primary transition-colors',
            )}
          >
            <Search size={12} className="text-muted-foreground shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search sessions or folders…"
              autoComplete="off"
              spellCheck={false}
              className="flex-1 min-w-0 bg-transparent border-none outline-none text-[12px] text-foreground placeholder:text-muted-foreground font-inherit"
            />
            {query && (
              <button
                className="text-muted-foreground hover:text-foreground bg-transparent border-none cursor-pointer p-0.5 rounded-sm shrink-0"
                onClick={() => { setQuery(''); searchInputRef.current?.focus(); }}
                title="Clear search"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {(projects.length > 1 || dayFilter) && (
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-thin">
              {dayFilter && (
                <button
                  className="shrink-0 flex items-center gap-1.5 whitespace-nowrap text-[11px] rounded-full border border-primary/40 bg-primary/10 text-foreground px-2.5 py-[3px] cursor-pointer font-inherit"
                  onClick={() => setDayFilter(null)}
                  title="Show every date"
                >
                  {dayFilterLabel(dayFilter)}
                  <X size={10} className="text-muted-foreground" />
                </button>
              )}
              {projects.length > 1 && (
                <>
                  <button
                    className={cn(
                      'shrink-0 whitespace-nowrap text-[11px] rounded-full border px-2.5 py-[3px] cursor-pointer font-inherit transition-colors',
                      projectFilter === 'all'
                        ? 'border-primary/40 bg-primary/10 text-foreground'
                        : 'border-border text-muted-foreground hover:text-foreground hover:border-[#33363f]',
                    )}
                    onClick={() => setProjectFilter('all')}
                  >
                    All folders
                  </button>
                  {projects.map((dir) => {
                    const isActive = projectFilter === dir;
                    return (
                      <button
                        key={dir}
                        className={cn(
                          'shrink-0 whitespace-nowrap text-[11px] rounded-full border px-2.5 py-[3px] cursor-pointer font-inherit transition-colors',
                          isActive
                            ? 'border-primary/40 bg-primary/10 text-foreground'
                            : 'border-border text-muted-foreground hover:text-foreground hover:border-[#33363f]',
                        )}
                        onClick={() => setProjectFilter(isActive ? 'all' : dir)}
                      >
                        {folderName(dir)}
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {entries !== null && entries.length > 0 && showCalendar && (
        <div className="px-4 py-2.5 border-b border-border shrink-0">
          <div className="flex items-baseline justify-between gap-2 mb-2">
            <span className="text-[10px] tracking-[0.16em] uppercase text-muted-foreground">
              Sessions per day
            </span>
            <span className="text-[9.5px] tracking-[0.08em] uppercase text-muted-foreground/70">
              last 3 months
            </span>
          </div>
          <SessionCalendar
            months={months}
            now={now.getTime()}
            selected={dayFilter}
            onSelectDay={(key) => setDayFilter((cur) => (cur === key ? null : key))}
          />
        </div>
      )}

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {entries === null && (
          <div className="flex items-center gap-2 px-4 py-6 text-[12px] text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            <span>Loading past sessions…</span>
          </div>
        )}

        {entries !== null && entries.length === 0 && (
          <div className="flex flex-col items-center gap-1.5 text-center px-6 py-14 text-muted-foreground">
            <History size={20} className="text-[#33363f] mb-1" />
            <div className="text-[12.5px] text-foreground">No sessions yet</div>
            <div className="text-[11px] max-w-[34ch] leading-relaxed">
              Sessions appear here once you start chatting with Claude.
            </div>
          </div>
        )}

        {entries !== null && entries.length > 0 && filteredEntries.length === 0 && (
          <div className="flex flex-col items-center gap-1.5 text-center px-6 py-14 text-muted-foreground">
            <Search size={20} className="text-[#33363f] mb-1" />
            <div className="text-[12.5px] text-foreground">
              No sessions match {query ? `"${query}"` : 'this filter'}
            </div>
            <div className="text-[11px] max-w-[34ch] leading-relaxed">
              Try a different search term, or clear the filter to see everything.
            </div>
            <button
              className="mt-1 text-[11px] text-primary hover:bg-primary/10 bg-transparent border-none cursor-pointer px-2 py-1 rounded-sm font-inherit"
              onClick={() => { setQuery(''); setProjectFilter('all'); setDayFilter(null); }}
            >
              Clear filters
            </button>
          </div>
        )}

        {DAY_GROUPS.map((group) => {
          const groupItems = groupedEntries.get(group);
          if (!groupItems?.length) return null;
          return (
            <div key={group}>
              <div className="sticky top-0 z-[1] text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground bg-background/95 backdrop-blur-[2px] px-4 pt-2 pb-1.5">
                {group}
              </div>
              {groupItems.map((entry) => {
                const confirming = pendingDeleteId === entry.sessionId;
                const globalIndex = filteredEntries.indexOf(entry);
                const isActive = globalIndex === activeIndex;
                const name = sessionNames[entry.sessionId];

                return (
                  <div
                    key={entry.sessionId}
                    ref={(el) => { if (el) rowRefs.current.set(entry.sessionId, el); else rowRefs.current.delete(entry.sessionId); }}
                    role="option"
                    aria-selected={isActive}
                    tabIndex={0}
                    className={cn(
                      'group/history flex items-stretch w-full text-left border-b border-border/60 cursor-pointer outline-none',
                      isActive && 'bg-white/[0.03]',
                      'hover:bg-white/[0.03]',
                    )}
                    onClick={() => { if (!confirming) onResume(entry.projectDir, entry); }}
                    onFocus={() => setActiveIndex(globalIndex)}
                  >
                    <span
                      className={cn(
                        'w-[3px] shrink-0 bg-primary transition-opacity duration-100',
                        isActive ? 'opacity-100' : 'opacity-0 group-hover/history:opacity-100 group-focus-within/history:opacity-100',
                      )}
                    />
                    <div className="flex-1 min-w-0 flex flex-col gap-1 px-3 py-2.5">
                      {name && (
                        <div className="text-[12.5px] font-medium text-foreground leading-[1.4] truncate">
                          {highlightMatch(name, query)}
                        </div>
                      )}
                      <div className={cn(
                        'text-[12.5px] text-foreground leading-[1.4] line-clamp-2 break-words',
                        name && 'text-[11px] text-muted-foreground',
                      )}>
                        {highlightMatch(entry.preview, query)}
                      </div>
                      <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground min-w-0">
                        {projects.length > 1 && (
                          <>
                            <span className="truncate shrink text-[#9297a3]">{folderName(entry.projectDir)}</span>
                            <span className="shrink-0 opacity-50">·</span>
                          </>
                        )}
                        <span
                          className="shrink-0 text-[10px] px-1 rounded-sm border border-border bg-white/[0.04]"
                          title={entry.sessionId}
                        >
                          {entry.sessionId.slice(0, 7)}
                        </span>
                        <span className="shrink-0 opacity-50">·</span>
                        <span className="shrink-0 tabular-nums" title={fullTimestamp(entry.lastUsedIso)}>
                          {relativeTime(entry.lastUsedIso)} · {absoluteLabel(entry.lastUsedIso, group)}
                        </span>
                      </div>
                    </div>

                    <div className={cn(
                      'flex items-center gap-1 shrink-0 pr-2',
                      'opacity-0 group-hover/history:opacity-100 group-focus-within/history:opacity-100',
                      confirming && 'opacity-100',
                    )}>
                      {confirming ? (
                        <>
                          <span className="text-[10.5px] text-muted-foreground whitespace-nowrap">Delete?</span>
                          <button
                            className="text-[10.5px] text-destructive hover:bg-destructive/10 bg-transparent border-none cursor-pointer font-inherit px-1.5 py-0.5 rounded-sm"
                            onClick={(e) => { e.stopPropagation(); handleDelete(entry); }}
                          >
                            Delete
                          </button>
                          <button
                            className="text-[10.5px] text-muted-foreground hover:text-foreground hover:bg-white/[0.07] bg-transparent border-none cursor-pointer font-inherit px-1.5 py-0.5 rounded-sm"
                            onClick={(e) => { e.stopPropagation(); setPendingDeleteId(null); }}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="flex items-center justify-center w-5 h-5 rounded-sm bg-transparent border-none cursor-pointer text-muted-foreground/60 hover:text-[#6fd4c9] hover:bg-white/[0.07]"
                            title="Read this session (Space)"
                            onClick={(e) => { e.stopPropagation(); onRead(entry.projectDir, entry); }}
                          >
                            <FileText size={12} />
                          </button>
                          <button
                            className="flex items-center justify-center w-5 h-5 rounded-sm bg-transparent border-none cursor-pointer text-muted-foreground/60 hover:text-foreground hover:bg-white/[0.07]"
                            title="Resume this session"
                            onClick={(e) => { e.stopPropagation(); onResume(entry.projectDir, entry); }}
                          >
                            <ArrowRight size={12} />
                          </button>
                          <button
                            className="flex items-center justify-center w-5 h-5 rounded-sm bg-transparent border-none cursor-pointer text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10"
                            title="Delete this session"
                            onClick={(e) => { e.stopPropagation(); setPendingDeleteId(entry.sessionId); }}
                          >
                            <Trash2 size={12} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {entries !== null && entries.length > 0 && (
        <div className="flex items-center h-6 px-4 border-t border-border shrink-0 text-[10.5px] text-muted-foreground">
          <kbd className="mr-1 px-1 rounded-sm border border-border bg-white/[0.05] text-[#9297a3]">↑↓</kbd> navigate
          <span className="mx-2 opacity-40">·</span>
          <kbd className="mr-1 px-1 rounded-sm border border-border bg-white/[0.05] text-[#9297a3]">↵</kbd> resume
          <span className="mx-2 opacity-40">·</span>
          <kbd className="mr-1 px-1 rounded-sm border border-border bg-white/[0.05] text-[#9297a3]">space</kbd> read
          <span className="mx-2 opacity-40">·</span>
          <kbd className="mr-1 px-1 rounded-sm border border-border bg-white/[0.05] text-[#9297a3]">del</kbd> delete
          <span className="mx-2 opacity-40">·</span>
          <kbd className="mr-1 px-1 rounded-sm border border-border bg-white/[0.05] text-[#9297a3]">c</kbd> calendar
          <span className="mx-2 opacity-40">·</span>
          <kbd className="mr-1 px-1 rounded-sm border border-border bg-white/[0.05] text-[#9297a3]">/</kbd> search
        </div>
      )}
    </div>
  );
}
