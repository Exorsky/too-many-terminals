import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

const PROJECT = 'C:\\Users\\x\\project';

function makeTab(id: string, overrides: Partial<Tab> = {}): Tab {
  return {
    id,
    kind: 'claude',
    name: id,
    shellId: null,
    cwd: PROJECT,
    resumeSessionId: null,
    exited: false,
    status: 'new',
    ...overrides,
  };
}

function renderSidebar(overrides: Partial<React.ComponentProps<typeof Sidebar>> = {}) {
  const props = {
    tabs: [makeTab('claude-1'), makeTab('shell-1', { kind: 'shell' as const, name: 'PowerShell' })],
    activeTabId: 'claude-1',
    shellOptions: SHELLS,
    showHistory: false,
    showSettings: false,
    projects: [PROJECT],
    collapsed: false,
    onSelectTab: vi.fn(),
    onCloseTab: vi.fn(),
    onNewClaudeTab: vi.fn(),
    onNewShellTab: vi.fn(),
    onRenameTab: vi.fn(),
    onToggleHistory: vi.fn(),
    onToggleSettings: vi.fn(),
    onAddProject: vi.fn(),
    onRemoveProject: vi.fn(),
    onReorderProject: vi.fn(),
    onReorderTab: vi.fn(),
    onToggleCollapse: vi.fn(),
    ...overrides,
  };
  const { container } = render(<Sidebar {...props} />);
  return { ...props, container };
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

  it('offers Claude and every OS shell in the New session menu, scoped to the project', async () => {
    const props = renderSidebar({ tabs: [] });

    await userEvent.click(screen.getByText('New session'));
    expect(await screen.findByText('Claude')).toBeInTheDocument();
    expect(screen.getByText('PowerShell')).toBeInTheDocument();
    expect(screen.getByText('Command Prompt')).toBeInTheDocument();

    await userEvent.click(screen.getByText('Command Prompt'));
    expect(props.onNewShellTab).toHaveBeenCalledWith(PROJECT, 'cmd');
  });

  it('toggles the history panel from the footer', async () => {
    const props = renderSidebar();
    await userEvent.click(screen.getByText('History'));
    expect(props.onToggleHistory).toHaveBeenCalled();
  });

  it('toggles settings from the footer', async () => {
    const props = renderSidebar();
    await userEvent.click(screen.getByTitle('Settings'));
    expect(props.onToggleSettings).toHaveBeenCalled();
  });

  it('shows each folder as its own card and collapses its tab list on click', async () => {
    renderSidebar();
    // The card header's folder-name span, not a TabRow (which also has
    // title=tab.cwd and would collide with a getByTitle query here).
    const header = screen.getByText('project');

    // Tabs are visible while the card is expanded (default).
    expect(screen.getByText('claude-1')).toBeInTheDocument();

    // Clicking the header toggles the accordion, not the folder dialog.
    await userEvent.click(header);
    expect(screen.queryByText('claude-1')).not.toBeInTheDocument();

    await userEvent.click(header);
    expect(screen.getByText('claude-1')).toBeInTheDocument();
  });

  it('renames a tab via double-click, committing on Enter', async () => {
    const props = renderSidebar();
    await userEvent.dblClick(screen.getByText('claude-1'));

    const input = screen.getByDisplayValue('claude-1');
    await userEvent.clear(input);
    await userEvent.type(input, 'My session{Enter}');

    expect(props.onRenameTab).toHaveBeenCalledWith('claude-1', 'My session');
  });

  it('cancels a rename on Escape without committing', async () => {
    const props = renderSidebar();
    await userEvent.dblClick(screen.getByText('claude-1'));

    const input = screen.getByDisplayValue('claude-1');
    await userEvent.type(input, ' renamed{Escape}');

    expect(props.onRenameTab).not.toHaveBeenCalled();
    expect(screen.getByText('claude-1')).toBeInTheDocument();
  });

  it('discards a rename that trims to empty', async () => {
    const props = renderSidebar();
    await userEvent.dblClick(screen.getByText('claude-1'));

    const input = screen.getByDisplayValue('claude-1');
    await userEvent.clear(input);
    await userEvent.type(input, '   {Enter}');

    expect(props.onRenameTab).not.toHaveBeenCalled();
  });

  it('renders a card per open folder, each scoped to its own tabs', () => {
    const other = 'C:\\Users\\x\\other';
    renderSidebar({
      projects: [PROJECT, other],
      tabs: [makeTab('a', { cwd: PROJECT }), makeTab('b', { cwd: other })],
    });
    expect(screen.getByText('project')).toBeInTheDocument();
    expect(screen.getByText('other')).toBeInTheDocument();
    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.getByText('b')).toBeInTheDocument();
  });

  it('removes a folder via its card button without touching the dialog', async () => {
    const props = renderSidebar();
    await userEvent.click(screen.getByTitle('Remove folder'));
    expect(props.onRemoveProject).toHaveBeenCalledWith(PROJECT);
    expect(props.onAddProject).not.toHaveBeenCalled();
  });

  it('offers to add another folder alongside existing ones', async () => {
    const props = renderSidebar();
    await userEvent.click(screen.getByText('Add folder…'));
    expect(props.onAddProject).toHaveBeenCalled();
  });

  it('prompts to select a folder when none is open', async () => {
    const props = renderSidebar({ projects: [], tabs: [] });
    expect(screen.getByText('No folders open')).toBeInTheDocument();
    expect(screen.queryByText('New session')).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('Select folder…'));
    expect(props.onAddProject).toHaveBeenCalled();
  });

  it('collapses to an icon rail and back', async () => {
    const props = renderSidebar({ collapsed: true });
    expect(screen.queryByText('New session')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTitle('Show sidebar'));
    expect(props.onToggleCollapse).toHaveBeenCalled();
  });

  it('shows a spinning indicator while a claude tab is working', () => {
    const { container } = renderSidebar({ tabs: [makeTab('claude-1', { status: 'working' })] });
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('shows a pulsing indicator when a claude tab requires a response', () => {
    const { container } = renderSidebar({ tabs: [makeTab('claude-1', { status: 'requires_response' })] });
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    expect(container.querySelector('.animate-spin')).not.toBeInTheDocument();
  });

  it('does not render a status indicator for shell tabs', () => {
    const { container } = renderSidebar({
      tabs: [makeTab('shell-1', { kind: 'shell', status: 'working' })],
    });
    expect(container.querySelector('.animate-spin')).not.toBeInTheDocument();
  });

  // A fresh mock DataTransfer per drag — the handlers set effectAllowed/dropEffect
  // and call setData, which jsdom's synthetic events don't provide on their own.
  const dt = () => ({ setData: vi.fn(), getData: vi.fn(), effectAllowed: '', dropEffect: '' });

  it('reorders sessions within a folder by dragging one onto another', () => {
    const props = renderSidebar({
      tabs: [makeTab('a'), makeTab('b'), makeTab('c')],
    });
    const dataTransfer = dt();
    fireEvent.dragStart(screen.getByText('a'), { dataTransfer });
    fireEvent.drop(screen.getByText('c'), { dataTransfer });
    expect(props.onReorderTab).toHaveBeenCalledWith('a', 'c', expect.stringMatching(/^(before|after)$/));
  });

  it('does not reorder a session onto one in a different folder', () => {
    const other = 'C:\\Users\\x\\other';
    const props = renderSidebar({
      projects: [PROJECT, other],
      tabs: [makeTab('a', { cwd: PROJECT }), makeTab('b', { cwd: other })],
    });
    const dataTransfer = dt();
    fireEvent.dragStart(screen.getByText('a'), { dataTransfer });
    fireEvent.drop(screen.getByText('b'), { dataTransfer });
    expect(props.onReorderTab).not.toHaveBeenCalled();
  });

  it('reorders folders by dragging one card onto another', () => {
    const other = 'C:\\Users\\x\\other';
    const props = renderSidebar({
      projects: [PROJECT, other],
      tabs: [],
    });
    const dataTransfer = dt();
    fireEvent.dragStart(screen.getByText('project'), { dataTransfer });
    fireEvent.drop(screen.getByText('other'), { dataTransfer });
    expect(props.onReorderProject).toHaveBeenCalledWith(PROJECT, other, expect.stringMatching(/^(before|after)$/));
  });
});
