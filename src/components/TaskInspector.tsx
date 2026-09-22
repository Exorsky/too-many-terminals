import { useEffect, useState } from 'react';
import { Sparkles, Trash2, X } from 'lucide-react';
import { deleteTask, fromLocalInput, toLocalInput, updateTask } from '@/lib/tasks';
import { ACTION_ROW, ACTION_ROW_DANGER, cn, folderName, ICON_BUTTON } from '@/lib/utils';
import type { Tab, Task, TaskPriority } from '@/types';

const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high'];

export interface TaskInspectorProps {
  task: Task;
  projects: string[];
  /** Open sessions, to resolve `task.sessionIds` into names. */
  sessions: Tab[];
  onClose: () => void;
  onOpenSession: (sessionId: string) => void;
  onStartSession: () => void;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pt-4 pb-1 text-[9.5px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-3 py-[3px] text-[11px]">
      <span className="w-[62px] shrink-0 text-muted-foreground">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

const control = 'w-full h-[24px] px-1.5 rounded-sm bg-transparent border border-border hover:border-border-hover focus:border-border-hover outline-none font-inherit text-[11px] text-foreground';

/** A task's details, in the same language as the session inspector: a panel
 *  on the right that is closed until you ask for it, fields as plain rows, and
 *  every edit committed as you make it — there is no Save button because there
 *  is nothing here you'd want to abandon halfway. */
export default function TaskInspector({
  task, projects, sessions, onClose, onOpenSession, onStartSession,
}: TaskInspectorProps) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [tags, setTags] = useState(task.tags.join(', '));

  // Switching to another task swaps the whole panel's contents.
  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description);
    setTags(task.tags.join(', '));
  }, [task.id]);

  const linked = task.sessionIds
    .map((id) => sessions.find((s) => s.id === id))
    .filter((s): s is Tab => s !== undefined);

  return (
    <aside
      data-task-inspector
      className="flex flex-col w-[300px] shrink-0 h-full min-h-0 bg-card border-l border-border overflow-y-auto scrollbar-thin"
    >
      <div className="flex items-center gap-2 h-9 px-3 shrink-0 border-b border-border">
        <input
          type="checkbox"
          checked={task.done}
          aria-label={task.done ? 'Mark not done' : 'Mark done'}
          className="shrink-0 w-3 h-3 accent-primary cursor-pointer"
          onChange={() => updateTask(task.id, { done: !task.done, inProgress: false })}
        />
        <span className="flex-1 text-[10px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
          Task
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

      <div className="px-3 pt-3">
        <input
          value={title}
          aria-label="Task title"
          spellCheck={false}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => updateTask(task.id, { title: title.trim() || task.title })}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          className={cn(
            'w-full px-0 py-0 bg-transparent border-none outline-none font-inherit text-[13px]',
            task.done ? 'text-muted-foreground line-through' : 'text-foreground',
          )}
        />
      </div>

      <SectionLabel>Description</SectionLabel>
      <div className="px-3">
        <textarea
          value={description}
          aria-label="Task description"
          rows={5}
          placeholder="What is this about?"
          spellCheck={false}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => updateTask(task.id, { description })}
          onKeyDown={(e) => e.stopPropagation()}
          className="w-full px-2 py-1.5 rounded-sm bg-transparent border border-border hover:border-border-hover focus:border-border-hover outline-none resize-y font-inherit text-[11px] leading-relaxed text-foreground placeholder:text-muted-foreground"
        />
      </div>

      <SectionLabel>Details</SectionLabel>
      <Row label="Due">
        {/* The platform's own picker. A date field is exactly the thing a
            browser already does well, and a library for it would be 40kB to
            reproduce what `type="datetime-local"` gives for free. */}
        <input
          type="datetime-local"
          value={toLocalInput(task.dueAt)}
          aria-label="Due date"
          onChange={(e) => updateTask(task.id, { dueAt: fromLocalInput(e.target.value) })}
          onKeyDown={(e) => e.stopPropagation()}
          className={control}
        />
      </Row>
      <Row label="Project">
        <select
          value={task.projectDir ?? ''}
          aria-label="Project"
          onChange={(e) => updateTask(task.id, { projectDir: e.target.value || null })}
          className={control}
        >
          <option value="">No project</option>
          {projects.map((dir) => (
            <option key={dir} value={dir}>{folderName(dir)}</option>
          ))}
        </select>
      </Row>
      <Row label="Priority">
        <select
          value={task.priority}
          aria-label="Priority"
          onChange={(e) => updateTask(task.id, { priority: e.target.value as TaskPriority })}
          className={control}
        >
          {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </Row>
      <Row label="Tags">
        <input
          value={tags}
          aria-label="Tags"
          placeholder="api, rate-limiting"
          spellCheck={false}
          onChange={(e) => setTags(e.target.value)}
          onBlur={() => updateTask(task.id, {
            tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
          })}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          className={control}
        />
      </Row>
      <Row label="Status">
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={task.inProgress}
            className="w-3 h-3 accent-primary cursor-pointer"
            onChange={() => updateTask(task.id, { inProgress: !task.inProgress })}
          />
          In progress
        </label>
      </Row>

      <SectionLabel>Sessions</SectionLabel>
      <div className="flex flex-col px-1">
        {linked.length === 0 ? (
          <p className="px-2 py-0.5 m-0 text-[10.5px] text-muted-foreground">
            None linked. Starting one is optional — this stays a To-Do either way.
          </p>
        ) : (
          linked.map((s) => (
            <button
              key={s.id}
              type="button"
              className={cn(ACTION_ROW, 'h-[24px] px-2 text-[11px]')}
              onClick={() => onOpenSession(s.id)}
              title={s.cwd}
            >
              <span aria-hidden="true" className="shrink-0 text-faint">↗</span>
              <span className="truncate">{s.name}</span>
            </button>
          ))
        )}
        <button
          type="button"
          className={cn(ACTION_ROW, 'h-[24px] px-2 mt-0.5 text-[11px]')}
          onClick={onStartSession}
        >
          <Sparkles size={12} className="shrink-0" />
          Start Claude session
        </button>
      </div>

      <div className="mt-auto px-1 pt-4 pb-3">
        <button
          type="button"
          className={cn(ACTION_ROW_DANGER, 'h-[26px] px-2 text-[11px]')}
          onClick={() => { deleteTask(task.id); onClose(); }}
        >
          <Trash2 size={12} className="shrink-0" />
          Delete task
        </button>
      </div>
    </aside>
  );
}
