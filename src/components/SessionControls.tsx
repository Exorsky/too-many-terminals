import { Check, Columns2, FileText, Rows2, Square, SquareTerminal } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { SessionMode } from '@/types';

export type { SessionMode };
export type SplitDirection = 'right' | 'down';
export type MarkdownView = 'rendered' | 'raw';

const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);

interface SessionControlsProps {
  /** The session has a transcript to read, and Preview is switched on. */
  canRead: boolean;
  mode: SessionMode;
  splitDirection: SplitDirection;
  onSetMode: (mode: SessionMode) => void;
  onSetSplitDirection: (direction: SplitDirection) => void;
  /** Open a new shell in a pane beside the focused one. */
  onSplitShell: (edge: 'right' | 'bottom') => void;
}

const BUTTON = 'flex items-center justify-center w-7 h-7 rounded-sm cursor-pointer border-none font-inherit transition-colors';

/** The current session's layout controls, docked to the session tab strip.
 *
 *  **One Split menu** for everything that puts something beside the terminal —
 *  a new shell or its transcript — because they used to be
 *  five look-alike icons in a row, two of them the same "columns" glyph meaning
 *  different things (a shell split, a transcript split). The menu names what
 *  goes where; ⌘D / ⌘⇧D skip it for the common case.
 *
 *  **Preview** stays a toggle of its own: it doesn't put anything beside the
 *  terminal, it swaps the terminal for a markdown read of the same session.
 *  See docs/features/session-workspace.md. */
export default function SessionControls({
  canRead, mode, splitDirection, onSetMode, onSetSplitDirection, onSplitShell,
}: SessionControlsProps) {
  const splitActive = canRead && mode === 'split';
  const mod = IS_MAC ? '⌘' : 'Ctrl+';

  return (
    <div className="flex items-center gap-0.5 shrink-0">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Split"
            title={`Split  ${IS_MAC ? '⌘D' : 'Ctrl+Shift+D'}`}
            className={cn(BUTTON, 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-selected')}
          >
            <Columns2 size={15} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={6} className="w-56">
          <DropdownMenuItem onClick={() => onSplitShell('right')}>
            <SquareTerminal size={13} />
            <span>Shell to the right</span>
            <span className="ml-auto font-mono text-[11px] text-muted-foreground">{IS_MAC ? '⌘D' : `${mod}Shift+D`}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onSplitShell('bottom')}>
            <SquareTerminal size={13} />
            <span>Shell below</span>
            <span className="ml-auto font-mono text-[11px] text-muted-foreground">{IS_MAC ? '⌘⇧D' : `${mod}Shift+Alt+D`}</span>
          </DropdownMenuItem>
          {canRead && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => { onSetMode('split'); onSetSplitDirection('right'); }}>
                <Columns2 size={13} />
                <span>Transcript to the right</span>
                {splitActive && splitDirection === 'right' && <Check size={13} className="ml-auto text-primary" />}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { onSetMode('split'); onSetSplitDirection('down'); }}>
                <Rows2 size={13} />
                <span>Transcript below</span>
                {splitActive && splitDirection === 'down' && <Check size={13} className="ml-auto text-primary" />}
              </DropdownMenuItem>
              {splitActive && (
                <DropdownMenuItem onClick={() => onSetMode('terminal')}>
                  <Square size={13} />
                  <span>Close transcript</span>
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {canRead && (
        <button
          type="button"
          onClick={() => onSetMode(mode === 'markdown' ? 'terminal' : 'markdown')}
          disabled={splitActive}
          title="Markdown Preview"
          aria-pressed={mode === 'markdown'}
          className={cn(
            BUTTON,
            mode === 'markdown'
              ? 'bg-secondary text-cyan'
              : 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-selected',
            splitActive && 'opacity-35 cursor-not-allowed hover:bg-transparent hover:text-muted-foreground',
          )}
        >
          <FileText size={15} />
        </button>
      )}
    </div>
  );
}
