/**
 * To-Dos: the model, the grouping rules, and the store that persists them.
 *
 * Same shape as `settings-store.ts` — one in-memory copy, subscribers via
 * `useSyncExternalStore`, every write merged and saved — because tasks have
 * exactly the same problem settings had: several surfaces read them (the list,
 * the inspector, the session header's link count) and none of them may clobber
 * another's write. Persisted as `tasks.json` next to `workspace.json`;
 * see docs/features/todo.md.
 */
import { useSyncExternalStore } from 'react';
import * as ipc from '@/lib/ipc';
import type { Task, TaskPriority } from '@/types';

/** One day, in ms — the unit every grouping rule below is expressed in. */
const DAY_MS = 86_400_000;

export function newTask(patch: Partial<Task> = {}): Task {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: '',
    description: '',
    done: false,
    dueAt: null,
    projectDir: null,
    tags: [],
    priority: 'medium',
    inProgress: false,
    createdAt: now,
    updatedAt: now,
    sessionIds: [],
    ...patch,
  };
}

/** Anything read back from `tasks.json` is untyped — the file is opaque to the
 *  backend on purpose. This is the boundary that makes it a `Task` again, and
 *  it's total: a row missing half its fields loads with defaults rather than
 *  taking the whole view down. */
export function sanitizeTask(raw: unknown): Task | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.title !== 'string') return null;
  const priority: TaskPriority =
    r.priority === 'low' || r.priority === 'high' ? r.priority : 'medium';
  return {
    id: r.id,
    title: r.title,
    description: typeof r.description === 'string' ? r.description : '',
    done: r.done === true,
    dueAt: typeof r.dueAt === 'number' ? r.dueAt : null,
    projectDir: typeof r.projectDir === 'string' ? r.projectDir : null,
    tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === 'string') : [],
    priority,
    inProgress: r.inProgress === true,
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now(),
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : Date.now(),
    sessionIds: Array.isArray(r.sessionIds)
      ? r.sessionIds.filter((s): s is string => typeof s === 'string')
      : [],
  };
}

// --- grouping -------------------------------------------------------------

export type TaskGroup = 'overdue' | 'today' | 'upcoming' | 'later' | 'done';

/** Local midnight at the start of `now`'s day. Local, not UTC: "today" is a
 *  thing about the user's calendar, and a UTC boundary would move a 2am task
 *  into yesterday for anyone west of Greenwich. */
export function startOfDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function groupOf(task: Task, now: number): TaskGroup {
  if (task.done) return 'done';
  if (task.dueAt === null) return 'later';
  const today = startOfDay(now);
  if (task.dueAt < today) return 'overdue';
  if (task.dueAt < today + DAY_MS) return 'today';
  return 'upcoming';
}

export const GROUP_LABEL: Record<TaskGroup, string> = {
  overdue: 'Overdue',
  today: 'Today',
  upcoming: 'Upcoming',
  later: 'Later',
  done: 'Done',
};

/** The order groups appear in the list. `done` last, collapsed by the filter
 *  in the default view — a completed task is a receipt, not a plan. */
export const GROUP_ORDER: TaskGroup[] = ['overdue', 'today', 'upcoming', 'later', 'done'];

export type TaskFilter = 'all' | 'today' | 'upcoming' | 'no-project' | 'completed';

export const FILTER_LABEL: Record<TaskFilter, string> = {
  all: 'All',
  today: 'Today',
  upcoming: 'Upcoming',
  'no-project': 'No project',
  completed: 'Completed',
};

/** Which tasks a filter chip shows. `all` hides completed tasks — they're
 *  reachable by finishing nothing else and scrolling, which is as much
 *  prominence as a done task earns. */
export function matchesFilter(task: Task, filter: TaskFilter, now: number): boolean {
  switch (filter) {
    case 'all': return !task.done;
    case 'today': {
      const g = groupOf(task, now);
      return g === 'today' || g === 'overdue';
    }
    case 'upcoming': return groupOf(task, now) === 'upcoming';
    case 'no-project': return !task.done && task.projectDir === null;
    // The only filter that admits finished work. Everything else is a view of
    // what is still on the plate, which is why `groupOf` sends a done task to
    // its own group and no other filter ever looks there.
    case 'completed': return task.done;
  }
}

