import { Check, Columns2, FileText, Rows2, Square } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export type SessionMode = 'terminal' | 'markdown' | 'split';
export type SplitDirection = 'right' | 'down';
export type MarkdownView = 'rendered' | 'raw';

interface SessionControlsProps {
  mode: SessionMode;
  splitDirection: SplitDirection;
  onSetMode: (mode: SessionMode) => void;
  onSetSplitDirection: (direction: SplitDirection) => void;
}

/** Docked to the trailing edge of the tab strip for a readable Claude tab.
 *  Two independent controls, not one three-way switch: **Preview** turns the
 *  terminal into a markdown read of the same session; **Split** is its own
 *  layout choice (side by side or stacked), picked from a menu instead of
 *  being a third state of Preview — it can run alongside either mode.
 *  Replaces the old Terminal/Split/Markdown toggle and the session bar it
 *  lived in; markdown's own controls (Rendered/Raw, copy, refresh) now live
 *  on `MarkdownPane` itself. See docs/design.md. */
export default function SessionControls({ mode, splitDirection, onSetMode, onSetSplitDirection }: SessionControlsProps) {
  const splitActive = mode === 'split';

  return (
    <div className="flex items-center gap-0.5 px-1.5 shrink-0">
      <button
        type="button"
        onClick={() => onSetMode(mode === 'markdown' ? 'terminal' : 'markdown')}
        disabled={splitActive}
        title="Markdown Preview"
        aria-pressed={mode === 'markdown'}
        className={cn(
          'flex items-center justify-center w-6 h-6 rounded-sm cursor-pointer border-none font-inherit transition-colors',
          mode === 'markdown'
            ? 'bg-secondary text-[#6fd4c9]'
            : 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-white/[0.07]',
          splitActive && 'opacity-35 cursor-not-allowed hover:bg-transparent hover:text-muted-foreground',
        )}
      >
        <FileText size={13} />
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title="Split view"
            aria-pressed={splitActive}
            className={cn(
              'flex items-center justify-center w-6 h-6 rounded-sm cursor-pointer border-none font-inherit transition-colors',
              splitActive
                ? 'bg-secondary text-[#6fd4c9]'
                : 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-white/[0.07]',
            )}
          >
            <Columns2 size={13} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={6} className="w-40">
          <DropdownMenuItem onClick={() => { onSetMode('split'); onSetSplitDirection('right'); }}>
            <Columns2 size={13} />
            <span>Split right</span>
            {splitActive && splitDirection === 'right' && <Check size={13} className="ml-auto text-primary" />}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => { onSetMode('split'); onSetSplitDirection('down'); }}>
            <Rows2 size={13} />
            <span>Split down</span>
            {splitActive && splitDirection === 'down' && <Check size={13} className="ml-auto text-primary" />}
          </DropdownMenuItem>
          {splitActive && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onSetMode('terminal')}>
                <Square size={13} />
                <span>Unsplit</span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
