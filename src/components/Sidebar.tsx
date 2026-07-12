import { History, Plus, Sparkles, TerminalSquare, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ShellOption, Tab } from '@/types';
import UsageMeter from './UsageMeter';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface SidebarProps {
  tabs: Tab[];
  activeTabId: string | null;
  shellOptions: ShellOption[];
  showHistory: boolean;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewClaudeTab: () => void;
  onNewShellTab: (shellId: string) => void;
  onToggleHistory: () => void;
}

export default function Sidebar({
  tabs, activeTabId, shellOptions, showHistory,
  onSelectTab, onCloseTab, onNewClaudeTab, onNewShellTab, onToggleHistory,
}: SidebarProps) {
  return (
    <div className="flex flex-col w-[260px] bg-card border-r border-border shrink-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-1.5 h-10 px-2.5 border-b border-border shrink-0">
        <TerminalSquare size={15} className="text-primary shrink-0" />
        <span className="text-[12px] font-semibold tracking-wide text-foreground/90 truncate">Claude Terminal</span>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-1 scrollbar-thin">
        {tabs.map((tab) => {
          const isActive = !showHistory && tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              className={cn(
                'group relative flex items-center gap-2 w-[calc(100%-8px)] mx-1 my-0.5 px-2 py-1.5 rounded-sm',
                'text-[11px] cursor-pointer transition-colors duration-100',
                isActive
                  ? 'bg-white/8 text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-white/4',
                tab.exited && 'opacity-50',
              )}
              onClick={() => onSelectTab(tab.id)}
              title={tab.cwd}
            >
              {isActive && <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-primary" />}
              {tab.kind === 'claude'
                ? <Sparkles size={12} className="shrink-0 text-primary/80" />
                : <TerminalSquare size={12} className="shrink-0" />}
              <span className="truncate flex-1">{tab.name}{tab.exited ? ' (exited)' : ''}</span>
              <button
                className={cn(
                  'flex items-center justify-center w-4 h-4 rounded-sm shrink-0 border-none cursor-pointer',
                  'bg-transparent text-muted-foreground/60 hover:text-foreground hover:bg-white/10',
                  'opacity-0 group-hover:opacity-100',
                )}
                onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
                title="Close tab"
              >
                <X size={11} />
              </button>
            </div>
          );
        })}

        {/* New session */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex items-center gap-2 w-[calc(100%-8px)] mx-1 my-0.5 px-2 py-1.5 rounded-sm text-[11px] text-muted-foreground/70 hover:text-foreground hover:bg-white/4 border-none cursor-pointer font-inherit"
              title="New session"
            >
              <Plus size={12} className="shrink-0" />
              <span>New session</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={onNewClaudeTab}>
              <Sparkles size={13} />
              <span>Claude</span>
            </DropdownMenuItem>
            {shellOptions.length > 0 && <DropdownMenuSeparator />}
            {shellOptions.map((shell) => (
              <DropdownMenuItem key={shell.id} onClick={() => onNewShellTab(shell.id)}>
                <TerminalSquare size={13} />
                <span>{shell.label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <UsageMeter />

      {/* Footer: history, bottom-anchored */}
      <button
        data-active={showHistory}
        className={cn(
          'relative flex items-center gap-2 h-9 px-3 border-t border-border text-[12px] cursor-pointer shrink-0',
          'bg-transparent border-x-0 border-b-0 font-inherit transition-colors duration-100',
          showHistory ? 'text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-white/4',
        )}
        onClick={onToggleHistory}
        title="Browse past sessions"
      >
        {showHistory && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-primary" />}
        <History size={14} />
        <span>History</span>
      </button>
    </div>
  );
}
