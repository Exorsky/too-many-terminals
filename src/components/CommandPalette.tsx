import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { cn, folderName } from '@/lib/utils';
import { fuzzyScore } from '@/lib/fuzzy';
import type { Tab, TabStatus } from '@/types';
import { StatusDot } from './SessionsSidebar';

/** Words folded into each tab's search text so status can be typed as a filter —
 *  "needs" finds the sessions blocked on you, "done" the finished ones. */
const STATUS_TERMS: Record<TabStatus, string> = {
  working: 'working running busy',
  idle: 'done idle finished',
  requires_response: 'needs input waiting attention',
  new: 'new',
};

/** Where a session is filed, as the palette says it: the project's name, or
 *  "Inbox" for one that isn't filed anywhere. */
function fileLabel(tab: Tab): string {
  return tab.projectDir === null ? 'Inbox' : folderName(tab.projectDir);
}

interface CommandPaletteProps {
  open: boolean;
  tabs: Tab[];
  onClose: () => void;
  onSelectTab: (tabId: string) => void;
}

/** A fuzzy switcher over every open session, summoned with ⌘K from anywhere —
 *  the fast path to "which session was that?" without hunting the sidebar.
 *  Type a name, project, directory or status word; ↑↓ to move, ↵ to jump.
 *
 *  Deliberately only a switcher. It is not a command runner, and growing it
 *  into one would make the fast path slower for the thing it is actually for.
 *  See docs/features/command-palette.md. */
export default function CommandPalette({ open, tabs, onClose, onSelectTab }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset to a clean slate every time the palette opens.
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelected(0);
      // The input is already mounted when this effect runs (post-commit).
      inputRef.current?.focus();
    }
  }, [open]);

  const results = useMemo(() => {
    // This palette is a terminal switcher; file tabs live in TabBar/the explorer.
    const scored = tabs.filter((tab) => tab.kind !== 'file').map((tab) => {
      // Name, where it's filed, its actual directory, and status words — the
      // four things you might remember about a session you're looking for.
      const haystack = `${tab.name} ${fileLabel(tab)} ${tab.cwd} ${
        tab.kind === 'claude' ? STATUS_TERMS[tab.status] : 'shell terminal'
      }`;
      return { tab, score: fuzzyScore(query, haystack) };
    });
    return scored
      .filter((r): r is { tab: Tab; score: number } => r.score !== null)
      .sort((a, b) => b.score - a.score)
      .map((r) => r.tab);
  }, [tabs, query]);

  // Keep the selection in range as the result set shrinks/grows.
  useEffect(() => {
    setSelected((s) => (results.length === 0 ? 0 : Math.min(s, results.length - 1)));
  }, [results.length]);

  // Scroll the active row into view as you arrow through.
  useEffect(() => {
    const row = listRef.current?.querySelector('[data-selected="true"]');
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);

  if (!open) return null;

  const choose = (tab: Tab | undefined) => {
    if (!tab) return;
    onSelectTab(tab.id);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((s) => (results.length ? (s + 1) % results.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((s) => (results.length ? (s - 1 + results.length) % results.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(results[selected]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] bg-black/50"
      onMouseDown={onClose}
    >
      <div
        className="w-[min(560px,90vw)] max-h-[70vh] flex flex-col rounded-lg border border-border-hover bg-card shadow-2xl overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Jump to a session"
      >
        <div className="flex items-center gap-2.5 px-3.5 h-11 border-b border-border shrink-0">
          <Search size={15} className="shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Jump to a session — name, project, or status…"
            className="flex-1 min-w-0 bg-transparent border-none outline-none text-[13px] text-foreground placeholder:text-muted-foreground font-inherit"
          />
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto scrollbar-thin py-1.5">
          {results.length === 0 ? (
            <div className="px-4 py-6 text-center text-[12px] text-muted-foreground">
              No open session matches “{query.trim()}”.
            </div>
          ) : (
            results.map((tab, i) => (
              <button
                key={tab.id}
                data-selected={i === selected}
                className={cn(
                  'group relative flex items-center gap-2.5 w-full px-3.5 py-2 text-left border-none cursor-pointer font-inherit',
                  i === selected ? 'bg-primary/10 text-foreground' : 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-hover',
                )}
                onMouseMove={() => setSelected(i)}
                onClick={() => choose(tab)}
              >
                {i === selected && <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-primary" />}
                <StatusDot tab={tab} size={7} />
                <span className="truncate flex-1 text-[13px]">{tab.name}{tab.exited ? ' (exited)' : ''}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground truncate max-w-[40%]">{fileLabel(tab)}</span>
              </button>
            ))
          )}
        </div>

        <div className="flex items-center gap-4 px-3.5 h-8 border-t border-border shrink-0 text-[10px] text-muted-foreground">
          <span>↑↓ move</span>
          <span>↵ open</span>
          <span>esc close</span>
          <span className="ml-auto">try: needs · done · working</span>
        </div>
      </div>
    </div>
  );
}
