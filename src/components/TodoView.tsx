import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCheck, Copy, Folder, FolderInput, Inbox, MoreHorizontal, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import {
  addTask, byCompletionOrder, byTaskOrder, deleteTask, FILTER_LABEL, formatDue, GROUP_LABEL, GROUP_ORDER,
  groupOf, matchesFilter, newTask, updateTask, useTasks, type TaskFilter,
} from '@/lib/tasks';
import { cn, folderName } from '@/lib/utils';
import type { Tab, Task, TaskPriority } from '@/types';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const FILTERS: TaskFilter[] = ['all', 'today', 'upcoming', 'no-project', 'completed'];

/** An empty list should say which emptiness this is. "Nothing under Today" is
 *  the filter name read back at you; "Nothing due today" is an answer. */
const EMPTY_COPY: Record<TaskFilter, { title: string; body: string }> = {
  'all': { title: 'Nothing to do', body: 'Tasks you create will appear here.' },
  'today': { title: 'Nothing due today', body: 'Anything due before midnight shows up here.' },
  'upcoming': { title: 'Nothing upcoming', body: 'Tasks with a future date will appear here.' },
  'no-project': { title: 'No unassigned tasks', body: 'Every task currently belongs to a project.' },
  'completed': { title: 'Nothing finished yet', body: 'Tasks you tick off collect here.' },
};

/** Priority is a word, not a colored pill — three of those on every row is how
 *  a task list starts looking like a dashboard. Only `high` gets any color,
 *  because only `high` is worth interrupting a scan for. */
const PRIORITY_CLASS: Record<TaskPriority, string> = {
  high: 'text-warning',
  medium: 'text-muted-foreground',
  low: 'text-faint',
};

export interface TodoViewProps {
  projects: string[];
  /** Open sessions, for "Add to existing session…". */
  sessions: Tab[];
  selectedTaskId: string | null;
  onSelectTask: (taskId: string | null) => void;
  onStartSession: (task: Task) => void;
  onAddToSession: (task: Task, sessionId: string) => void;
}

/** One task: a checkbox, a title, a due date, a ⋯.
 *
 *  Nothing else is visible, and in particular there is no "Start session"
 *  button. A To-Do is something *you* intend to do; handing it to Claude is
 *  one of several things you might do with it, so it sits in the overflow menu
 *  with duplicate and delete. See docs/features/todo.md. */
