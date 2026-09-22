import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ipc', () => ({
  loadTasks: vi.fn().mockResolvedValue([]),
  saveTasks: vi.fn().mockResolvedValue(undefined),
}));

import * as ipc from '@/lib/ipc';
import {
  addTask, byTaskOrder, deleteTask, formatDue, fromLocalInput, getTasks, groupOf, linkSession,
  matchesFilter, newTask, resetTasksForTest, sanitizeTask, startOfDay, toLocalInput, updateTask,
} from './tasks';
import type { Task } from '@/types';

function task(overrides: Partial<Task> = {}): Task {
  return { ...newTask(), title: 'Something', ...overrides };
}

/** A fixed "now": 12:00 local on an arbitrary day, so every relative
 *  assertion below is about the calendar rather than the clock it ran on. */
const NOW = new Date(2026, 8, 22, 12, 0, 0).getTime();
const DAY = 86_400_000;

beforeEach(() => {
  resetTasksForTest();
  vi.clearAllMocks();
});

describe('groupOf', () => {
  it('splits by the day a task is due, not by how far off it is', () => {
    expect(groupOf(task({ dueAt: startOfDay(NOW) + 23 * 3_600_000 }), NOW)).toBe('today');
    // 1am today is still today, even though it's already gone.
    expect(groupOf(task({ dueAt: startOfDay(NOW) + 3_600_000 }), NOW)).toBe('today');
    expect(groupOf(task({ dueAt: NOW - DAY }), NOW)).toBe('overdue');
    expect(groupOf(task({ dueAt: NOW + DAY }), NOW)).toBe('upcoming');
    expect(groupOf(task({ dueAt: null }), NOW)).toBe('later');
  });

  it('puts a completed task in Done whatever its date said', () => {
    expect(groupOf(task({ dueAt: NOW - DAY, done: true }), NOW)).toBe('done');
  });
});

describe('matchesFilter', () => {
  it('All hides completed tasks', () => {
    expect(matchesFilter(task({ done: true }), 'all', NOW)).toBe(false);
    expect(matchesFilter(task({ done: false }), 'all', NOW)).toBe(true);
  });

  it('Today includes overdue — something you missed is still today’s problem', () => {
    expect(matchesFilter(task({ dueAt: NOW - DAY }), 'today', NOW)).toBe(true);
    expect(matchesFilter(task({ dueAt: NOW }), 'today', NOW)).toBe(true);
    expect(matchesFilter(task({ dueAt: NOW + DAY }), 'today', NOW)).toBe(false);
  });

  it('No project finds the unfiled ones', () => {
    expect(matchesFilter(task({ projectDir: null }), 'no-project', NOW)).toBe(true);
    expect(matchesFilter(task({ projectDir: '/proj' }), 'no-project', NOW)).toBe(false);
  });
});

describe('byTaskOrder', () => {
  it('sorts dated before undated, soonest first', () => {
    const soon = task({ id: 'soon', dueAt: NOW + 1000 });
    const later = task({ id: 'later', dueAt: NOW + DAY });
    const undated = task({ id: 'undated', dueAt: null, createdAt: 1 });
    expect([undated, later, soon].sort(byTaskOrder).map((t) => t.id))
      .toEqual(['soon', 'later', 'undated']);
  });
});

describe('formatDue', () => {
  it('names the day when it has one', () => {
    expect(formatDue(null, NOW)).toBe('No date');
    expect(formatDue(startOfDay(NOW), NOW)).toBe('Today');
    expect(formatDue(startOfDay(NOW) + DAY, NOW)).toBe('Tomorrow');
    expect(formatDue(startOfDay(NOW) - DAY, NOW)).toBe('Yesterday');
  });

  it('shows a time only when one was actually set', () => {
    // Midnight is "that day", not "that day at 00:00" — a due date pinned to
    // the start of a day is a day, not an appointment.
    expect(formatDue(startOfDay(NOW), NOW)).toBe('Today');
    expect(formatDue(startOfDay(NOW) + 14 * 3_600_000, NOW)).toBe('Today 14:00');
  });
});

describe('datetime-local conversion', () => {
  it('round-trips a local wall-clock value', () => {
    const at = new Date(2026, 8, 22, 14, 30).getTime();
    expect(fromLocalInput(toLocalInput(at))).toBe(at);
  });

  it('treats an empty field as no date', () => {
    expect(toLocalInput(null)).toBe('');
    expect(fromLocalInput('')).toBeNull();
    expect(fromLocalInput('not a date')).toBeNull();
  });
});

describe('sanitizeTask', () => {
  it('fills in every field a half-written row is missing', () => {
    const t = sanitizeTask({ id: 'x', title: 'Hi' })!;
    expect(t).toMatchObject({
      id: 'x', title: 'Hi', description: '', done: false, dueAt: null,
      projectDir: null, tags: [], priority: 'medium', inProgress: false, sessionIds: [],
    });
  });

  it('rejects anything without an id and a title', () => {
    expect(sanitizeTask(null)).toBeNull();
    expect(sanitizeTask({ title: 'no id' })).toBeNull();
    expect(sanitizeTask('a string')).toBeNull();
  });

  it('drops junk out of the list fields rather than trusting them', () => {
    const t = sanitizeTask({ id: 'x', title: 'Hi', tags: ['ok', 3, null], sessionIds: [1, 's'] })!;
    expect(t.tags).toEqual(['ok']);
    expect(t.sessionIds).toEqual(['s']);
  });

  it('falls back to medium for an unknown priority', () => {
    expect(sanitizeTask({ id: 'x', title: 'Hi', priority: 'urgent' })!.priority).toBe('medium');
  });
});

describe('the store', () => {
  it('persists on every change', () => {
    const t = addTask({ title: 'Write it down' });
    expect(ipc.saveTasks).toHaveBeenCalledTimes(1);
    expect(getTasks()).toHaveLength(1);

    updateTask(t.id, { done: true });
    expect(getTasks()[0].done).toBe(true);
    expect(ipc.saveTasks).toHaveBeenCalledTimes(2);

    deleteTask(t.id);
    expect(getTasks()).toHaveLength(0);
    expect(ipc.saveTasks).toHaveBeenCalledTimes(3);
  });

  it('stamps updatedAt so no caller has to remember to', async () => {
    const t = addTask({ title: 'x' });
    const before = getTasks()[0].updatedAt;
    await new Promise((r) => setTimeout(r, 2));
    updateTask(t.id, { title: 'y' });
    expect(getTasks()[0].updatedAt).toBeGreaterThanOrEqual(before);
  });

  it('links a session once, however many times it is asked', () => {
    const t = addTask({ title: 'x' });
    linkSession(t.id, 'sess-1');
    linkSession(t.id, 'sess-1');
    linkSession(t.id, 'sess-2');
    expect(getTasks()[0].sessionIds).toEqual(['sess-1', 'sess-2']);
  });

  it('a task needs neither a project nor a session', () => {
    const t = addTask({ title: 'Just a note' });
    expect(t.projectDir).toBeNull();
    expect(t.sessionIds).toEqual([]);
    expect(matchesFilter(t, 'all', NOW)).toBe(true);
  });
});
