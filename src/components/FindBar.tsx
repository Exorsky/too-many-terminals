import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, ChevronUp, ChevronDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Ctrl/Cmd+F find-in-page scoped to a reader pane. Highlights every match via
 *  the CSS Custom Highlight API (accenting the current one), shows an "n/total"
 *  count, and scrolls the current match into view. Enter = next, Shift+Enter =
 *  prev, Esc closes. Mount inside a `relative` container and hand it the scroll
 *  element to search; only rendered while its pane is on screen so the global
 *  key handler doesn't steal Ctrl+F elsewhere. */
// ponytail: matches only within a single text node — a phrase split across
// inline elements (a bold word mid-match) won't hit. Fine for prose search;
// widen the walker if whole-phrase-across-tags ever matters.
// The Highlight API ships on the app's webviews (WebView2 / WebKit 17.2+ /
// WebKitGTK 2.42+). Where it's missing, count + scroll-to still work; only the
// painted highlight drops out.
const HIGHLIGHTS = typeof CSS !== 'undefined' && 'highlights' in CSS ? CSS.highlights : null;

export default function FindBar({ scrollRef }: { scrollRef: React.RefObject<HTMLElement | null> }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0); // 0-based into ranges
  const [total, setTotal] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const ranges = useRef<Range[]>([]);

  const clearHighlights = () => {
    HIGHLIGHTS?.delete('find-all');
    HIGHLIGHTS?.delete('find-current');
  };

  // Point the "current" highlight at ranges[i] and scroll it into view.
  const focusMatch = useCallback((i: number) => {
    const range = ranges.current[i];
    const container = scrollRef.current;
    if (!range || !container) return;
    HIGHLIGHTS?.set('find-current', new Highlight(range));
    if (typeof range.getBoundingClientRect !== 'function') return; // no layout (tests)
    const c = container.getBoundingClientRect();
    const r = range.getBoundingClientRect();
    if (r.top < c.top || r.bottom > c.bottom) {
      container.scrollTop += r.top - c.top - container.clientHeight / 2;
    }
  }, [scrollRef]);

  // Rebuild match ranges for `q`. Recomputed on every query change (and on open)
  // so a live-following transcript that grew under us re-searches fresh DOM.
  const search = useCallback((q: string) => {
    const container = scrollRef.current;
    ranges.current = [];
    clearHighlights();
    if (!q || !container) { setIndex(0); setTotal(0); return; }
    const needle = q.toLowerCase();
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.nodeValue ?? '').toLowerCase();
      for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) {
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + needle.length);
        ranges.current.push(range);
      }
    }
    setTotal(ranges.current.length);
    if (ranges.current.length === 0) { setIndex(0); return; }
    HIGHLIGHTS?.set('find-all', new Highlight(...ranges.current));
    setIndex(0);
    focusMatch(0);
  }, [scrollRef, focusMatch]);

  const step = useCallback((dir: 1 | -1) => {
    const n = ranges.current.length;
    if (n === 0) return;
    const next = (index + dir + n) % n;
    setIndex(next);
    focusMatch(next);
  }, [index, focusMatch]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        setOpen(true);
        requestAnimationFrame(() => inputRef.current?.select());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Re-run the search when the bar opens and whenever the query changes.
  useEffect(() => {
    if (open) search(query);
  }, [open, query, search]);

  const close = () => {
    setOpen(false);
    clearHighlights();
  };

  if (!open) return null;
  return (
    <div className="absolute top-2 right-3 z-30 flex items-center gap-1 rounded-md border border-border bg-card px-1.5 py-1 shadow-lg">
      <Search size={12} className="text-muted-foreground shrink-0" />
      <input
        ref={inputRef}
        value={query}
        placeholder="Find"
        autoFocus
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
        }}
        className="w-40 bg-transparent border-none outline-none text-[12px] text-foreground placeholder:text-muted-foreground"
      />
      <span className={cn('shrink-0 tabular-nums text-[11px] mr-0.5', total === 0 && query ? 'text-warning' : 'text-muted-foreground')}>
        {query ? `${total ? index + 1 : 0}/${total}` : ''}
      </span>
      <button
        onClick={() => step(-1)}
        title="Previous (Shift+Enter)"
        className="flex items-center justify-center w-6 h-6 rounded text-muted-foreground hover:text-foreground hover:bg-white/[0.07] cursor-pointer bg-transparent border-none"
      >
        <ChevronUp size={13} />
      </button>
      <button
        onClick={() => step(1)}
        title="Next (Enter)"
        className="flex items-center justify-center w-6 h-6 rounded text-muted-foreground hover:text-foreground hover:bg-white/[0.07] cursor-pointer bg-transparent border-none"
      >
        <ChevronDown size={13} />
      </button>
      <button
        onClick={close}
        title="Close (Esc)"
        className="flex items-center justify-center w-6 h-6 rounded text-muted-foreground hover:text-foreground hover:bg-white/[0.07] cursor-pointer bg-transparent border-none"
      >
        <X size={13} />
      </button>
    </div>
  );
}
