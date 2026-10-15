import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, CalendarDays, ChevronRight, FileText, Library, Loader2, Search, Trash2, Upload, X,
} from 'lucide-react';
import { projectHue, type SessionHistoryEntry, type TranscriptHit } from '@/types';
import { ageBucket, type AgeBucket } from '@/lib/sessions';
import { calendarMonths, dayKey, type CalendarMark } from '@/lib/stats';
import * as ipc from '@/lib/ipc';
import { cn, folderName } from '@/lib/utils';
import { confirmAction } from '@/lib/confirm';
import SessionCalendar from './SessionCalendar';

interface HistoryEntry extends SessionHistoryEntry {
  /** Set when the query matched inside the transcript rather than its
   *  metadata — the row then shows the matching text under its title. */
  hit?: TranscriptHit;
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

/** The "When" filter. Cumulative, not exclusive: This week includes today. */
type When = 'all' | 'today' | 'yesterday' | 'week' | 'month';

const WHEN: { key: When; label: string; ages: AgeBucket[] | null }[] = [
  { key: 'all', label: 'Any time', ages: null },
  { key: 'today', label: 'Today', ages: ['today'] },
  { key: 'yesterday', label: 'Yesterday', ages: ['yesterday'] },
  { key: 'week', label: 'This week', ages: ['today', 'yesterday', 'week'] },
  { key: 'month', label: 'This month', ages: ['today', 'yesterday', 'week', 'month'] },
];

/** A day heading: "Today", "Yesterday", then the weekday and date — a list
 *  of a hundred sessions is read by day, and "Earlier" says nothing. */
function dayLabel(iso: string, now: number): string {
  const age = ageBucket(new Date(iso).getTime(), now);
  if (age === 'today') return 'Today';
  if (age === 'yesterday') return 'Yesterday';
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** The row only needs a clock time — its day heading carries the date. */
function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
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

function Facet({ label, count, active, onClick, hue }: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  hue?: number;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        'flex items-center gap-2 w-full h-[26px] px-3 shrink-0 rounded-sm border-none cursor-pointer font-inherit text-left text-[11.5px]',
        active ? 'bg-selected text-foreground' : 'bg-transparent text-dim hover:text-foreground hover:bg-hover',
      )}
      onClick={onClick}
    >
      {hue !== undefined && (
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: `hsl(${hue} 60% 62%)` }} />
      )}
      <span className="flex-1 truncate">{label}</span>
      <span className="shrink-0 text-[9.5px] font-mono tabular-nums text-muted-foreground">{count}</span>
    </button>
  );
}

/** The Library: every past Claude session, read from the transcripts on disk.
 *  Filters on the left, one dense list by day in the middle, the picked
 *  session on the right. See docs/features/session-history.md. */
