import { useEffect, useMemo, useState } from 'react';
import { AlignLeft, ArrowRight, Braces, FileText, RefreshCw, X } from 'lucide-react';
import type { SessionHistoryEntry } from '@/types';
import { transcriptToMarkdown } from '@/lib/transcript';
import { useTranscript } from '@/lib/use-transcript';
import { cn } from '@/lib/utils';
import CopyButton from './CopyButton';
import TranscriptDocument from './TranscriptDocument';
import TranscriptStates from './TranscriptStates';

interface SessionReaderProps {
  projectDir: string;
  entry: SessionHistoryEntry;
  onClose: () => void;
  onResume: (projectDir: string, entry: SessionHistoryEntry) => void;
}

type View = 'rendered' | 'raw';

function folderName(dir: string): string {
  return dir.split(/[/\\]/).filter(Boolean).pop() ?? dir;
}

/** Full-pane reader opened from Session History — its own toolbar (title, meta,
 *  toggle, copy, refresh, resume, close) over the shared transcript document.
 *  The in-place tab reader lives in `MarkdownPane` instead. */
export default function SessionReader({ projectDir, entry, onClose, onResume }: SessionReaderProps) {
  const [view, setView] = useState<View>('rendered');
  const [reloadKey, setReloadKey] = useState(0);
  const { turns, error } = useTranscript(projectDir, entry.sessionId, reloadKey);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const fullMarkdown = useMemo(() => (turns ? transcriptToMarkdown(turns) : ''), [turns]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      <div className="flex items-center gap-3 h-11 px-4 border-b border-border shrink-0 bg-gradient-to-b from-card to-background">
        <FileText size={14} className="text-[#6fd4c9] shrink-0" />
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-foreground truncate">{entry.preview || 'Session'}</div>
          <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
            <span className="truncate">{folderName(projectDir)}</span>
            <span className="opacity-50">·</span>
            <span className="shrink-0 px-1 rounded-sm border border-border bg-white/[0.04]" title={entry.sessionId}>
              {entry.sessionId.slice(0, 7)}
            </span>
            {turns && (
              <>
                <span className="opacity-50">·</span>
                <span className="shrink-0 tabular-nums">{turns.length} turns</span>
              </>
            )}
          </div>
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-0.5 p-0.5 rounded-md border border-border bg-background">
          {(['rendered', 'raw'] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                'inline-flex items-center gap-1.5 text-[11.5px] px-2.5 py-1 rounded-[5px] cursor-pointer font-inherit transition-colors',
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

        <button
          onClick={() => setReloadKey((k) => k + 1)}
          title="Re-read (a live session keeps growing)"
          className="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/[0.07] cursor-pointer bg-transparent border border-border"
        >
          <RefreshCw size={12} />
        </button>
        <CopyButton text={fullMarkdown} label="Copy all" />
        <button
          onClick={() => onResume(projectDir, entry)}
          className="inline-flex items-center gap-1.5 text-[11.5px] rounded-md border border-primary/35 bg-primary/[0.08] text-primary px-2.5 py-1 cursor-pointer font-inherit hover:bg-primary/[0.14] transition-colors"
        >
          <ArrowRight size={12} /> Resume
        </button>
        <button
          onClick={onClose}
          title="Close reader (Esc)"
          className="flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/[0.07] cursor-pointer bg-transparent border-none"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <TranscriptStates turns={turns} error={error} />
        {turns && turns.length > 0 && <TranscriptDocument turns={turns} view={view} />}
      </div>
    </div>
  );
}
