import { Folder, History, PanelLeftClose, PanelLeftOpen, Plus, Sparkles, TerminalSquare, X } from 'lucide-react';
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
  cwd: string | null;
  collapsed: boolean;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewClaudeTab: () => void;
  onNewShellTab: (shellId: string) => void;
  onToggleHistory: () => void;
  onPickFolder: () => void;
  onToggleCollapse: () => void;
}

function folderName(cwd: string | null): string | null {
  if (!cwd) return null;
  return cwd.split(/[/\\]/).filter(Boolean).pop() ?? cwd;
}

export default function Sidebar({
  tabs, activeTabId, shellOptions, showHistory, cwd, collapsed,
  onSelectTab, onCloseTab, onNewClaudeTab, onNewShellTab, onToggleHistory,
  onPickFolder, onToggleCollapse,
}: SidebarProps) {
  if (collapsed) {
    return (
      <div className="flex flex-col items-center w-11 bg-card border-r border-border shrink-0 overflow-hidden">
        <div className="flex items-center justify-center h-10 w-full border-b border-border shrink-0">
          <button
            className="flex items-center justify-center w-7 h-7 rounded-sm text-muted-foreground hover:text-foreground hover:bg-white/8 border-none cursor-pointer"
            onClick={onToggleCollapse}
            title="Show sidebar"
          >
            <PanelLeftOpen size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden w-full py-2 flex flex-col items-center gap-1.5 scrollbar-thin">
          {tabs.map((tab) => {
            const isActive = !showHistory && tab.id === activeTabId;
            return (
              <button
                key={tab.id}
                className={cn(
                  'relative flex items-center justify-center w-8 h-8 rounded-md border-none cursor-pointer bg-transparent',
                  'transition-colors duration-100',
                  isActive ? 'bg-white/8 text-foreground' : 'text-muted-foreground hover:bg-white/5 hover:text-foreground',
                  tab.exited && 'opacity-50',
                )}
                onClick={() => onSelectTab(tab.id)}
                title={tab.name}
              >
                {isActive && <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-primary" />}
                {tab.kind === 'claude'
                  ? <Sparkles size={14} className="shrink-0" />
                  : <TerminalSquare size={14} className="shrink-0" />}
              </button>
            );
          })}
        </div>

        <button
          data-active={showHistory}
          className={cn(
            'flex items-center justify-center w-8 h-8 my-1 rounded-md border-none cursor-pointer bg-transparent shrink-0',
            showHistory ? 'text-foreground bg-white/8' : 'text-muted-foreground hover:text-foreground hover:bg-white/5',
          )}
          onClick={onToggleHistory}
          title="Browse past sessions"
        >
          <History size={15} />
        </button>
        <button
          className="flex items-center justify-center w-8 h-8 mb-2 rounded-md border-none cursor-pointer bg-transparent text-muted-foreground hover:text-foreground hover:bg-white/5 shrink-0"
          onClick={onPickFolder}
          title={cwd ?? 'Select folder'}
        >
          <Folder size={15} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-[260px] bg-card border-r border-border shrink-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-1.5 h-10 px-2.5 border-b border-border shrink-0">
        <TerminalSquare size={15} className="text-primary shrink-0" />
        <span className="text-[12px] font-semibold tracking-wide text-foreground/90 truncate">Claude Terminal</span>
        <button
          className="flex items-center justify-center w-6 h-6 ml-auto rounded-sm text-muted-foreground hover:text-foreground hover:bg-white/8 border-none cursor-pointer shrink-0"
          onClick={onToggleCollapse}
          title="Hide sidebar"
        >
          <PanelLeftClose size={14} />
        </button>
      </div>

      {/* Current folder */}
      <button
        className="flex items-center gap-2 h-8 px-2.5 border-b border-border shrink-0 text-[11px] text-muted-foreground hover:text-foreground hover:bg-white/4 border-none cursor-pointer font-inherit text-left"
        onClick={onPickFolder}
        title={cwd ?? 'Select a folder'}
      >
        <Folder size={12} className="shrink-0" />
        <span className="truncate flex-1">{folderName(cwd) ?? 'Select folder…'}</span>
      </button>

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
              className={cn(
                'flex items-center gap-2 w-[calc(100%-8px)] mx-1 my-0.5 px-2 py-1.5 rounded-sm text-[11px] font-inherit',
                cwd
                  ? 'text-muted-foreground/70 hover:text-foreground hover:bg-white/4 border-none cursor-pointer'
                  : 'text-muted-foreground/30 border-none cursor-not-allowed',
              )}
              title={cwd ? 'New session' : 'Select a folder first'}
              disabled={!cwd}
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
