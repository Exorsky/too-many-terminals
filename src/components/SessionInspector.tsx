import { useEffect, useState } from 'react';
import { Archive, Code, FolderInput, FolderOpen, Inbox, Plus, Upload, X } from 'lucide-react';
import * as ipc from '@/lib/ipc';
import { compactAge, recencyOf, sessionState, STATE_LABEL } from '@/lib/sessions';
import { ACTION_ROW, cn, folderName, ICON_BUTTON } from '@/lib/utils';
import type { Task, Tab } from '@/types';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface SessionInspectorProps {
  session: Tab;
  projects: string[];
  /** Transcript mtime, for "last used" when the session was restored. */
  lastUsedAt?: number;
  linkedTasks: Task[];
  onClose: () => void;
  onRename: (name: string) => void;
  onSetProject: (projectDir: string | null) => void;
  onArchive: () => void;
  onCloseSession: () => void;
  onOpenInVscode: () => void;
  onOpenDirectory: () => void;
  onCreateTask: () => void;
  onOpenTask: (taskId: string) => void;
}

/** One `Label   value` line. The whole panel is these plus two button groups —
 *  no cards, no panels within panels. */
function Field({ label, children, title }: { label: string; children: React.ReactNode; title?: string }) {
  return (
    <div className="flex items-baseline gap-3 px-3 py-[5px] text-[11px]">
      <span className="w-[86px] shrink-0 text-muted-foreground">{label}</span>
      <span className="flex-1 min-w-0 break-words text-foreground/90" title={title}>{children}</span>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pt-4 pb-1 text-[9.5px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
      {children}
    </div>
  );
}

function Action({ icon: Icon, label, onClick, destructive }: {
  icon: typeof Archive;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        'flex items-center gap-2 w-full h-[26px] px-3 shrink-0 rounded-sm border-none cursor-pointer',
        'bg-transparent font-inherit text-left text-[11px]',
        destructive
          ? 'text-destructive/85 hover:text-destructive hover:bg-destructive/10'
          : 'text-muted-foreground hover:text-foreground hover:bg-hover',
      )}
      onClick={onClick}
    >
      <Icon size={12} className="shrink-0" />
      <span>{label}</span>
    </button>
  );
}

/** The session's metadata and its rarer actions, in a panel that is closed by
 *  default and costs the terminal nothing while it is.
 *
 *  Everything here is deliberately *not* in the header: the working directory,
 *  the Claude session id, when it started. You look at these occasionally and
 *  read the terminal constantly, so they trade places — progressive disclosure
 *  applied to the one surface where width is the scarce resource.
 *  See docs/features/session-workspace.md. */
export default function SessionInspector({
  session, projects, lastUsedAt, linkedTasks, onClose, onRename, onSetProject, onArchive,
  onCloseSession, onOpenInVscode, onOpenDirectory, onCreateTask, onOpenTask,
}: SessionInspectorProps) {
  const [draft, setDraft] = useState(session.name);
  const [now, setNow] = useState(() => Date.now());

  // The auto-namer can rename a session while you're looking at it.
  useEffect(() => { setDraft(session.name); }, [session.id, session.name]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== session.name) onRename(trimmed);
    else setDraft(session.name);
  };

  const created = session.createdAt ? new Date(session.createdAt).toLocaleString() : null;
  const age = compactAge(recencyOf(session, lastUsedAt), now);

  return (
    <aside
      data-session-inspector
      className="flex flex-col w-[280px] shrink-0 h-full min-h-0 bg-card border-l border-border overflow-y-auto scrollbar-thin"
    >
      <div className="flex items-center h-9 px-3 shrink-0 border-b border-border">
        <span className="flex-1 text-[10px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
          Session
        </span>
        <button
          type="button"
          aria-label="Close details"
          className={cn(ICON_BUTTON, 'w-5 h-5')}
          onClick={onClose}
        >
          <X size={12} />
        </button>
      </div>

      {/* The name is editable here rather than being a read-only field: this is
          where you come when the auto-generated title turned out wrong. */}
      <div className="px-3 pt-3 pb-1">
        <label className="block mb-1 text-[9.5px] uppercase tracking-[0.13em] text-muted-foreground" htmlFor="session-title">
          Title
        </label>
        <input
          id="session-title"
          value={draft}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') { e.preventDefault(); commit(); (e.target as HTMLInputElement).blur(); }
            else if (e.key === 'Escape') { e.preventDefault(); setDraft(session.name); (e.target as HTMLInputElement).blur(); }
          }}
          className="w-full h-[26px] px-2 rounded-sm bg-transparent border border-border focus:border-border-hover outline-none font-inherit text-[11.5px] text-foreground"
        />
      </div>

      <SectionLabel>Info</SectionLabel>
      <Field label="State">{STATE_LABEL[sessionState(session)]}</Field>
      <Field label="Project">
        {session.projectDir === null ? 'Inbox' : folderName(session.projectDir)}
      </Field>
      <Field label="Directory" title={session.cwd}>
        <span className="text-[10.5px] text-muted-foreground">{session.cwd}</span>
      </Field>
      {created && <Field label="Created">{created}</Field>}
      {age && <Field label="Last used">{age} ago</Field>}
      {session.resumeSessionId && (
        <Field label="Claude id" title={session.resumeSessionId}>
          <span className="text-[10px] text-muted-foreground">{session.resumeSessionId.slice(0, 8)}…</span>
        </Field>
      )}

      {linkedTasks.length > 0 && (
        <>
          <SectionLabel>Linked To-Dos</SectionLabel>
          {linkedTasks.map((task) => (
            <button
              key={task.id}
              type="button"
              className="flex items-center gap-2 w-full px-3 py-1 shrink-0 border-none cursor-pointer bg-transparent font-inherit text-left text-[11px] text-muted-foreground hover:text-foreground hover:bg-hover"
              onClick={() => onOpenTask(task.id)}
              title={task.title}
            >
              <span aria-hidden="true" className="shrink-0 text-faint">↗</span>
              <span className={cn('truncate', task.done && 'line-through opacity-60')}>{task.title}</span>
            </button>
          ))}
        </>
      )}

      <SectionLabel>Actions</SectionLabel>
      <div className="flex flex-col px-1 pb-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(ACTION_ROW, 'h-[26px] px-3 text-[11px]')}
            >
              <FolderInput size={12} className="shrink-0" />
              <span>Move to project…</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-44">
            {projects.map((dir) => (
              <DropdownMenuItem key={dir} onSelect={() => onSetProject(dir)} disabled={session.projectDir === dir}>
                {folderName(dir)}
              </DropdownMenuItem>
            ))}
            {projects.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem onSelect={() => onSetProject(null)} disabled={session.projectDir === null}>
              <Inbox size={13} /><span>Inbox</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Action icon={Plus} label="Create To-Do…" onClick={onCreateTask} />
        <Action icon={FolderOpen} label="Open directory" onClick={onOpenDirectory} />
        {session.kind === 'claude' && session.resumeSessionId && (
          <>
            <Action icon={Code} label="Open in VS Code" onClick={onOpenInVscode} />
            <Action
              icon={Upload}
              label="Export session…"
              onClick={() => { ipc.exportSession(session.cwd, session.resumeSessionId!).catch(() => {}); }}
            />
          </>
        )}
        <Action icon={Archive} label="Archive session" onClick={onArchive} />
        <Action icon={X} label="Close session" onClick={onCloseSession} destructive />
      </div>
    </aside>
  );
}
