import { useRef, useState } from 'react';
import { File, SquareTerminal, Sparkles, FolderTree, X } from 'lucide-react';
import { VIEW_MIME } from '@/lib/dnd';
import { contentKey, type PaneContent } from '@/lib/panes';
import { sessionState, STATE_DOT } from '@/lib/sessions';
import { cn } from '@/lib/utils';
import type { Tab } from '@/types';

export interface PaneTabsProps {
  contents: PaneContent[];
  activeKey: string | null;
  /** Every open session, to resolve a tab's name and status. */
  tabs: Tab[];
  /** False for a pane that doesn't have the keyboard: it keeps its notch so
   *  you can still read what it's showing, but dims. With four terminals on
   *  screen, knowing which one takes your next keystroke matters most. */
  paneFocused: boolean;
  onActivate: (key: string) => void;
  onClose: (key: string) => void;
  /** A tab dropped on this strip — from here or from another pane. */
  onDrop: (content: PaneContent, beforeKey: string | null) => void;
  /** The strip's trailing controls (markdown preview, close pane). */
  trailing?: React.ReactNode;
}

/** What a tab is called and what it looks like. A session's name comes from
 *  the session; the tool is a suffix only when it isn't Claude, because
 *  "Alpha" reads better than "Alpha · Claude" and the icon already says it. */
function describe(content: PaneContent, tabs: Tab[]) {
  if (content.kind === 'file') {
    return {
      label: content.path.split(/[/\\]/).pop() || content.path,
      title: content.path,
      icon: <File size={11} className="shrink-0 text-muted-foreground" />,
    };
  }
  const session = tabs.find((t) => t.id === content.sessionId);
  const name = session?.name ?? 'Session';
  const icon = content.tool === 'claude'
    ? (session
      ? <span className={cn('w-[7px] h-[7px] shrink-0 rounded-full box-border', STATE_DOT[sessionState(session)])} />
      : <Sparkles size={11} className="shrink-0 text-muted-foreground" />)
    : content.tool === 'shell'
      ? <SquareTerminal size={11} className="shrink-0 text-muted-foreground" />
      : <FolderTree size={11} className="shrink-0 text-muted-foreground" />;
  return {
    label: content.tool === 'claude' ? name : `${name} · ${content.tool === 'shell' ? 'Shell' : 'Files'}`,
    title: session?.cwd ?? name,
    icon,
  };
}

/** Left of the target's horizontal midpoint drops before it, right after. */
function dropSide(e: { clientX: number; currentTarget: HTMLElement }): 'before' | 'after' {
  const r = e.currentTarget.getBoundingClientRect();
  return e.clientX < r.left + r.width / 2 ? 'before' : 'after';
}

/** One pane's tab strip.
 *
 *  These are real tabs: drag one to another pane's strip to move it, onto a
 *  pane's edge to split, or within this strip to reorder. That is the whole
 *  reason the strip exists — an in-place switcher would have been smaller code
 *  and would not let you lay anything out.
 *
 *  A tab is a *thing on the workspace*, never a session. Closing one puts the
 *  thing away; the session stays in the sidebar, running. */
export default function PaneTabs({
  contents, activeKey, tabs, paneFocused, onActivate, onClose, onDrop, trailing,
}: PaneTabsProps) {
  const dragKeyRef = useRef<string | null>(null);
  const [dropAt, setDropAt] = useState<{ key: string; pos: 'before' | 'after' } | null>(null);

  const readDrag = (dt: DataTransfer): PaneContent | null => {
    try {
      const raw = dt.getData(VIEW_MIME);
      return raw ? (JSON.parse(raw) as PaneContent) : null;
    } catch {
      return null;
    }
  };

  return (
    <div
      data-pane-tabs
      className={cn(
        'flex items-stretch h-8 shrink-0 border-b border-border bg-card',
        !paneFocused && 'opacity-60',
      )}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(VIEW_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(e) => {
        // A drop on the strip's empty run, past the last tab: append.
        if (!e.dataTransfer.types.includes(VIEW_MIME)) return;
        e.preventDefault();
        e.stopPropagation();
        const content = readDrag(e.dataTransfer);
        setDropAt(null);
        dragKeyRef.current = null;
        if (content) onDrop(content, null);
      }}
    >
      <div className="flex items-stretch min-w-0 overflow-x-auto scrollbar-thin">
        {contents.map((content) => {
          const key = contentKey(content)!;
          const { label, title, icon } = describe(content, tabs);
          const isActive = key === activeKey;
          return (
            <div
              key={key}
              data-pane-tab
              data-active={isActive || undefined}
              title={title}
              className={cn(
                'group relative flex items-center gap-1.5 shrink-0 pl-2.5 pr-1.5 max-w-[190px]',
                'border-r border-border cursor-pointer text-[11px] transition-colors duration-100',
                isActive
                  ? 'bg-background text-foreground'
                  : 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-hover',
              )}
              onMouseDown={() => onActivate(key)}
              draggable
              onDragStart={(e) => {
                dragKeyRef.current = key;
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData(VIEW_MIME, JSON.stringify(content));
              }}
              onDragEnd={() => { dragKeyRef.current = null; setDropAt(null); }}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(VIEW_MIME)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const pos = dropSide(e);
                // Bailing on an unchanged value keeps the line from flickering.
                setDropAt((d) => (d?.key === key && d.pos === pos ? d : { key, pos }));
              }}
              onDragLeave={() => setDropAt((d) => (d?.key === key ? null : d))}
              onDrop={(e) => {
                if (!e.dataTransfer.types.includes(VIEW_MIME)) return;
                e.preventDefault();
                e.stopPropagation();
                const content_ = readDrag(e.dataTransfer);
                const pos = dropAt?.key === key ? dropAt.pos : dropSide(e);
                setDropAt(null);
                dragKeyRef.current = null;
                if (!content_) return;
                // "After this tab" is "before the next one"; past the end is a
                // plain append, which `addToPane` takes as a null.
                const at = contents.findIndex((c) => contentKey(c) === key);
                const beforeKey = pos === 'before' ? key : contentKey(contents[at + 1]);
                onDrop(content_, beforeKey);
              }}
            >
              {dropAt?.key === key && (
                <span
                  className={cn(
                    'absolute top-1 bottom-1 w-0.5 rounded-full bg-primary pointer-events-none',
                    dropAt.pos === 'before' ? 'left-0' : 'right-0',
                  )}
                />
              )}
              {isActive && <span className="absolute left-0 right-0 top-0 h-0.5 bg-primary" />}
              {icon}
              <span className="truncate flex-1 min-w-0">{label}</span>
              <button
                type="button"
                aria-label={`Close ${label}`}
                className={cn(
                  'flex items-center justify-center w-4 h-4 shrink-0 rounded-sm border-none cursor-pointer',
                  'bg-transparent text-muted-foreground hover:text-foreground hover:bg-selected-hover',
                  isActive ? '' : 'opacity-0 group-hover:opacity-100',
                )}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onClose(key); }}
              >
                <X size={11} />
              </button>
            </div>
          );
        })}
      </div>
      {trailing && <div className="flex items-center ml-auto shrink-0 pr-1">{trailing}</div>}
    </div>
  );
}
