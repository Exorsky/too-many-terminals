import { useEffect, useLayoutEffect, useRef } from 'react';
import { FileText } from 'lucide-react';
import type { MarkdownView } from './SessionBar';
import type { TranscriptTurn } from '@/types';
import { cn } from '@/lib/utils';
import TranscriptDocument from './TranscriptDocument';
import TranscriptStates from './TranscriptStates';

interface MarkdownPaneProps {
  turns: TranscriptTurn[] | null;
  error: string | null;
  view: MarkdownView;
  /** Mono pane-label shown in a header strip (Split mode). Omitted = no strip. */
  label?: string;
  /** Fill the pane width instead of a centered reading measure (Split mode). */
  fill?: boolean;
  className?: string;
}

/** The scrolling markdown pane shown for a readable Claude tab — full-width in
 *  Markdown mode, the right half in Split mode. Opens scrolled to the bottom so
 *  the newest turns of a (live, ever-growing) session are what you land on;
 *  re-anchors to the bottom whenever the transcript reloads. */
export default function MarkdownPane({ turns, error, view, label, fill = false, className }: MarkdownPaneProps) {
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
    <div className={cn('flex flex-col min-w-0', className)}>
      {label && (
        <div className="flex items-center gap-1.5 h-7 px-3 shrink-0 border-b border-border">
          <FileText size={11} className="text-[#6fd4c9] shrink-0" />
          <span className="font-mono text-[10px] tracking-[0.12em] uppercase text-muted-foreground">{label}</span>
        </div>
      )}
      <div ref={scrollRef} data-testid="transcript-scroll" className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        <TranscriptStates turns={turns} error={error} />
        {turns && turns.length > 0 && <TranscriptDocument turns={turns} view={view} fill={fill} />}
      </div>
    </div>
  );
}
