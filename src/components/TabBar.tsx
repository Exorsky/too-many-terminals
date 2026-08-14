import { useEffect, useRef, useState, type ReactNode } from 'react';
import { File, TerminalSquare, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Tab } from '@/types';
import { TabIndicator } from './Sidebar';

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  /** Drag-reorder within the strip. Omitted = the strip isn't reorderable. */
  onReorderTab?: (tabId: string, targetId: string, position: 'before' | 'after') => void;
  /** Docked to the row's trailing edge, outside the scrolling tab list —
   *  `SessionControls` (Markdown Preview / Split) for the active session. */
  trailing?: ReactNode;
}

/** Left of the target's horizontal midpoint drops before it, right drops after
 *  — the sidebar's `dropSide` turned on its side for a horizontal strip. */
function dropSide(e: { clientX: number; currentTarget: HTMLElement }): 'before' | 'after' {
  const r = e.currentTarget.getBoundingClientRect();
  return e.clientX < r.left + r.width / 2 ? 'before' : 'after';
}

/** The tab strip docked above the content pane. Kind-agnostic — the icon logic
 *  below covers Claude sessions, shells and files — and it renders whatever list
 *  it's given: App.tsx feeds it the tabs you've actually gone into, in the order
 *  you opened them. Click to switch, drag to reorder, middle-click or × to close
 *  (what "close" means per kind is App.tsx's call). docs/features/file-explorer.md. */
export default function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab, onReorderTab, trailing }: TabBarProps) {
  const activeRef = useRef<HTMLDivElement>(null);
  // Which tab is being dragged (a ref, so `dragover` can decide synchronously)
  // and where the insertion line currently sits. One piece of state for the
  // whole strip rather than per-tab — the line only ever shows in one gap.
  const dragIdRef = useRef<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; pos: 'before' | 'after' } | null>(null);
  // With every session up here the strip scrolls, so a tab picked from the
  // sidebar (or opened behind the current scroll offset) has to be brought
  // into view — otherwise you'd switch and see no tab highlighted.
  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeTabId]);

  if (tabs.length === 0 && !trailing) return null;

  return (
    <div className="flex items-stretch h-8 shrink-0 border-b border-border bg-card">
      <div className="flex items-stretch flex-1 min-w-0 overflow-x-auto scrollbar-thin">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              ref={isActive ? activeRef : undefined}
              className={cn(
                'group relative flex items-center gap-1.5 pl-3 pr-1.5 max-w-[220px] shrink-0 border-r border-border',
                'text-[11px] cursor-pointer select-none',
                isActive ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-white/4',
                tab.exited && 'opacity-50',
              )}
              onClick={() => onSelectTab(tab.id)}
              onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); onCloseTab(tab.id); } }}
              draggable={!!onReorderTab}
              onDragStart={(e) => {
                dragIdRef.current = tab.id;
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', tab.id);
              }}
              onDragEnd={() => { dragIdRef.current = null; setDrop(null); }}
              onDragOver={(e) => {
                const id = dragIdRef.current;
                if (!id || id === tab.id) return; // not our drag, or the tab itself
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const pos = dropSide(e);
                // Same value bails out of the re-render, so the line never flickers.
                setDrop((d) => (d && d.id === tab.id && d.pos === pos ? d : { id: tab.id, pos }));
              }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(null); }}
              onDrop={(e) => {
                const id = dragIdRef.current;
                if (id && id !== tab.id) { e.preventDefault(); onReorderTab?.(id, tab.id, dropSide(e)); }
                dragIdRef.current = null;
                setDrop(null);
              }}
              title={tab.kind === 'file' ? tab.path : tab.cwd}
            >
              {drop?.id === tab.id && (
                <span
                  className={cn(
                    'absolute top-0 bottom-0 w-0.5 rounded-full bg-primary pointer-events-none',
                    'shadow-[0_0_6px_0_var(--primary)]',
                    drop.pos === 'before' ? 'left-0' : 'right-0',
                  )}
                />
              )}
              {isActive && <span className="absolute left-0 right-0 top-0 h-0.5 bg-[#6fd4c9]" />}
              {tab.kind === 'claude'
                ? <TabIndicator status={tab.status} dormant={tab.dormant} size={11} />
                : tab.kind === 'file'
                ? <File size={11} className="shrink-0" />
                : <TerminalSquare size={11} className="shrink-0" />}
              <span className="truncate">{tab.name}{tab.exited ? ' (exited)' : ''}</span>
              {tab.dirty && <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-warning" title="Unsaved changes" />}
              <button
                type="button"
                className={cn(
                  'flex items-center justify-center w-4 h-4 rounded-sm shrink-0 border-none cursor-pointer',
                  'bg-transparent text-muted-foreground/60 hover:text-foreground hover:bg-white/10',
                  'opacity-0 group-hover:opacity-100',
                )}
                onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
                title="Close"
              >
                <X size={11} />
              </button>
            </div>
          );
        })}
      </div>
      {trailing}
    </div>
  );
}