function TaskRow({
  task, selected, projects, sessions, now,
  onSelect, onToggle, onEdit, onSetProject, onDuplicate, onDelete, onStartSession, onAddToSession,
}: {
  task: Task;
  selected: boolean;
  projects: string[];
  sessions: Tab[];
  now: number;
  onSelect: () => void;
  onToggle: () => void;
  onEdit: () => void;
  onSetProject: (projectDir: string | null) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onStartSession: () => void;
  onAddToSession: (sessionId: string) => void;
}) {
  const group = groupOf(task, now);
  const meta = [
    task.priority,
    task.projectDir ? folderName(task.projectDir) : null,
    ...task.tags,
  ].filter((m): m is string => m !== null);

  return (
    <div
      data-task-row
      data-selected={selected || undefined}
      className={cn(
        'group relative flex items-start gap-2.5 w-full px-3 py-1.5 rounded-sm cursor-pointer',
        'text-[13px] transition-colors duration-100',
        selected ? 'bg-selected' : 'hover:bg-hover',
      )}
      onClick={onSelect}
    >
      {selected && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-primary" />}
      <input
        type="checkbox"
        checked={task.done}
        aria-label={task.done ? `Mark "${task.title}" not done` : `Mark "${task.title}" done`}
        className="mt-[3px] shrink-0 w-3 h-3 accent-primary cursor-pointer"
        onClick={(e) => e.stopPropagation()}
        onChange={onToggle}
      />

      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
        <span className={cn('truncate', task.done ? 'text-muted-foreground line-through' : 'text-foreground')}>
          {task.title || 'Untitled task'}
        </span>
        {meta.length > 0 && (
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground truncate">
            <span className={PRIORITY_CLASS[task.priority]}>{task.priority}</span>
            {meta.slice(1).map((m) => (
              <span key={m} className="flex items-center gap-1.5">
                <span className="text-faint" aria-hidden="true">·</span>
                {m}
              </span>
            ))}
            {task.sessionIds.length > 0 && (
              <span className="flex items-center gap-1 ml-1 text-muted-foreground" title={`${task.sessionIds.length} linked session(s)`}>
                <span aria-hidden="true">↗</span>{task.sessionIds.length}
              </span>
            )}
          </span>
        )}
      </div>

      <span
        className={cn(
          'shrink-0 mt-[2px] text-[11px] font-mono tabular-nums',
          group === 'overdue' ? 'text-warning' : 'text-muted-foreground',
        )}
      >
        {formatDue(task.dueAt, now)}
      </span>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Actions for ${task.title || 'task'}`}
            className={cn(
              'flex items-center justify-center shrink-0 w-5 h-5 rounded-sm border-none cursor-pointer bg-transparent',
              'text-muted-foreground hover:text-foreground hover:bg-selected-hover',
              'opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100',
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal size={13} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onSelect={onEdit}><Pencil size={13} /><span>Edit</span></DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger><FolderInput size={13} /><span>Move to project…</span></DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {projects.map((dir) => (
                <DropdownMenuItem key={dir} onSelect={() => onSetProject(dir)} disabled={task.projectDir === dir}>
                  <Folder size={13} /><span>{folderName(dir)}</span>
                </DropdownMenuItem>
              ))}
              {projects.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem onSelect={() => onSetProject(null)} disabled={task.projectDir === null}>
                <Inbox size={13} /><span>No project</span>
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onStartSession}>
            <Sparkles size={13} /><span>Start Claude session</span>
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger><Plus size={13} /><span>Add to existing session…</span></DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-72 overflow-y-auto scrollbar-thin">
              {sessions.length === 0 ? (
                <DropdownMenuItem disabled>No open sessions</DropdownMenuItem>
              ) : (
                sessions.map((s) => (
                  <DropdownMenuItem key={s.id} onSelect={() => onAddToSession(s.id)}>
                    <span className="truncate">{s.name}</span>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onDuplicate}><Copy size={13} /><span>Duplicate</span></DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <Trash2 size={13} /><span>Delete</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** To-Do: the second of the app's two modes.
 *
 *  A plain developer to-do list that happens to know about Claude, not a queue
 *  of work for Claude. That ordering is the whole design: tasks group by when
 *  they're due, sessions are something you start from one on purpose. */
export default function TodoView({
  projects, sessions, selectedTaskId, onSelectTask, onStartSession, onAddToSession,
}: TodoViewProps) {
  const tasks = useTasks();
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');
  const composeRef = useRef<HTMLInputElement>(null);

  // Due dates cross midnight and "Today" has to notice.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => { if (composing) composeRef.current?.focus(); }, [composing]);

  const grouped = useMemo(() => {
    const visible = tasks.filter((t) => matchesFilter(t, filter, now));
    return GROUP_ORDER
      .map((group) => ({
        group,
        // Finished work sorts by when it was finished; everything else by
        // what's next. Per group rather than per filter, so a `done` section
        // reads the same wherever it turns up.
        items: visible
          .filter((t) => groupOf(t, now) === group)
          .sort(group === 'done' ? byCompletionOrder : byTaskOrder),
      }))
      .filter((g) => g.items.length > 0);
  }, [tasks, filter, now]);

  const counts = useMemo(
    () => Object.fromEntries(
      FILTERS.map((f) => [f, tasks.filter((t) => matchesFilter(t, f, now)).length]),
    ) as Record<TaskFilter, number>,
    [tasks, now],
  );

  const commitDraft = (keepOpen: boolean) => {
    const title = draft.trim();
    if (title) {
      // A task typed under a filter inherits what that filter means: "Today"
      // gives it today's date, "No project" leaves it unfiled. Typing a title
      // and getting it in the group you were looking at is the whole point.
      const created = addTask({
        title,
        dueAt: filter === 'today' ? new Date(new Date(now).setHours(23, 59, 0, 0)).getTime() : null,
      });
      onSelectTask(created.id);
    }
    setDraft('');
    if (!keepOpen) setComposing(false);
  };

  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0 bg-background">
      <header className="flex items-center gap-3 shrink-0 px-5 pt-4 pb-2">
        <h1 className="m-0 text-[16px] font-semibold tracking-[-0.01em]">To-Do</h1>
        <span className="text-[11px] text-muted-foreground">
          {counts.all} open
        </span>
        <button
          type="button"
          className="flex items-center gap-1.5 ml-auto h-[26px] px-2.5 shrink-0 rounded-sm cursor-pointer border border-border bg-transparent font-inherit text-[11.5px] text-foreground hover:border-border-hover hover:bg-hover"
          onClick={() => setComposing(true)}
        >
          <Plus size={12} className="text-primary" />
          New task
        </button>
      </header>

      <div className="flex items-center gap-1 shrink-0 px-5 pb-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            className={cn(
              'flex items-center gap-1.5 h-[22px] px-2 rounded-sm border-none cursor-pointer font-inherit text-[11px]',
              filter === f
                ? 'bg-selected text-foreground'
                : 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-hover',
            )}
            onClick={() => setFilter(f)}
          >
            {FILTER_LABEL[f]}
            {counts[f] > 0 && (
              <span className="text-[9.5px] font-mono tabular-nums text-muted-foreground">{counts[f]}</span>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-2 pb-6">
        {composing && (
          <div className="flex items-center gap-2.5 px-3 py-1.5 mx-1 rounded-sm border border-border-hover">
            <span className="w-3 h-3 shrink-0 rounded-[2px] border border-border-hover" aria-hidden="true" />
            <input
              ref={composeRef}
              value={draft}
              placeholder="What needs doing?"
              aria-label="New task title"
              spellCheck={false}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                // Enter keeps the field open — capturing three things in a row
                // is the normal case, and reopening the composer each time is
                // three extra clicks for no reason.
                if (e.key === 'Enter') { e.preventDefault(); commitDraft(true); }
                else if (e.key === 'Escape') { e.preventDefault(); setDraft(''); setComposing(false); }
              }}
              onBlur={() => commitDraft(false)}
              className="flex-1 min-w-0 bg-transparent border-none outline-none font-inherit text-[12px] text-foreground placeholder:text-muted-foreground"
            />
            <span className="shrink-0 text-[9.5px] text-faint">↵ to add · esc to close</span>
          </div>
        )}

        {grouped.length === 0 && !composing ? (
          <div className="flex flex-col items-center justify-center gap-1 h-full min-h-0 px-4 pb-10 text-center">
            <CheckCheck size={18} className="mb-1.5 text-muted-foreground" aria-hidden="true" />
            <p className="m-0 text-[12.5px] text-dim">{EMPTY_COPY[filter].title}</p>
            <p className="m-0 max-w-64 text-[11px] leading-relaxed text-muted-foreground">
              {EMPTY_COPY[filter].body}
            </p>
            <button
              type="button"
              className="flex items-center gap-1.5 mt-3 h-[26px] px-2.5 rounded-sm border border-border bg-transparent cursor-pointer font-inherit text-[11.5px] text-foreground hover:border-border-hover hover:bg-hover"
              onClick={() => setComposing(true)}
            >
              <Plus size={12} className="text-primary" />
              Create task
            </button>
          </div>
        ) : (
          grouped.map(({ group, items }) => (
            <section key={group}>
              <div className="flex items-baseline gap-2 px-3 pt-4 pb-1">
                <h2 className="m-0 text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
                  {GROUP_LABEL[group]}
                </h2>
                <span className="text-[9.5px] font-mono tabular-nums text-faint">{items.length}</span>
              </div>
              {items.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  selected={task.id === selectedTaskId}
                  projects={projects}
                  sessions={sessions}
                  now={now}
                  onSelect={() => onSelectTask(task.id === selectedTaskId ? null : task.id)}
                  onToggle={() => updateTask(task.id, { done: !task.done, inProgress: false })}
                  onEdit={() => onSelectTask(task.id)}
                  onSetProject={(projectDir) => updateTask(task.id, { projectDir })}
                  onDuplicate={() => {
                    const { id: _id, createdAt: _c, updatedAt: _u, sessionIds: _s, ...rest } = task;
                    addTask({ ...newTask(), ...rest, done: false, inProgress: false });
                  }}
                  onDelete={() => {
                    deleteTask(task.id);
                    if (task.id === selectedTaskId) onSelectTask(null);
                  }}
                  onStartSession={() => onStartSession(task)}
                  onAddToSession={(sessionId) => onAddToSession(task, sessionId)}
                />
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  );
}
