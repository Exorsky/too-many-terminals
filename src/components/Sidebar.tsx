import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import {
  CheckCircle2, ChevronRight, Circle, File, FileText, Folder, FolderOpen, FolderPlus, FolderTree, History, Loader2,
  MessageCircle, Moon, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Settings, Sparkles, TerminalSquare, X,
} from 'lucide-react';
import { cn, folderName } from '@/lib/utils';
import { projectHue, type ShellOption, type Tab, type TabStatus } from '@/types';
import UsageMeter from './UsageMeter';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';

interface SidebarProps {
  tabs: Tab[];
  activeTabId: string | null;
  shellOptions: ShellOption[];
  showHistory: boolean;
  showSettings: boolean;
  showHome: boolean;
  showFiles: boolean;
  projects: string[];
  collapsed: boolean;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onReadTab: (tab: Tab) => void;
  onOpenDirectory: (dir: string) => void;
  /** Whether the markdown reader is available (both prefs on) — gates the row's read icon. */
  markdownEnabled: boolean;
  onNewClaudeTab: (dir: string) => void;
  onNewShellTab: (dir: string, shellId: string) => void;
  onRenameTab: (tabId: string, name: string) => void;
  onToggleHistory: () => void;
  onToggleSettings: () => void;
  onToggleFiles: () => void;
  onGoHome: () => void;
  onAddProject: () => void;
  onRemoveProject: (dir: string) => void;
  onReorderProject: (sourceDir: string, targetDir: string, position: DropPos) => void;
  onReorderTab: (tabId: string, targetId: string, position: DropPos) => void;
  onToggleCollapse: () => void;
}

/** The item currently being dragged in the sidebar, held in a ref shared by the
 *  cards and tab rows so a drop target can decide — synchronously during
 *  dragover — whether it's a valid target (a folder can only reorder among
 *  folders, a session only among sessions in the *same* folder). */
type DragItem =
  | { kind: 'folder'; dir: string }
  | { kind: 'tab'; id: string; cwd: string };

type DragRef = MutableRefObject<DragItem | null>;

/** Which side of the hovered target the dragged item will land on. */
type DropPos = 'before' | 'after';

/** Above the target's vertical midpoint drops before it, below drops after —
 *  so the insertion line always shows the exact gap the item will fall into. */
function dropSide(e: { clientY: number; currentTarget: HTMLElement }): DropPos {
  const r = e.currentTarget.getBoundingClientRect();
  return e.clientY < r.top + r.height / 2 ? 'before' : 'after';
}

/** The insertion line shown while dragging — a glowing accent bar with a
 *  leading cap, sitting in the gap the item will drop into. `flush` tucks it to
 *  the target's own edge for cards (whose `overflow-hidden` would clip a line
 *  floated into the gap); rows let it sit in the margin between them. */
function DropLine({ pos, flush = false }: { pos: DropPos; flush?: boolean }) {
  return (
    <span
      className={cn(
        'absolute z-10 h-0.5 rounded-full bg-primary pointer-events-none',
        'shadow-[0_0_6px_0_var(--primary)]',
        flush ? 'left-0 right-0' : 'left-2 right-2',
        pos === 'before'
          ? (flush ? 'top-0' : '-top-px')
          : (flush ? 'bottom-0' : '-bottom-px'),
      )}
    >
      <span className="absolute -left-0.5 -top-0.75 w-2 h-2 rounded-full bg-primary shadow-[0_0_6px_0_var(--primary)]" />
    </span>
  );
}

/** Live status of a Claude tab, learned from Claude Code's own hooks. A
 *  dormant tab (restored-but-not-yet-shown, or auto-slept while idle) has no
 *  live process, so it reads as a quiet moon regardless of its last status. */
