import type { TranscriptTurn } from '@/types';
import { roleLabel, transcriptToMarkdown, turnToMarkdown } from '@/lib/transcript';
import { cn } from '@/lib/utils';
import CopyButton from './CopyButton';
import Markdown from './Markdown';

function turnTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

const NODE_STYLES: Record<TranscriptTurn['role'], string> = {
  user: 'text-primary border-primary/50 rounded-[5px]',
  assistant: 'text-[#6fd4c9] border-[#6fd4c9]/50 rounded-full',
};

/** Renders parsed transcript turns as a reading column — the shared document
 *  body behind both the History overlay (`SessionReader`) and the in-place
 *  markdown view (`SessionBar`). Presentational: callers own loading, error,
 *  empty, and the surrounding chrome. */
export default function TranscriptDocument({ turns, view, fill = false }: {
  turns: TranscriptTurn[];
  view: 'rendered' | 'raw';
  /** Fill the container width (split pane) instead of a centered reading
   *  measure. The pane already constrains width, so an extra cap just leaves
   *  the text floating in a narrow column with uneven side gaps. */
  fill?: boolean;
}) {
  if (view === 'raw') {
    return (
      <div className={cn('py-7', fill ? 'px-7' : 'max-w-[820px] mx-auto px-5')}>
        <pre className="m-0 font-mono text-[12.5px] leading-[1.62] text-muted-foreground whitespace-pre-wrap break-words">
          {transcriptToMarkdown(turns)}
        </pre>
      </div>
    );
  }

  return (
    <div className={cn('py-7', fill ? 'px-7' : 'max-w-[760px] mx-auto px-5')}>
      {turns.map((turn, i) => {
        const showRole = i === 0 || turns[i - 1].role !== turn.role;
        return (
          <div key={i} className="group/turn relative pl-11 pb-6">
            <span className="absolute left-[15px] top-1 bottom-0 w-px bg-border" aria-hidden />
            {showRole && (
              <span className={cn('absolute left-2 top-0.5 w-4 h-4 grid place-items-center text-[9px] font-bold bg-card border', NODE_STYLES[turn.role])}>
                {turn.role === 'user' ? 'U' : 'C'}
              </span>
            )}

            {showRole && (
              <div className={cn('flex items-center gap-2 mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em]', turn.role === 'user' ? 'text-primary' : 'text-[#6fd4c9]')}>
                {roleLabel(turn.role)}
                {turn.timestamp && <span className="text-muted-foreground font-medium normal-case tracking-normal">{turnTime(turn.timestamp)}</span>}
              </div>
            )}

            {turn.role === 'assistant' && (
              <div className="absolute right-0 top-0 opacity-0 group-hover/turn:opacity-100 transition-opacity">
                <CopyButton text={turnToMarkdown(turn)} label="Copy" />
              </div>
            )}

            {turn.role === 'user' ? (
              <div className="rounded-r-md border border-border border-l-2 border-l-primary/50 bg-card px-3 py-2.5 font-mono text-[13px] text-foreground whitespace-pre-wrap">
                {turn.blocks.map((b) => (b.kind === 'text' ? b.text : '')).join('\n')}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {turn.blocks.map((b, j) =>
                  b.kind === 'text' ? (
                    <Markdown key={j} source={b.text} />
                  ) : (
                    <div key={j} className="inline-flex items-center gap-2 self-start max-w-full text-[11.5px] rounded-md border border-border bg-card px-2.5 py-1.5">
                      <span className="text-warning shrink-0">{b.name}</span>
                      {b.detail && <span className="text-foreground truncate font-mono">{b.detail}</span>}
                    </div>
                  ),
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
