import {
  Archive, Code, Columns2, FolderInput, FolderOpen, Inbox, MoreHorizontal, PanelRight, Plus,
  Upload, X,
} from 'lucide-react';
import * as ipc from '@/lib/ipc';
import { cn, folderName, ICON_BUTTON } from '@/lib/utils';
import type { SessionTool, Tab } from '@/types';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const TOOL_LABEL: Record<SessionTool, string> = {
  claude: 'Claude',
  shell: 'Shell',
  files: 'Files',
};

export interface PaneSessionMenuProps {
  session: Tab;
  projects: string[];
  /** Open another of this session's tools as a tab. */
  onAddTool: (tool: SessionTool) => void;
  onSetProject: (projectDir: string | null) => void;
  onArchive: () => void;
  onCloseSession: () => void;
  onOpenInVscode: () => void;
  onOpenDirectory: () => void;
  onCreateTask: () => void;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
}

/** What the active tab's session can do, docked to the trailing edge of its
 *  pane's tab strip.
 *
 *  Two visible buttons and a menu. The `+` is visible because adding a shell
 *  beside Claude is the grid's whole reason to exist and was unfindable while
 *  it lived inside ⋯; everything infrequent stays in ⋯ or the inspector.
 *  See docs/features/panes.md. */
export default function PaneSessionMenu({
  session, projects, onAddTool, onSetProject, onArchive, onCloseSession,
  onOpenInVscode, onOpenDirectory, onCreateTask, inspectorOpen, onToggleInspector,
}: PaneSessionMenuProps) {
  const tools: SessionTool[] = session.kind === 'claude'
    ? ['claude', 'shell', 'files']
    : ['shell', 'files'];

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Add a tool to the workspace"
            title="Open another of this session's tools as a tab"
            className={cn(ICON_BUTTON, 'w-6 h-6')}
          >
            <Plus size={14} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40">
          {tools.map((t) => (
            <DropdownMenuItem key={t} onSelect={() => onAddTool(t)}>
              <Columns2 size={13} /><span>{TOOL_LABEL[t]}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Session actions"
            className={cn(ICON_BUTTON, 'w-6 h-6')}
          >
            <MoreHorizontal size={14} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger><FolderInput size={13} /><span>Move to project…</span></DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {projects.map((dir) => (
                <DropdownMenuItem key={dir} onSelect={() => onSetProject(dir)} disabled={session.projectDir === dir}>
                  {folderName(dir)}
                </DropdownMenuItem>
              ))}
              {projects.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem onSelect={() => onSetProject(null)} disabled={session.projectDir === null}>
                <Inbox size={13} /><span>Inbox</span>
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem onSelect={onCreateTask}><Plus size={13} /><span>Create To-Do…</span></DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onOpenDirectory}><FolderOpen size={13} /><span>Open directory</span></DropdownMenuItem>
          {session.kind === 'claude' && session.resumeSessionId && (
            <>
              <DropdownMenuItem onSelect={onOpenInVscode}><Code size={13} /><span>Open in VS Code</span></DropdownMenuItem>
              <DropdownMenuItem onSelect={() => { ipc.exportSession(session.cwd, session.resumeSessionId!).catch(() => {}); }}>
                <Upload size={13} /><span>Export session…</span>
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onArchive}><Archive size={13} /><span>Archive session</span></DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={onCloseSession}>
            <X size={13} /><span>Close session</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <button
        type="button"
        aria-label="Session details"
        aria-pressed={inspectorOpen}
        title="Session details  ⌘I"
        className={cn(
          'flex items-center justify-center w-6 h-6 shrink-0 rounded-sm border-none cursor-pointer',
          inspectorOpen ? 'bg-selected text-foreground' : 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-raised',
        )}
        onClick={onToggleInspector}
      >
        <PanelRight size={14} />
      </button>
    </>
  );
}