export function TabIndicator({ status, dormant, size = 12 }: { status: TabStatus; dormant?: boolean; size?: number }) {
  if (dormant) {
    return <Moon size={size} className="shrink-0 text-muted-foreground/50" />;
  }
  switch (status) {
    case 'working':
      return <Loader2 size={size} className="shrink-0 text-warning animate-spin" />;
    case 'idle':
      return <CheckCircle2 size={size} className="shrink-0 text-success" />;
    case 'requires_response':
      return <MessageCircle size={size} className="shrink-0 text-attention animate-pulse" />;
    case 'new':
      return <Circle size={size} className="shrink-0 text-muted-foreground/50" />;
  }
}

/** The pinned "Waiting on you" strip above the project cards: every Claude
 *  session that stopped and is blocked on you (status `requires_response`),
 *  gathered across *all* folders so you never have to hunt for the one that's
 *  asking. Collapses to nothing when the queue is empty — the only place a
 *  session is allowed to chase you. See docs/features/attention-inbox.md. */
function AttentionStrip({ tabs, projects, activeTabId, showHistory, onSelectTab }: {
  tabs: Tab[];
  projects: string[];
  activeTabId: string | null;
  showHistory: boolean;
  onSelectTab: (tabId: string) => void;
}) {
  const waiting = tabs.filter(
    (t) => t.kind === 'claude' && t.status === 'requires_response' && !t.exited,
  );
  if (waiting.length === 0) return null;

  return (
    <div
      className="mx-2 mt-2 mb-1 rounded-md border overflow-hidden shrink-0"
      style={{ borderColor: 'rgba(255,159,90,0.28)', backgroundColor: 'rgba(255,159,90,0.05)' }}
    >
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-attention">
        <MessageCircle size={11} className="shrink-0 animate-pulse" />
        <span>Waiting on you</span>
        <span className="ml-auto flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-attention text-[10px] font-bold text-background">
          {waiting.length}
        </span>
      </div>
      <div className="max-h-[38vh] overflow-y-auto scrollbar-thin pb-1">
        {waiting.map((tab) => {
          const idx = projects.indexOf(tab.cwd);
          const hue = projectHue(idx < 0 ? 0 : idx);
          const isActive = !showHistory && tab.id === activeTabId;
          return (
            <button
              key={tab.id}
              className={cn(
                'relative flex items-center gap-2 w-[calc(100%-8px)] mx-1 my-0.5 px-2 py-1.5 rounded-sm',
                'text-[11px] text-left border-none cursor-pointer font-inherit transition-colors duration-100',
                isActive
                  ? 'bg-white/8 text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-white/4',
              )}
              onClick={() => onSelectTab(tab.id)}
              title={tab.cwd}
            >
              <MessageCircle size={12} className="shrink-0 text-attention animate-pulse" />
              <span className="truncate flex-1">{tab.name}</span>
              <span className="flex items-center gap-1 shrink-0 max-w-[45%] text-[10px] text-muted-foreground/70">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: `hsl(${hue} 55% 50%)` }} />
                <span className="truncate">{folderName(tab.cwd)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
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

function TabRow({ tab, isActive, dragRef, markdownEnabled, onSelectTab, onCloseTab, onReadTab, onRenameTab, onOpenDirectory, onReorderTab }: {
  tab: Tab;
  isActive: boolean;
  dragRef: DragRef;
  markdownEnabled: boolean;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onReadTab: (tab: Tab) => void;
  onRenameTab: (tabId: string, name: string) => void;
  onOpenDirectory: (dir: string) => void;
  onReorderTab: (tabId: string, targetId: string, position: DropPos) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tab.name);
  const [dropPos, setDropPos] = useState<DropPos | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /** A session drag only targets another session in the same folder. */
  const canAccept = () => {
    const d = dragRef.current;
    return d?.kind === 'tab' && d.cwd === tab.cwd && d.id !== tab.id;
  };

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== tab.name) onRenameTab(tab.id, trimmed);
    setEditing(false);
  };

  const startRename = () => { setDraft(tab.name); setEditing(true); };

  const rowClass = cn(
    'group relative flex items-center gap-2 w-[calc(100%-8px)] mx-1 my-0.5 px-2 py-1.5 rounded-sm',
    'text-[11px] transition-colors duration-100',
    isActive
      ? 'bg-white/8 text-foreground'
      : 'text-muted-foreground hover:text-foreground hover:bg-white/4',
    tab.exited && 'opacity-50',
  );
  const icon = tab.kind === 'claude'
    ? <TabIndicator status={tab.status} dormant={tab.dormant} />
    : tab.kind === 'file'
    ? <File size={12} className="shrink-0" />
    : <TerminalSquare size={12} className="shrink-0" />;

  if (editing) {
    return (
      <div className={cn(rowClass, 'cursor-text')}>
        {isActive && <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-primary" />}
        {icon}
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') { e.preventDefault(); setDraft(tab.name); setEditing(false); }
            e.stopPropagation();
          }}
          className="flex-1 min-w-0 bg-transparent border-none outline-none text-[11px] text-foreground font-inherit"
        />
      </div>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(rowClass, 'cursor-pointer')}
          draggable
          onDragStart={(e) => {
            dragRef.current = { kind: 'tab', id: tab.id, cwd: tab.cwd };
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', tab.id);
            e.stopPropagation();
          }}
          onDragEnd={() => { dragRef.current = null; setDropPos(null); }}
          onDragOver={(e) => {
            if (!canAccept()) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setDropPos(dropSide(e)); // identical value bails out of re-render, so no flicker
          }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropPos(null); }}
          onDrop={(e) => {
            const d = dragRef.current;
            if (d?.kind === 'tab' && d.cwd === tab.cwd && d.id !== tab.id) {
              e.preventDefault();
              onReorderTab(d.id, tab.id, dropSide(e));
            }
            setDropPos(null);
          }}
          onClick={() => onSelectTab(tab.id)}
          onDoubleClick={startRename}
          title={tab.cwd}
        >
          {dropPos && <DropLine pos={dropPos} />}
          {isActive && <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-primary" />}
          {icon}
          <span className="truncate flex-1">{tab.name}{tab.exited ? ' (exited)' : ''}</span>
          {markdownEnabled && tab.kind === 'claude' && tab.resumeSessionId && (
            <button
              className={cn(
                'flex items-center justify-center w-4 h-4 rounded-sm shrink-0 border-none cursor-pointer',
                'bg-transparent text-muted-foreground/60 hover:text-[#6fd4c9] hover:bg-white/10',
                'opacity-0 group-hover:opacity-100',
              )}
              onClick={(e) => { e.stopPropagation(); onReadTab(tab); }}
              title="Read this session as Markdown"
            >
              <FileText size={11} />
            </button>
          )}
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
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-40">
        <ContextMenuItem onSelect={startRename}>
          <Pencil size={13} />
          <span>Rename</span>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onOpenDirectory(tab.cwd)}>
          <FolderOpen size={13} />
          <span>Open directory</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={() => onCloseTab(tab.id)}>
          <X size={13} />
          <span>Close</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function ProjectCard({
  dir, hue, tabs, activeTabId, showHistory, shellOptions, dragRef, markdownEnabled,
  onSelectTab, onCloseTab, onReadTab, onRenameTab, onOpenDirectory, onNewClaudeTab, onNewShellTab, onRemoveProject,
  onReorderProject, onReorderTab,
}: {
  dir: string;
  hue: number;
  tabs: Tab[];
  activeTabId: string | null;
  showHistory: boolean;
  shellOptions: ShellOption[];
  dragRef: DragRef;
  markdownEnabled: boolean;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onReadTab: (tab: Tab) => void;
  onRenameTab: (tabId: string, name: string) => void;
  onOpenDirectory: (dir: string) => void;
  onNewClaudeTab: (dir: string) => void;
  onNewShellTab: (dir: string, shellId: string) => void;
  onRemoveProject: (dir: string) => void;
  onReorderProject: (sourceDir: string, targetDir: string, position: DropPos) => void;
  onReorderTab: (tabId: string, targetId: string, position: DropPos) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [dropPos, setDropPos] = useState<DropPos | null>(null);

  /** A folder drag only targets another folder. */
  const canAccept = () => {
    const d = dragRef.current;
    return d?.kind === 'folder' && d.dir !== dir;
  };

  return (
    <div
      className="relative mx-2 mb-2 rounded-md border overflow-hidden transition-colors duration-100"
      style={{ borderColor: `hsla(${hue}, 55%, 58%, 0.22)`, backgroundColor: `hsla(${hue}, 55%, 58%, 0.05)` }}
      onDragOver={(e) => {
        if (!canAccept()) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDropPos(dropSide(e));
      }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropPos(null); }}
      onDrop={(e) => {
        const d = dragRef.current;
        if (d?.kind === 'folder' && d.dir !== dir) { e.preventDefault(); onReorderProject(d.dir, dir, dropSide(e)); }
        setDropPos(null);
      }}
      onDragEnd={() => setDropPos(null)}
    >
      {dropPos && <DropLine pos={dropPos} flush />}
      <div
        className="group/card relative flex items-center gap-2 w-full text-left px-2.5 py-2 text-[11px] font-semibold text-foreground/90 cursor-pointer"
        draggable
        onDragStart={(e) => {
          dragRef.current = { kind: 'folder', dir };
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', dir);
        }}
        onDragEnd={() => { dragRef.current = null; setDropPos(null); }}
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
              dragRef={dragRef}
              markdownEnabled={markdownEnabled}
              onSelectTab={onSelectTab}
              onCloseTab={onCloseTab}
              onReadTab={onReadTab}
              onRenameTab={onRenameTab}
              onOpenDirectory={onOpenDirectory}
              onReorderTab={onReorderTab}
            />
          ))}
          <NewSessionMenu dir={dir} shellOptions={shellOptions} onNewClaudeTab={onNewClaudeTab} onNewShellTab={onNewShellTab} />
        </div>
      )}
    </div>
  );
}

