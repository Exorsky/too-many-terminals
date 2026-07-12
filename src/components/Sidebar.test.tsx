import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShellOption, Tab } from '@/types';

vi.mock('@/lib/ipc');

import * as ipc from '@/lib/ipc';
import Sidebar from './Sidebar';

const SHELLS: ShellOption[] = [
  { id: 'powershell', label: 'PowerShell', command: 'powershell.exe' },
  { id: 'cmd', label: 'Command Prompt', command: 'cmd.exe' },
];

function makeTab(id: string, overrides: Partial<Tab> = {}): Tab {
  return {
    id,
    kind: 'claude',
    name: id,
    shellId: null,
    cwd: 'C:\\Users\\x',
    resumeSessionId: null,
    exited: false,
    ...overrides,
  };
}

function renderSidebar(overrides: Partial<React.ComponentProps<typeof Sidebar>> = {}) {
  const props = {
    tabs: [makeTab('claude-1'), makeTab('shell-1', { kind: 'shell' as const, name: 'PowerShell' })],
    activeTabId: 'claude-1',
    shellOptions: SHELLS,
    showHistory: false,
    onSelectTab: vi.fn(),
    onCloseTab: vi.fn(),
    onNewClaudeTab: vi.fn(),
    onNewShellTab: vi.fn(),
    onToggleHistory: vi.fn(),
    ...overrides,
  };
  render(<Sidebar {...props} />);
  return props;
}

beforeEach(() => {
  vi.mocked(ipc.getUsageStats).mockResolvedValue({
    available: false, date: '', totalTokens: 0, byModel: {}, cacheReadTokens: 0,
  });
});
afterEach(cleanup);

describe('Sidebar', () => {
  it('renders every tab and marks exited ones', () => {
    renderSidebar({
      tabs: [makeTab('one'), makeTab('two', { exited: true })],
    });
    expect(screen.getByText('one')).toBeInTheDocument();
    expect(screen.getByText('two (exited)')).toBeInTheDocument();
  });

  it('selects a tab on click and closes via the row button', async () => {
    const props = renderSidebar();
    await userEvent.click(screen.getByText('PowerShell'));
    expect(props.onSelectTab).toHaveBeenCalledWith('shell-1');

    const closeButtons = screen.getAllByTitle('Close tab');
    await userEvent.click(closeButtons[0]);
    expect(props.onCloseTab).toHaveBeenCalledWith('claude-1');
    expect(props.onSelectTab).toHaveBeenCalledTimes(1); // close must not also select
  });

  it('offers Claude and every OS shell in the New session menu', async () => {
    const props = renderSidebar({ tabs: [] });

    await userEvent.click(screen.getByText('New session'));
    expect(await screen.findByText('Claude')).toBeInTheDocument();
    expect(screen.getByText('PowerShell')).toBeInTheDocument();
    expect(screen.getByText('Command Prompt')).toBeInTheDocument();

    await userEvent.click(screen.getByText('Command Prompt'));
    expect(props.onNewShellTab).toHaveBeenCalledWith('cmd');
  });

  it('toggles the history panel from the footer', async () => {
    const props = renderSidebar();
    await userEvent.click(screen.getByText('History'));
    expect(props.onToggleHistory).toHaveBeenCalled();
  });
});
