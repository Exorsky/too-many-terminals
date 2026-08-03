import { AlignLeft, Braces, Columns2, File, FileText, RefreshCw, SquareTerminal } from 'lucide-react';
import type { Tab } from '@/types';
import { cn } from '@/lib/utils';
import CopyButton from './CopyButton';

export type SessionMode = 'terminal' | 'markdown' | 'split';
export type MarkdownView = 'rendered' | 'raw';

interface SessionBarProps {
  tab: Tab;
  /** Show the Terminal/Markdown toggle (pref on AND this tab can be read). */
  canRead: boolean;
  mode: SessionMode;
  view: MarkdownView;
  turnsCount: number | null;
  markdownText: string;
  onSetMode: (mode: SessionMode) => void;
  onSetView: (view: MarkdownView) => void;
  onRefresh: () => void;
}

function folderName(dir: string): string {
  return dir.split(/[/\\]/).filter(Boolean).pop() ?? dir;
}

const STATUS_DOT: Record<Tab['status'], string> = {
  working: 'bg-warning animate-pulse',
  idle: 'bg-success',
  requires_response: 'bg-attention animate-pulse',
  new: 'bg-muted-foreground/50',
};

/** The slim per-session bar above the terminal. Names the active session and,
 *  for a readable Claude session, hosts the Terminal/Markdown toggle plus the
 *  markdown controls (Rendered/Raw, copy, refresh). Visibility of the whole bar
 *  and of the toggle are user preferences (see General settings). */
export default function SessionBar({
  tab, canRead, mode, view, turnsCount, markdownText, onSetMode, onSetView, onRefresh,
}: SessionBarProps) {
  // The markdown pane is on screen in both 'markdown' (full) and 'split' modes,
  // so its controls (Rendered/Raw, copy, refresh, turn count) show for both.
  const isReading = mode === 'markdown' || mode === 'split';

  return (
    <div className="flex items-center gap-3 h-10 px-3 shrink-0 border-b border-border bg-card">
      {/* identity */}
      <div className="flex items-center gap-2 min-w-0">
        {tab.kind === 'claude'
          ? <span className={cn('w-[7px] h-[7px] rounded-full shrink-0', STATUS_DOT[tab.status])} />
          : tab.kind === 'file'
          ? <File size={12} className="text-muted-foreground shrink-0" />
          : <SquareTerminal size={12} className="text-muted-foreground shrink-0" />}
        <span className="text-[12px] font-semibold text-foreground truncate">{tab.name}</span>
        <span className="text-muted-foreground opacity-50 shrink-0">·</span>
        <span className="text-[11px] text-muted-foreground truncate shrink-0" title={tab.cwd}>{folderName(tab.cwd)}</span>
        {isReading && turnsCount !== null && (
          <>
            <span className="text-muted-foreground opacity-50 shrink-0">·</span>
            <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{turnsCount} turns</span>
          </>
        )}
      </div>

      <div className="flex-1" />

      {/* markdown controls — only while reading */}
      {isReading && (
        <div className="flex items-center gap-2">
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
      )}

      {/* Terminal / Split / Markdown toggle */}
      {canRead && (
        <div className="flex items-center gap-0.5 p-0.5 rounded-md border border-border bg-background">
          <button
            onClick={() => onSetMode('terminal')}
            className={cn(
              'inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-[5px] cursor-pointer font-inherit transition-colors',
              mode === 'terminal' ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <SquareTerminal size={12} /> Terminal
          </button>
          <button
            onClick={() => onSetMode('split')}
            title="Terminal and Markdown side by side"
            className={cn(
              'inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-[5px] cursor-pointer font-inherit transition-colors',
              mode === 'split' ? 'bg-secondary text-[#6fd4c9]' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Columns2 size={12} /> Split
          </button>
          <button
            onClick={() => onSetMode('markdown')}
            className={cn(
              'inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-[5px] cursor-pointer font-inherit transition-colors',
              mode === 'markdown' ? 'bg-secondary text-[#6fd4c9]' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <FileText size={12} /> Markdown
          </button>
        </div>
      )}
    </div>
  );
}