export default function Sidebar({
  tabs, activeTabId, shellOptions, showHistory, showSettings, showHome, showFiles, projects, collapsed, markdownEnabled,
  onSelectTab, onCloseTab, onReadTab, onOpenDirectory, onNewClaudeTab, onNewShellTab, onRenameTab, onToggleHistory, onToggleSettings, onToggleFiles, onGoHome,
  onAddProject, onRemoveProject, onReorderProject, onReorderTab, onToggleCollapse,
}: SidebarProps) {
  const dragRef = useRef<DragItem | null>(null);
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
                    ? <TabIndicator status={tab.status} dormant={tab.dormant} size={14} />
                    : tab.kind === 'file'
                    ? <File size={14} className="shrink-0" />
                    : <TerminalSquare size={14} className="shrink-0" />}
                </button>
              );
            })}
          </div>

          <button
            data-active={showHome}
            className={cn(
              'flex items-center justify-center w-8 h-8 mt-1 rounded-md border-none cursor-pointer bg-transparent shrink-0',
              showHome ? 'text-foreground bg-white/8' : 'text-muted-foreground hover:text-foreground hover:bg-white/5',
            )}
            onClick={onGoHome}
            title="Home"
          >
            <TerminalSquare size={15} />
          </button>
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
            data-active={showFiles}
            className={cn(
              'flex items-center justify-center w-8 h-8 rounded-md border-none cursor-pointer bg-transparent shrink-0',
              showFiles ? 'text-foreground bg-white/8' : 'text-muted-foreground hover:text-foreground hover:bg-white/5',
            )}
            onClick={onToggleFiles}
            title="File explorer"
          >
            <FolderTree size={15} />
          </button>
          <button
            className="flex items-center justify-center w-8 h-8 rounded-md border-none cursor-pointer bg-transparent text-muted-foreground hover:text-foreground hover:bg-white/5 shrink-0"
            onClick={onAddProject}
            title="Add folder"
          >
            <FolderPlus size={15} />
          </button>
          <button
            data-active={showSettings}
            className={cn(
              'flex items-center justify-center w-8 h-8 mb-2 rounded-md border-none cursor-pointer bg-transparent shrink-0',
              showSettings ? 'text-foreground bg-white/8' : 'text-muted-foreground hover:text-foreground hover:bg-white/5',
            )}
            onClick={onToggleSettings}
            title="Settings"
          >
            <Settings size={15} />
          </button>
        </>
      ) : (
        <>
          {/* Header */}
          <div className="flex items-center gap-1.5 h-10 px-2.5 border-b border-border shrink-0">
            <button
              data-active={showHome}
              className={cn(
                'flex items-center gap-1.5 min-w-0 -mx-1 px-1 py-1 rounded-sm border-none cursor-pointer bg-transparent',
                'transition-colors duration-100',
                showHome ? 'text-foreground' : 'text-foreground/90 hover:bg-white/5',
              )}
              onClick={onGoHome}
              title="Home"
            >
              <TerminalSquare size={15} className={cn('shrink-0', showHome ? 'text-primary' : 'text-primary/70')} />
              <span className="text-[12px] font-semibold tracking-wide truncate">Too Many Terminals</span>
            </button>
            <button
              className="flex items-center justify-center w-6 h-6 ml-auto rounded-sm text-muted-foreground hover:text-foreground hover:bg-white/8 border-none cursor-pointer shrink-0"
              onClick={onToggleCollapse}
              title="Hide sidebar"
            >
              <PanelLeftClose size={14} />
            </button>
          </div>

          <AttentionStrip
            tabs={tabs}
            projects={projects}
            activeTabId={activeTabId}
            showHistory={showHistory}
            onSelectTab={onSelectTab}
          />

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
                dragRef={dragRef}
                markdownEnabled={markdownEnabled}
                onSelectTab={onSelectTab}
                onCloseTab={onCloseTab}
                onReadTab={onReadTab}
                onRenameTab={onRenameTab}
                onOpenDirectory={onOpenDirectory}
                onNewClaudeTab={onNewClaudeTab}
                onNewShellTab={onNewShellTab}
                onRemoveProject={onRemoveProject}
                onReorderProject={onReorderProject}
                onReorderTab={onReorderTab}
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

          {/* Footer: history + settings, bottom-anchored */}
          <div className="flex border-t border-border shrink-0">
            <button
              data-active={showHistory}
              className={cn(
                'relative flex items-center gap-2 h-9 px-3 flex-1 text-[12px] cursor-pointer',
                'bg-transparent border-none font-inherit transition-colors duration-100',
                showHistory ? 'text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-white/4',
              )}
              onClick={onToggleHistory}
              title="Browse past sessions"
            >
              {showHistory && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-primary" />}
              <History size={14} />
              <span>History</span>
            </button>
            <button
              data-active={showFiles}
              className={cn(
                'relative flex items-center justify-center w-9 h-9 text-[12px] cursor-pointer shrink-0',
                'bg-transparent border-none border-l border-l-border font-inherit transition-colors duration-100',
                showFiles ? 'text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-white/4',
              )}
              onClick={onToggleFiles}
              title="File explorer"
            >
              {showFiles && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-primary" />}
              <FolderTree size={14} />
            </button>
            <button
              data-active={showSettings}
              className={cn(
                'relative flex items-center justify-center w-9 h-9 text-[12px] cursor-pointer shrink-0',
                'bg-transparent border-none border-l border-l-border font-inherit transition-colors duration-100',
                showSettings ? 'text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-white/4',
              )}
              onClick={onToggleSettings}
              title="Settings"
            >
              {showSettings && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-primary" />}
              <Settings size={14} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
