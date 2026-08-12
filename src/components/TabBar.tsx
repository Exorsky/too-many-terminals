import type { ReactNode } from 'react';
import { File, TerminalSquare, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Tab } from '@/types';
import { TabIndicator } from './Sidebar';

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  /** Docked to the row's trailing edge, outside the scrolling tab list —
   *  `SessionControls` (Markdown Preview / Split) for the active session. */
  trailing?: ReactNode;
}

/** A strip of open tabs docked above the content pane. Renders whatever it's
 *  given — the icon logic below covers all three tab kinds — but App.tsx only
 *  ever feeds it every open file tab plus a *single* slot for whichever
 *  session/terminal was last active. A session doesn't get a permanent row
 *  here the way a file does (it's already always-open — the sidebar owns
 *  it); this is just a "come back here" pointer so switching between the
 *  session you were on and any open files doesn't need a sidebar detour. See
 *  docs/features/file-explorer.md. */
export default function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab, trailing }: TabBarProps) {
  if (tabs.length === 0 && !trailing) return null;

  return (
    <div className="flex items-stretch h-8 shrink-0 border-b border-border bg-card">
      <div className="flex items-stretch flex-1 min-w-0 overflow-x-auto scrollbar-thin">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              className={cn(
                'group relative flex items-center gap-1.5 pl-3 pr-1.5 max-w-[220px] shrink-0 border-r border-border',
                'text-[11px] cursor-pointer select-none',
                isActive ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-white/4',
                tab.exited && 'opacity-50',
              )}
              onClick={() => onSelectTab(tab.id)}
              title={tab.kind === 'file' ? tab.path : tab.cwd}
            >
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
