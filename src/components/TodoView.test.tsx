import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ipc');

import { resetTasksForTest } from '@/lib/tasks';
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