export default function SessionHistoryPanel({ projects, sessionNames, onResume, onRead }: SessionHistoryPanelProps) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [query, setQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [when, setWhen] = useState<When>('all');
  const [dayFilter, setDayFilter] = useState<string | null>(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  // Content hits arrive separately from the metadata filter below: that one is
  // instant and local, this one crosses to Rust and reads every transcript on
  // disk. Keeping them apart is what lets the list respond on the first
  // keystroke instead of waiting for the scan.
  const [hits, setHits] = useState<TranscriptHit[]>([]);
  const [searching, setSearching] = useState(false);

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

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    // Debounced, because every keystroke would otherwise re-read the corpus.
    const timer = setTimeout(() => {
      ipc.searchTranscripts(q)
        .then((found) => { if (!cancelled) setHits(found); })
        .catch(() => { if (!cancelled) setHits([]); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 220);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  // Each filter's counts are drawn from what the *other* filters leave, so a
  // count always says what clicking it would show.
  const matching = useMemo(() => {
    if (!entries) return [];
    const q = query.trim().toLowerCase();
    const byId = new Map(hits.map((h) => [h.sessionId, h]));

    const matched = entries
      .map((entry): HistoryEntry => {
        const hit = byId.get(entry.sessionId);
        return hit ? { ...entry, hit } : entry;
      })
      .filter((entry) => {
        if (!q) return true;
        const name = sessionNames[entry.sessionId];
        return !!entry.hit
          || entry.preview.toLowerCase().includes(q)
          || folderName(entry.projectDir).toLowerCase().includes(q)
          || !!name?.toLowerCase().includes(q);
      });

    // A hit can name a project that isn't open, and those are the ones worth
    // finding — the session you half-remember usually lives in a folder you
    // closed months ago. Carry them in as first-class rows.
    const known = new Set(entries.map((e) => e.sessionId));
    const foreign = hits
      .filter((h) => !known.has(h.sessionId))
      .map((h): HistoryEntry => ({
        sessionId: h.sessionId,
        projectDir: h.projectDir,
        preview: h.snippet,
        lastUsedIso: h.lastUsedIso,
        hit: h,
      }));

    return [...matched, ...foreign].sort((a, b) => b.lastUsedIso.localeCompare(a.lastUsedIso));
  }, [entries, hits, query, sessionNames]);

  const inWhen = useCallback((e: HistoryEntry, w: When) => {
    const ages = WHEN.find((x) => x.key === w)!.ages;
    return !ages || ages.includes(ageBucket(new Date(e.lastUsedIso).getTime(), now.getTime()));
  }, [now]);

  // The calendar draws `searched`, so picking a day never empties the grid you
  // picked it from, while the list draws that minus the day.
  const searched = useMemo(
    () => matching.filter((e) => projectFilter === 'all' || e.projectDir === projectFilter),
    [matching, projectFilter],
  );

  const filteredEntries = useMemo(
    () => searched.filter((e) => inWhen(e, when) && (!dayFilter || dayKey(e.lastUsedIso) === dayFilter)),
    [searched, when, dayFilter, inWhen],
  );

  const whenCounts = useMemo(
    () => new Map(WHEN.map(({ key }) => [key, searched.filter((e) => inWhen(e, key)).length])),
    [searched, inWhen],
  );
  const projectCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of matching) if (inWhen(e, when)) counts.set(e.projectDir, (counts.get(e.projectDir) ?? 0) + 1);
    return counts;
  }, [matching, when, inWhen]);

  const months = useMemo(() => calendarMonths(
    searched.map((e): CalendarMark => ({
      iso: e.lastUsedIso,
      hue: projectHue(Math.max(0, projects.indexOf(e.projectDir))),
      projectName: folderName(e.projectDir),
    })),
    now.getTime(),
  ), [searched, projects, now]);

  // Entries arrive newest first, so consecutive runs of one day are the groups.
  const days = useMemo(() => {
    const out: { key: string; label: string; items: HistoryEntry[] }[] = [];
    for (const entry of filteredEntries) {
      const key = dayKey(entry.lastUsedIso);
      if (out[out.length - 1]?.key !== key) out.push({ key, label: dayLabel(entry.lastUsedIso, now.getTime()), items: [] });
      out[out.length - 1].items.push(entry);
    }
    return out;
  }, [filteredEntries, now]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, projectFilter, dayFilter, when]);

  const active: HistoryEntry | undefined = filteredEntries[activeIndex];

  useEffect(() => {
    if (active) rowRefs.current.get(active.sessionId)?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  const handleDelete = useCallback(async (entry: HistoryEntry) => {
    const ok = await confirmAction({
      title: `Delete "${sessionNames[entry.sessionId] || entry.preview.slice(0, 60) || 'this session'}"?`,
      body: 'Removes its transcript from disk. It cannot be resumed or read afterwards.',
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    setEntries((prev) => prev?.filter((e) => e.sessionId !== entry.sessionId) ?? prev);
    await ipc.deleteSession(entry.projectDir, entry.sessionId).catch(() => {});
  }, [sessionNames]);

  const moveActive = useCallback((delta: number) => {
    setActiveIndex((i) => Math.max(0, Math.min(filteredEntries.length - 1, i + delta)));
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
        if (active) rowRefs.current.get(active.sessionId)?.focus();
      } else if (e.key === 'Enter' && active) {
        onResume(active.projectDir, active);
      }
      return;
    }

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
        if (active) onResume(active.projectDir, active);
        break;
      case ' ':
        if (active) { e.preventDefault(); onRead(active.projectDir, active); }
        break;
      case 'Delete':
      case 'Backspace':
        if (active) { e.preventDefault(); void handleDelete(active); }
        break;
      case 'Escape':
        if (dayFilter) setDayFilter(null);
        break;
    }
  }, [active, query, dayFilter, moveActive, onResume, onRead, handleDelete]);

  // Keyboard focus follows the active row, so ↑↓ moves the ring with the pick.
  useEffect(() => {
    const focused = document.activeElement;
    if (active && focused instanceof HTMLElement && focused.dataset.libraryRow !== undefined) {
      rowRefs.current.get(active.sessionId)?.focus();
    }
  }, [active]);

  const totalCount = entries?.length ?? 0;
  const isFiltering = query.trim().length > 0 || projectFilter !== 'all' || when !== 'all' || dayFilter !== null;
  const clearFilters = () => { setQuery(''); setProjectFilter('all'); setWhen('all'); setDayFilter(null); };
  // Whether a row needs to say which folder it's from.
  const multiFolder = projects.length > 1 || filteredEntries.some((e) => !projects.includes(e.projectDir));

  return (
    <div className="flex flex-col h-full overflow-hidden" onKeyDown={handlePanelKeyDown}>
      <div className="flex items-center gap-3 h-[52px] px-4 border-b border-border shrink-0">
        <label className="flex items-center gap-2 flex-1 max-w-[620px] h-8 px-2.5 rounded-sm border border-border bg-card focus-within:border-border-hover">
          <Search size={13} className="text-muted-foreground shrink-0" />
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search names, folders and transcripts…"
            aria-label="Search the Library"
            autoComplete="off"
            spellCheck={false}
            className="flex-1 min-w-0 bg-transparent border-none outline-none text-[12.5px] text-foreground placeholder:text-muted-foreground font-inherit"
          />
          {query ? (
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground bg-transparent border-none cursor-pointer p-0.5 rounded-sm shrink-0"
              onClick={() => { setQuery(''); searchInputRef.current?.focus(); }}
              title="Clear search"
            >
              <X size={12} />
            </button>
          ) : (
            <kbd className="shrink-0 font-mono text-[9.5px] text-faint">/</kbd>
          )}
        </label>
        {/* The transcript scan is the one thing here that isn't instant, and
            while it runs the list shows only the metadata matches — so without
            this the honest reading of a thin list is "nothing else exists",
            not "still looking". */}
        {searching && (
          <span className="flex items-center gap-2 shrink-0" role="status" aria-live="polite">
            <span className="relative w-6 h-px shrink-0 bg-border overflow-hidden">
              <span className="absolute inset-y-0 w-1/2 bg-primary animate-[history-scan_1s_ease-in-out_infinite]" />
            </span>
            <span className="text-[11px] text-muted-foreground">Searching transcripts…</span>
          </span>
        )}
        {entries !== null && (
          <span className="ml-auto shrink-0 text-[10.5px] text-muted-foreground font-mono tabular-nums">
            {isFiltering
              ? <><span className="text-foreground">{filteredEntries.length}</span> of {totalCount} sessions</>
              : <><span className="text-foreground">{totalCount}</span> sessions</>}
            {!searching && hits.length > 0 && <> · {hits.length} in text</>}
          </span>
        )}
        {entries !== null && entries.length > 0 && (
          <button
            type="button"
            className={cn(
              'flex items-center justify-center w-6 h-6 rounded-sm border cursor-pointer shrink-0',
              showCalendar
                ? 'text-primary bg-primary/10 border-primary/40'
                : 'bg-transparent border-transparent text-muted-foreground hover:text-foreground hover:bg-selected',
            )}
            aria-pressed={showCalendar}
            title={showCalendar ? 'Hide the calendar (c)' : 'Show the calendar (c)'}
            onClick={() => setShowCalendar((v) => !v)}
          >
            <CalendarDays size={13} />
          </button>
        )}
      </div>

      <div className="flex flex-1 min-h-0">
        <nav aria-label="Filters" className="flex flex-col gap-px w-[200px] shrink-0 px-1 py-2 bg-card border-r border-border overflow-y-auto scrollbar-thin">
          <div className="px-3 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">When</div>
          {WHEN.map(({ key, label }) => (
            <Facet
              key={key}
              label={label}
              count={whenCounts.get(key) ?? 0}
              active={when === key && !dayFilter}
              onClick={() => { setWhen(key); setDayFilter(null); }}
            />
          ))}

          {/* Folded by default: with a dozen folders open the list of them was
              most of this column, and the When filter is what you reach for
              first. */}
          {projects.length > 1 && (
            <>
              <button
                type="button"
                aria-expanded={projectsOpen}
                className="flex items-center gap-1.5 w-full h-6 mt-3 px-2 shrink-0 rounded-sm border-none cursor-pointer bg-transparent font-inherit text-left hover:bg-hover"
                onClick={() => setProjectsOpen((v) => !v)}
              >
                <ChevronRight size={10} className={cn('shrink-0 text-muted-foreground transition-transform duration-100', projectsOpen && 'rotate-90')} />
                <span className="flex-1 text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">Projects</span>
                {projectFilter !== 'all' && !projectsOpen && (
                  <span className="truncate max-w-[90px] text-[10px] text-dim">{folderName(projectFilter)}</span>
                )}
              </button>
              {projectsOpen && (
                <>
                  <Facet
                    label="All projects"
                    count={[...projectCounts.values()].reduce((a, b) => a + b, 0)}
                    active={projectFilter === 'all'}
                    onClick={() => setProjectFilter('all')}
                  />
                  {projects.map((dir, i) => (
                    <Facet
                      key={dir}
                      label={folderName(dir)}
                      hue={projectHue(i)}
                      count={projectCounts.get(dir) ?? 0}
                      active={projectFilter === dir}
                      onClick={() => setProjectFilter(projectFilter === dir ? 'all' : dir)}
                    />
                  ))}
                </>
              )}
            </>
          )}
        </nav>

        <div role="listbox" aria-label="Sessions" className="flex-1 min-w-0 overflow-y-auto scrollbar-thin border-r border-border">
          {dayFilter && (
            <div className="flex px-4 pt-2.5">
              <button
                type="button"
                className="flex items-center gap-1.5 whitespace-nowrap text-[11px] rounded-full border border-primary/40 bg-primary/10 text-foreground px-2.5 py-[3px] cursor-pointer font-inherit"
                onClick={() => setDayFilter(null)}
                title="Show every date"
              >
                {dayFilterLabel(dayFilter)}
                <X size={10} className="text-muted-foreground" />
              </button>
            </div>
          )}

          {entries !== null && entries.length > 0 && showCalendar && (
            <div className="px-4 py-2.5 border-b border-border">
              <div className="flex items-baseline justify-between gap-2 mb-2">
                <span className="text-[10px] tracking-[0.16em] uppercase text-muted-foreground">Sessions per day</span>
                <span className="text-[9.5px] tracking-[0.08em] uppercase text-muted-foreground">last 3 months</span>
              </div>
              <SessionCalendar
                months={months}
                now={now.getTime()}
                selected={dayFilter}
                onSelectDay={(key) => setDayFilter((cur) => (cur === key ? null : key))}
              />
            </div>
          )}

          {entries === null && (
            <div className="flex items-center gap-2 px-4 py-6 text-[12px] text-muted-foreground">
              <Loader2 size={14} className="animate-spin" />
              <span>Loading past sessions…</span>
            </div>
          )}

          {entries !== null && entries.length === 0 && (
            <div className="flex flex-col items-center gap-1.5 text-center px-6 py-14 text-muted-foreground">
              <Library size={20} className="text-faint mb-1" />
              <div className="text-[12.5px] text-foreground">No sessions yet</div>
              <div className="text-[11px] max-w-[34ch] leading-relaxed">
                Sessions appear here once you start chatting with Claude.
              </div>
            </div>
          )}

          {entries !== null && entries.length > 0 && filteredEntries.length === 0 && (
            <div className="flex flex-col items-center gap-1.5 text-center px-6 py-14 text-muted-foreground">
              <Search size={20} className="text-faint mb-1" />
              <div className="text-[12.5px] text-foreground">
                No sessions match {query ? `"${query}"` : 'this filter'}
              </div>
              <div className="text-[11px] max-w-[34ch] leading-relaxed">
                Try a different search term, or clear the filter to see everything.
              </div>
              <button
                type="button"
                className="mt-1 text-[11px] text-primary hover:bg-primary/10 bg-transparent border-none cursor-pointer px-2 py-1 rounded-sm font-inherit"
                onClick={clearFilters}
              >
                Clear filters
              </button>
            </div>
          )}

          {days.map((day) => (
            <div key={day.key}>
              <div className="sticky top-0 z-[1] flex items-baseline gap-2 bg-background px-4 pt-3 pb-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">{day.label}</span>
                <span className="ml-auto text-[9.5px] font-mono tabular-nums text-muted-foreground">{day.items.length}</span>
              </div>
              {day.items.map((entry) => {
                const index = filteredEntries.indexOf(entry);
                const isActive = entry === active;
                const name = sessionNames[entry.sessionId];
                return (
                  <div
                    key={entry.sessionId}
                    ref={(el) => { if (el) rowRefs.current.set(entry.sessionId, el); else rowRefs.current.delete(entry.sessionId); }}
                    role="option"
                    aria-selected={isActive}
                    tabIndex={isActive ? 0 : -1}
                    data-library-row
                    title={fullTimestamp(entry.lastUsedIso)}
                    className={cn(
                      'flex items-start gap-3 w-full px-4 py-[5px] cursor-pointer outline-none focus-visible:outline-2 focus-visible:outline-ring',
                      isActive ? 'bg-selected' : 'hover:bg-hover',
                    )}
                    onClick={() => setActiveIndex(index)}
                    onDoubleClick={() => onResume(entry.projectDir, entry)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className={cn('truncate text-[12px] leading-[18px]', isActive ? 'text-foreground' : 'text-dim')}>
                        {highlightMatch(name || entry.preview, query)}
                      </div>
                      {entry.hit && entry.hit.snippet !== entry.preview && (
                        <div className="flex gap-2 min-w-0 mt-0.5 mb-0.5">
                          <span className="w-px shrink-0 bg-primary/40" aria-hidden="true" />
                          <div className="min-w-0 text-[11px] leading-[1.45] text-muted-foreground line-clamp-2 break-words">
                            {highlightMatch(entry.hit.snippet, query)}
                          </div>
                        </div>
                      )}
                    </div>
                    {entry.hit && (
                      <span className="shrink-0 text-[10px] leading-[18px] text-primary" title={`Matched inside the transcript (${entry.hit.role})`}>
                        {entry.hit.matchCount} in text
                      </span>
                    )}
                    {multiFolder && (
                      <span className="flex items-center gap-1.5 shrink-0 w-[150px] min-w-0 text-[10.5px] leading-[18px] text-muted-foreground">
                        <span
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={projects.includes(entry.projectDir)
                            ? { background: `hsl(${projectHue(projects.indexOf(entry.projectDir))} 60% 62%)` }
                            : { boxShadow: 'inset 0 0 0 1px var(--muted-foreground)' }}
                        />
                        <span className="truncate">{folderName(entry.projectDir)}</span>
                      </span>
                    )}
                    <span className="shrink-0 w-10 text-right text-[9.5px] leading-[18px] font-mono tabular-nums text-muted-foreground">
                      {clock(entry.lastUsedIso)}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* The picked session. Its actions live here rather than as hover
            icons on every row — a hundred rows of four icons is a toolbar,
            not a list. */}
        <aside aria-label="Selected session" className="flex flex-col w-[320px] shrink-0 min-h-0 overflow-y-auto scrollbar-thin">
          {active ? (
            <>
              <div className="flex flex-col gap-2 px-4 py-3.5 border-b border-border">
                <div className="text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">Session</div>
                <div className="font-mono text-[10px] leading-relaxed text-muted-foreground break-all">
                  {folderName(active.projectDir)} · {fullTimestamp(active.lastUsedIso)} · {active.sessionId.slice(0, 8)}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                  <button
                    type="button"
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-sm border border-border-hover bg-transparent text-[11px] text-foreground cursor-pointer font-inherit hover:bg-hover"
                    title="Resume (↵)"
                    onClick={() => onResume(active.projectDir, active)}
                  >
                    <ArrowRight size={12} />Resume
                  </button>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-sm border border-border bg-transparent text-[11px] text-dim cursor-pointer font-inherit hover:bg-hover"
                    title="Read (space)"
                    onClick={() => onRead(active.projectDir, active)}
                  >
                    <FileText size={12} />Read
                  </button>
                  <button
                    type="button"
                    aria-label="Export this session"
                    title="Export this session to a file (hand off to another machine)"
                    className="flex items-center justify-center w-6 h-6 rounded-sm border-none bg-transparent text-muted-foreground cursor-pointer hover:text-foreground hover:bg-selected"
                    onClick={() => { ipc.exportSession(active.projectDir, active.sessionId).catch(() => {}); }}
                  >
                    <Upload size={12} />
                  </button>
                  <button
                    type="button"
                    aria-label="Delete this session"
                    title="Delete this session (del)"
                    className="flex items-center justify-center w-6 h-6 rounded-sm border-none bg-transparent text-muted-foreground cursor-pointer hover:text-destructive hover:bg-destructive/10"
                    onClick={() => { void handleDelete(active); }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
              {sessionNames[active.sessionId] && active.preview && (
                <div className="px-4 py-3.5">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">First message</div>
                  <div className="text-[12px] leading-[1.55] text-dim break-words whitespace-pre-wrap">{active.preview}</div>
                </div>
              )}
            </>
          ) : (
            <div className="px-4 py-6 text-[11px] text-faint">Pick a session to see it here.</div>
          )}
        </aside>
      </div>

      {entries !== null && entries.length > 0 && (
        <div className="flex items-center h-6 px-4 border-t border-border shrink-0 text-[10.5px] text-muted-foreground">
          <kbd className="mr-1 px-1 rounded-sm border border-border bg-raised text-dim">↑↓</kbd> pick
          <span className="mx-2 text-faint">·</span>
          <kbd className="mr-1 px-1 rounded-sm border border-border bg-raised text-dim">↵</kbd> resume
          <span className="mx-2 text-faint">·</span>
          <kbd className="mr-1 px-1 rounded-sm border border-border bg-raised text-dim">space</kbd> read
          <span className="mx-2 text-faint">·</span>
          <kbd className="mr-1 px-1 rounded-sm border border-border bg-raised text-dim">del</kbd> delete
          <span className="mx-2 text-faint">·</span>
          <kbd className="mr-1 px-1 rounded-sm border border-border bg-raised text-dim">c</kbd> calendar
          <span className="mx-2 text-faint">·</span>
          <kbd className="mr-1 px-1 rounded-sm border border-border bg-raised text-dim">/</kbd> search
        </div>
      )}
    </div>
  );
}
