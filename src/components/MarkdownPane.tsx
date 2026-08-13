import { useEffect, useLayoutEffect, useRef } from 'react';
import { AlignLeft, Braces, FileText, RefreshCw } from 'lucide-react';
import type { MarkdownView } from './SessionControls';
import type { TranscriptTurn } from '@/types';
import { cn } from '@/lib/utils';
import CopyButton from './CopyButton';
import FindBar from './FindBar';
import TranscriptDocument from './TranscriptDocument';
import TranscriptStates from './TranscriptStates';

interface MarkdownPaneProps {
  turns: TranscriptTurn[] | null;
  error: string | null;
  view: MarkdownView;
  onSetView: (view: MarkdownView) => void;
  onRefresh: () => void;
  turnsCount: number | null;
  markdownText: string;
  /** Mono pane-label shown at the header's leading edge (Split mode only —
   *  Full mode is unambiguous, so it stays off). */
  label?: string;
  /** Fill the pane width instead of a centered reading measure (Split mode). */
  fill?: boolean;
  className?: string;
}

/** The scrolling markdown pane shown for a readable Claude tab — full-width in
 *  Markdown mode, one half of the split in Split mode. Owns its own header
 *  (turn count, Rendered/Raw, copy, refresh) since these controls only ever
 *  act on this pane — they used to live in the global session bar, now
 *  removed (see docs/design.md). Opens scrolled to the bottom so the newest
 *  turns of a (live, ever-growing) session are what you land on; re-anchors
 *  to the bottom whenever the transcript reloads. */
export default function MarkdownPane({
  turns, error, view, onSetView, onRefresh, turnsCount, markdownText, label, fill = false, className,
}: MarkdownPaneProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Whether to keep the view pinned to the bottom. Starts true (open at bottom);
  // flips off when the reader scrolls up and back on when they return to the
  // end — so live updates tail the newest turns without yanking you off a spot.
  const stickToBottom = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Runs before paint so the jump is invisible. Keyed on `turns`: fires on the
  // initial load and on every refresh; re-pins to the end only when we're
  // already following it.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && turns && turns.length > 0 && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [turns]);

  return (
    <div className={cn('relative flex flex-col min-w-0 min-h-0', className)}>
      <FindBar scrollRef={scrollRef} />
      <div className="flex items-center gap-2.5 h-7 px-2.5 shrink-0 border-b border-border">
        {label && (
          <span className="flex items-center gap-1.5">
            <FileText size={11} className="text-[#6fd4c9] shrink-0" />
            <span className="font-mono text-[10px] tracking-[0.12em] uppercase text-muted-foreground">{label}</span>
          </span>
        )}
        {turnsCount !== null && (
          <span className="font-mono text-[10px] text-muted-foreground tabular-nums">{turnsCount} turns</span>
        )}
        <span className="flex-1" />
        <div className="flex items-center gap-0.5 p-0.5 rounded-md border border-border bg-background">
          {(['rendered', 'raw'] as MarkdownView[]).map((v) => (
            <button
              key={v}
              onClick={() => onSetView(v)}
              className={cn(
                'inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-[5px] cursor-pointer font-inherit transition-colors',
                view === v
                  ? (v === 'rendered' ? 'bg-secondary text-[#6fd4c9]' : 'bg-secondary text-foreground')
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {v === 'rendered' ? <AlignLeft size={12} /> : <Braces size={12} />}
              {v === 'rendered' ? 'Rendered' : 'Raw'}
            </button>
          ))}
        </div>
        <CopyButton text={markdownText} label="Copy all" />
        <button
          onClick={onRefresh}
          title="Re-read (a live session keeps growing)"
          className="flex items-center justify-center w-[26px] h-[26px] rounded-md text-muted-foreground hover:text-foreground hover:bg-white/[0.07] cursor-pointer bg-card border border-border"
        >
          <RefreshCw size={12} />
        </button>
      </div>
      <div ref={scrollRef} data-testid="transcript-scroll" className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        <TranscriptStates turns={turns} error={error} />
        {turns && turns.length > 0 && <TranscriptDocument turns={turns} view={view} fill={fill} />}
      </div>
    </div>
  );
}
