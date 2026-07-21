import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Tab } from '@/types';
import SessionBar from './SessionBar';

function makeTab(overrides: Partial<Tab> = {}): Tab {
  return {
    id: 't1', kind: 'claude', name: 'Hello 123', shellId: null,
    cwd: 'C:\\Users\\x\\blablatest123', resumeSessionId: 'sess-abc',
    exited: false, status: 'idle', ...overrides,
  };
}

function renderBar(overrides: Partial<React.ComponentProps<typeof SessionBar>> = {}) {
  const props = {
    tab: makeTab(),
    canRead: true,
    mode: 'terminal' as const,
    view: 'rendered' as const,
    turnsCount: null,
    markdownText: '',
    onSetMode: vi.fn(),
    onSetView: vi.fn(),
    onRefresh: vi.fn(),
    ...overrides,
  };
  render(<SessionBar {...props} />);
  return props;
}

afterEach(cleanup);

describe('SessionBar', () => {
  it('names the session and its folder', () => {
    renderBar();
    expect(screen.getByText('Hello 123')).toBeInTheDocument();
    expect(screen.getByText('blablatest123')).toBeInTheDocument();
  });

  it('flips to markdown from the toggle, with no reader controls in terminal mode', async () => {
    const props = renderBar();
    expect(screen.queryByText('Rendered')).not.toBeInTheDocument();
    expect(screen.queryByText('Copy all')).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('Markdown'));
    expect(props.onSetMode).toHaveBeenCalledWith('markdown');
  });

  it('flips to split from the toggle', async () => {
    const props = renderBar();
    await userEvent.click(screen.getByText('Split'));
    expect(props.onSetMode).toHaveBeenCalledWith('split');
  });

  it('shows Rendered/Raw, copy, and refresh while reading', async () => {
    const props = renderBar({ mode: 'markdown', turnsCount: 4, markdownText: '## You' });
    expect(screen.getByText('4 turns')).toBeInTheDocument();

    await userEvent.click(screen.getByText('Raw'));
    expect(props.onSetView).toHaveBeenCalledWith('raw');

    await userEvent.click(screen.getByTitle('Re-read (a live session keeps growing)'));
    expect(props.onRefresh).toHaveBeenCalled();
  });

  it('shows the markdown controls in split mode too (pane is on screen)', () => {
    renderBar({ mode: 'split', turnsCount: 7, markdownText: '## You' });
    expect(screen.getByText('7 turns')).toBeInTheDocument();
    expect(screen.getByText('Rendered')).toBeInTheDocument();
    expect(screen.getByText('Copy all')).toBeInTheDocument();
  });

  it('hides the Terminal/Markdown toggle when reading is unavailable', () => {
    renderBar({ canRead: false });
    expect(screen.queryByText('Markdown')).not.toBeInTheDocument();
    expect(screen.getByText('Hello 123')).toBeInTheDocument(); // bar still shows identity
  });
});
