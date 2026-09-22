import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ipc');

import { newTask, resetTasksForTest } from '@/lib/tasks';
import TodoView from './TodoView';

afterEach(cleanup);

function renderTodo() {
  return render(
    <TodoView
      projects={[]}
      sessions={[]}
      selectedTaskId={null}
      onSelectTask={() => {}}
      onStartSession={() => {}}
      onAddToSession={() => {}}
    />,
  );
}

/** An empty list has to say *which* emptiness it is. Reading the filter's own
 *  name back ("Nothing under Today") tells you nothing you didn't just click. */
describe('TodoView empty state', () => {
  it('answers each filter in its own words', async () => {
    resetTasksForTest([]);
    const user = userEvent.setup();
    renderTodo();

    expect(screen.getByText('Nothing to do')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Today/ }));
    expect(screen.getByText('Nothing due today')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Upcoming/ }));
    expect(screen.getByText('Nothing upcoming')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^No project/ }));
    expect(screen.getByText('No unassigned tasks')).toBeInTheDocument();
  });

  it('offers exactly one way out, and it composes a task', async () => {
    resetTasksForTest([]);
    const user = userEvent.setup();
    renderTodo();

    await user.click(screen.getByRole('button', { name: 'Create task' }));
    expect(screen.getByLabelText('New task title')).toBeInTheDocument();
    expect(screen.queryByText('Nothing to do')).not.toBeInTheDocument();
  });
});

describe('TodoView Completed filter', () => {
  it('shows finished tasks, which no other filter does', async () => {
    const now = Date.now();
    resetTasksForTest([
      { ...newTask(), title: 'Rotate the Grafana token', done: true, updatedAt: now },
      { ...newTask(), title: 'Still to do', done: false },
    ]);
    const user = userEvent.setup();
    renderTodo();

    // The open task is what All is for; the finished one is deliberately absent.
    expect(screen.getByText('Still to do')).toBeInTheDocument();
    expect(screen.queryByText('Rotate the Grafana token')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Completed/ }));

    expect(screen.getByText('Rotate the Grafana token')).toBeInTheDocument();
    expect(screen.queryByText('Still to do')).not.toBeInTheDocument();
  });

  it('lists the most recently finished first', async () => {
    const now = Date.now();
    resetTasksForTest([
      { ...newTask(), title: 'Finished earlier', done: true, updatedAt: now - 3_600_000 },
      { ...newTask(), title: 'Finished just now', done: true, updatedAt: now },
    ]);
    const user = userEvent.setup();
    renderTodo();
    await user.click(screen.getByRole('button', { name: /^Completed/ }));

    const titles = screen.getAllByText(/^Finished /).map((el) => el.textContent);
    expect(titles).toEqual(['Finished just now', 'Finished earlier']);
  });

  it('has its own empty state', async () => {
    resetTasksForTest([{ ...newTask(), title: 'Still to do' }]);
    const user = userEvent.setup();
    renderTodo();

    await user.click(screen.getByRole('button', { name: /^Completed/ }));
    expect(screen.getByText('Nothing finished yet')).toBeInTheDocument();
  });
});