/** Within the `done` group: most recently finished first.
 *
 *  Ordered by `updatedAt`, which is stamped when `done` is set — so it is the
 *  completion time unless you edit a task after finishing it, which is rare
 *  enough not to justify carrying a second timestamp in the stored shape.
 *  A completed list answers "what did I get done", and that reads newest-first;
 *  due date is no longer interesting once the thing is finished. */
export function byCompletionOrder(a: Task, b: Task): number {
  return b.updatedAt - a.updatedAt;
}

/** Within a group: soonest due first, undated by creation, newest last —
 *  a to-do list reads top to bottom as "what's next". */
export function byTaskOrder(a: Task, b: Task): number {
  if (a.dueAt !== null && b.dueAt !== null) return a.dueAt - b.dueAt;
  if (a.dueAt !== null) return -1;
  if (b.dueAt !== null) return 1;
  return a.createdAt - b.createdAt;
}

/** "Today 14:00", "Tomorrow", "Fri, Sep 27", "Sep 27, 2027" — how much of the
 *  date you need, and no more. A time is shown only when one was set (a due
 *  date pinned to midnight is a day, not an appointment). */
export function formatDue(dueAt: number | null, now: number): string {
  if (dueAt === null) return 'No date';
  const today = startOfDay(now);
  const day = startOfDay(dueAt);
  const d = new Date(dueAt);
  const hasTime = dueAt !== day;
  const time = hasTime
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
    : '';
  if (day === today) return hasTime ? `Today ${time}` : 'Today';
  if (day === today + DAY_MS) return hasTime ? `Tomorrow ${time}` : 'Tomorrow';
  if (day === today - DAY_MS) return hasTime ? `Yesterday ${time}` : 'Yesterday';
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  const date = d.toLocaleDateString(undefined, {
    weekday: day > today && day < today + 7 * DAY_MS ? 'short' : undefined,
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
  });
  return hasTime ? `${date} ${time}` : date;
}

/** `<input type="datetime-local">` speaks local wall-clock strings, not epochs.
 *  These two convert at that boundary, which is the only place the app has to
 *  care about the difference. */
export function toLocalInput(dueAt: number | null): string {
  if (dueAt === null) return '';
  const d = new Date(dueAt - new Date(dueAt).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}

export function fromLocalInput(value: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

// --- store ----------------------------------------------------------------

let tasks: Task[] = [];
let loadPromise: Promise<Task[]> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function persist() {
  void ipc.saveTasks(tasks as unknown as unknown[]).catch(() => {});
}

export function getTasks(): Task[] {
  return tasks;
}

/** Loads tasks once. Repeat calls return the same promise, so several mounting
 *  components don't each hit the disk. */
export function loadTasks(): Promise<Task[]> {
  if (!loadPromise) {
    loadPromise = ipc
      .loadTasks()
      .then((raw) => {
        tasks = raw.map(sanitizeTask).filter((t): t is Task => t !== null);
        emit();
        return tasks;
      })
      .catch(() => tasks);
  }
  return loadPromise;
}

export function addTask(patch: Partial<Task>): Task {
  const task = newTask(patch);
  tasks = [...tasks, task];
  emit();
  persist();
  return task;
}

/** Merges a partial update into one task. `updatedAt` is stamped here so no
 *  caller can forget it. */
export function updateTask(id: string, patch: Partial<Task>): void {
  tasks = tasks.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t));
  emit();
  persist();
}

export function deleteTask(id: string): void {
  tasks = tasks.filter((t) => t.id !== id);
  emit();
  persist();
}

/** Links a session to a task without duplicating an existing link — "add to
 *  existing session" run twice must not produce two of the same id. */
export function linkSession(taskId: string, sessionId: string): void {
  const task = tasks.find((t) => t.id === taskId);
  if (!task || task.sessionIds.includes(sessionId)) return;
  updateTask(taskId, { sessionIds: [...task.sessionIds, sessionId] });
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTasks(): Task[] {
  return useSyncExternalStore(subscribe, getTasks, getTasks);
}

/** Test-only: reset the in-memory store between cases. */
export function resetTasksForTest(seed: Task[] = []): void {
  tasks = seed;
  loadPromise = null;
  listeners.clear();
}
