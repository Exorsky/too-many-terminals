import {
  Archive, Code, FolderInput, FolderOpen, Inbox, MoreHorizontal, PanelRight, Plus,
  Upload, X,
} from 'lucide-react';
import * as ipc from '@/lib/ipc';
import { cn, folderName, ICON_BUTTON } from '@/lib/utils';
import type { Tab } from '@/types';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface PaneSessionMenuProps {
  session: Tab;
  projects: string[];
  onSetProject: (projectDir: string | null) => void;
  onArchive: () => void;
  onCloseSession: () => void;
  onOpenInVscode: () => void;
  onOpenDirectory: () => void;
  onCreateTask: () => void;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
}

/** What the current session can do, docked to the trailing edge of the
 *  session tab strip: ⋯ for the infrequent actions, and the inspector toggle.
 *  Splitting has its own buttons beside these. */
export default function PaneSessionMenu({
  session, projects, onSetProject, onArchive, onCloseSession,
  onOpenInVscode, onOpenDirectory, onCreateTask, inspectorOpen, onToggleInspector,
}: PaneSessionMenuProps) {
  return (
    <>
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
