import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';

interface SeamProps {
  orientation: 'vertical' | 'horizontal';
  /** From `useDragValue` — turns the grip primary while the drag is live. */
  dragging: boolean;
  onStart: () => void;
  /** Absolute placement, for a seam floating over the pane grid. */
  style?: CSSProperties;
  /** Must carry a position: `relative` for a seam in flex flow, `absolute` for
   *  one placed over the grid. The hit area and grip are positioned against it. */
  className?: string;
  /** A soft edge away from the line, for a seam against a raised surface. */
  shadow?: boolean;
}

/** The 1px drag handle between two panes: a hairline you can actually grab,
 *  because the visible line carries a ±6px invisible hit area and a centred grip
 *  pill that lights up on hover and goes `primary` while dragging.
 *
 *  One component for all three seams — the two between grid panes and the file
 *  explorer's — which were previously the same markup copy-pasted. */
export default function Seam({ orientation, dragging, onStart, style, className, shadow }: SeamProps) {
  const vertical = orientation === 'vertical';
  return (
    <div
      onMouseDown={(e) => { e.preventDefault(); onStart(); }}
      style={style}
      title="Drag to resize"
      className={cn(
        'group z-20 bg-border-hover',
        vertical ? 'w-px cursor-col-resize' : 'h-px cursor-row-resize',
        shadow && (vertical
          ? 'shadow-[-14px_0_22px_-18px_rgba(0,0,0,0.9)]'
          : 'shadow-[0_-14px_22px_-18px_rgba(0,0,0,0.9)]'),
        className,
      )}
    >
      {/* wider invisible hit-area over the 1px line */}
      <span className={cn('absolute', vertical ? 'inset-y-0 -left-1.5 -right-1.5' : 'inset-x-0 -top-1.5 -bottom-1.5')} />
      <span
        className={cn(
          'absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-border-hover',
          vertical ? 'w-1 h-8' : 'w-8 h-1',
          'transition-colors group-hover:bg-muted-foreground',
          dragging && 'bg-primary',
        )}
      />
    </div>
  );
}
