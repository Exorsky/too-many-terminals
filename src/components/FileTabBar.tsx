import { File, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Tab } from '@/types';

interface FileTabBarProps {
  /** Already filtered to kind === 'file'. */
  tabs: Tab[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
}

/** Open file tabs live on their own axis from Claude/shell sessions — a
 *  session is "what I'm working on", a file is "what I have open" — so they
 *  get their own strip docked above the content pane instead of mixing into
 *  the sidebar's per-project session list. */
export default function FileTabBar({ tabs, activeTabId, onSelectTab, onCloseTab }: FileTabBarProps) {
  if (tabs.length === 0) return null;

  return (
    <div className="flex items-stretch h-8 shrink-0 border-b border-border bg-card overflow-x-auto scrollbar-thin">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            className={cn(
              'group relative flex items-center gap-1.5 pl-3 pr-1.5 max-w-[220px] shrink-0 border-r border-border',
              'text-[11px] cursor-pointer select-none',
              isActive ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-white/4',
            )}
            onClick={() => onSelectTab(tab.id)}
            title={tab.path}
          >
            {isActive && <span className="absolute left-0 right-0 top-0 h-0.5 bg-[#6fd4c9]" />}
            <File size={11} className="shrink-0" />
            <span className="truncate">{tab.name}</span>
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
  );
}
