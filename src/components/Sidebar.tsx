import { useState } from 'react';
import {
  ChevronRight, Folder, FolderPlus, History, PanelLeftClose, PanelLeftOpen,
  Plus, Sparkles, TerminalSquare, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PROJECT_COLORS, type ShellOption, type Tab } from '@/types';
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
  projects: string[];
  collapsed: boolean;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewClaudeTab: (dir: string) => void;
  onNewShellTab: (dir: string, shellId: string) => void;
  onToggleHistory: () => void;
  onAddProject: () => void;
  onRemoveProject: (dir: string) => void;
  onToggleCollapse: () => void;
}

function folderName(dir: string): string {
  return dir.split(/[/\\]/).filter(Boolean).pop() ?? dir;
}

/** Sequential per-project accent color, in the order folders were added —
 *  same scheme the original multi-project app used. */
function projectHue(index: number): number {
  return PROJECT_COLORS[index % PROJECT_COLORS.length].hue;
}

function NewSessionMenu({ dir, shellOptions, onNewClaudeTab, onNewShellTab }: {
  dir: string;
  shellOptions: ShellOption[];
  onNewClaudeTab: (dir: string) => void;
  onNewShellTab: (dir: string, shellId: string) => void;
}) {
  return (
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
        <DropdownMenuItem onClick={() => onNewClaudeTab(dir)}>
          <Sparkles size={13} />
          <span>Claude</span>
        </DropdownMenuItem>
        {shellOptions.length > 0 && <DropdownMenuSeparator />}
        {shellOptions.map((shell) => (
          <DropdownMenuItem key={shell.id} onClick={() => onNewShellTab(dir, shell.id)}>
            <TerminalSquare size={13} />
            <span>{shell.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TabRow({ tab, isActive, onSelectTab, onCloseTab }: {
  tab: Tab;
  isActive: boolean;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
}) {
  return (
    <div
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
}

function ProjectCard({
  dir, hue, tabs, activeTabId, showHistory, shellOptions,
  onSelectTab, onCloseTab, onNewClaudeTab, onNewShellTab, onRemoveProject,
}: {
  dir: string;
  hue: number;
  tabs: Tab[];
  activeTabId: string | null;
  showHistory: boolean;
  shellOptions: ShellOption[];
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewClaudeTab: (dir: string) => void;
  onNewShellTab: (dir: string, shellId: string) => void;
  onRemoveProject: (dir: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div
      className="mx-2 mb-2 rounded-md border overflow-hidden transition-colors duration-100"
      style={{ borderColor: `hsla(${hue}, 55%, 58%, 0.22)`, backgroundColor: `hsla(${hue}, 55%, 58%, 0.05)` }}
    >
      <div
        className="group/card relative flex items-center gap-2 w-full text-left px-2.5 py-2 text-[11px] font-semibold text-foreground/90 cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
        title={dir}
      >
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: `hsl(${hue} 55% 50%)` }} />
        <span className="truncate flex-1">{folderName(dir)}</span>
        <button
          className="flex items-center justify-center w-5 h-5 rounded-sm shrink-0 border-none cursor-pointer bg-transparent text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover/card:opacity-100"
          onClick={(e) => { e.stopPropagation(); onRemoveProject(dir); }}
          title="Remove folder"
        >
          <X size={12} />
        </button>
        <ChevronRight size={12} className={cn('shrink-0 text-muted-foreground/60 transition-transform duration-150', expanded && 'rotate-90')} />
      </div>

      {expanded && (
        <div className="pb-1">
          {tabs.map((tab) => (
            <TabRow
              key={tab.id}
              tab={tab}
              isActive={!showHistory && tab.id === activeTabId}
              onSelectTab={onSelectTab}
              onCloseTab={onCloseTab}
            />
          ))}
          <NewSessionMenu dir={dir} shellOptions={shellOptions} onNewClaudeTab={onNewClaudeTab} onNewShellTab={onNewShellTab} />
        </div>
      )}
    </div>
  );
}

export default function Sidebar({
  tabs, activeTabId, shellOptions, showHistory, projects, collapsed,
  onSelectTab, onCloseTab, onNewClaudeTab, onNewShellTab, onToggleHistory,
  onAddProject, onRemoveProject, onToggleCollapse,
}: SidebarProps) {
  // A single root element (shared across the collapsed/expanded states) lets
  // the width change animate — swapping to two separate `if`-return roots
  // would remount the whole sidebar and skip the transition entirely.
  return (
    <div
      className={cn(
        'flex flex-col bg-card border-r border-border shrink-0 overflow-hidden',
        'transition-[width] duration-200 ease-out',
        collapsed ? 'w-11 items-center' : 'w-[260px]',
      )}
    >
      {collapsed ? (
        <>
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
            onClick={onAddProject}
            title="Add folder"
          >
            <FolderPlus size={15} />
          </button>
        </>
      ) : (
        <>
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

          <div className="flex-1 overflow-y-auto overflow-x-hidden py-2 scrollbar-thin">
            {projects.length === 0 && (
              <div className="flex flex-col items-center gap-1.5 text-center px-4 py-8 text-muted-foreground">
                <Folder size={18} className="text-[#33363f]" />
                <div className="text-[11px]">No folders open</div>
              </div>
            )}

            {projects.map((dir, index) => (
              <ProjectCard
                key={dir}
                dir={dir}
                hue={projectHue(index)}
                tabs={tabs.filter((t) => t.cwd === dir)}
                activeTabId={activeTabId}
                showHistory={showHistory}
                shellOptions={shellOptions}
                onSelectTab={onSelectTab}
                onCloseTab={onCloseTab}
                onNewClaudeTab={onNewClaudeTab}
                onNewShellTab={onNewShellTab}
                onRemoveProject={onRemoveProject}
              />
            ))}

            <button
              className="flex items-center gap-2 w-[calc(100%-8px)] mx-1 mb-1 px-2.5 py-2 rounded-md border border-dashed border-border text-[11px] text-muted-foreground hover:text-foreground hover:border-[#33363f] bg-transparent cursor-pointer font-inherit"
              onClick={onAddProject}
            >
              <FolderPlus size={13} className="shrink-0" />
              <span>{projects.length === 0 ? 'Select folder…' : 'Add folder…'}</span>
            </button>
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
        </>
      )}
    </div>
  );
}
