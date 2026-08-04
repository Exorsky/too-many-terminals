import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    showHome: false,
    showFiles: false,
    projects: [PROJECT],
    collapsed: false,
    onSelectTab: vi.fn(),
    onCloseTab: vi.fn(),
    onOpenDirectory: vi.fn(),
    onNewClaudeTab: vi.fn(),
    onNewShellTab: vi.fn(),
    onRenameTab: vi.fn(),
    onTogglePin: vi.fn(),
    onOpenSearch: vi.fn(),
    onToggleHistory: vi.fn(),
    onToggleSettings: vi.fn(),
    onToggleFiles: vi.fn(),
    onGoHome: vi.fn(),
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
  vi.mocked(ipc.getSessionUsageStats).mockResolvedValue({
    available: false, session: null, week: null, fetchedAtMs: null, fromCache: false,
  });
  // Most folders contribute no credentials; the tests that care override this.
  vi.mocked(ipc.envNames).mockResolvedValue({
    vars: [], refused: [], unreadable: false, folderScoped: false,
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

  it('excludes file tabs — they live in the top TabBar, not the session list', () => {
    renderSidebar({
      tabs: [makeTab('one'), makeTab('README.md', { kind: 'file', path: `${PROJECT}\\README.md` })],
    });
    expect(screen.getByText('one')).toBeInTheDocument();
    expect(screen.queryByText('README.md')).not.toBeInTheDocument();
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

  it('right-click menu renames, opens the directory, and closes the tab', async () => {
    const props = renderSidebar();

    fireEvent.contextMenu(screen.getByText('claude-1'));
    await userEvent.click(await screen.findByText('Open directory'));
    expect(props.onOpenDirectory).toHaveBeenCalledWith(PROJECT);

    fireEvent.contextMenu(screen.getByText('claude-1'));
    await userEvent.click(await screen.findByText('Close'));
    expect(props.onCloseTab).toHaveBeenCalledWith('claude-1');

    fireEvent.contextMenu(screen.getByText('claude-1'));
    await userEvent.click(await screen.findByText('Rename'));
    // Rename swaps the row for an editable input seeded with the current name.
    expect(screen.getByDisplayValue('claude-1')).toBeInTheDocument();
  });

  it('right-click menu pins and unpins a session', async () => {
    const props = renderSidebar();

    fireEvent.contextMenu(screen.getByText('claude-1'));
    await userEvent.click(await screen.findByText('Pin session'));
    expect(props.onTogglePin).toHaveBeenCalledWith('claude-1');
  });

  it('right-click menu offers Unpin once a session is pinned', async () => {
    renderSidebar({ tabs: [makeTab('claude-1', { pinned: true })] });
    // Pinned, so it renders twice — once in the Pinned strip, once in its folder.
    fireEvent.contextMenu(screen.getAllByText('claude-1')[0]);
    expect(await screen.findByText('Unpin')).toBeInTheDocument();
    expect(screen.queryByText('Pin session')).not.toBeInTheDocument();
  });

  it('opens the command palette from the search row', async () => {
    const props = renderSidebar();
    await userEvent.click(screen.getByText('Search sessions'));
    expect(props.onOpenSearch).toHaveBeenCalled();
  });

  describe('Pinned strip', () => {
    it('is absent when nothing is pinned', () => {
      renderSidebar({ tabs: [makeTab('a'), makeTab('b')] });
      expect(screen.queryByText('Pinned')).not.toBeInTheDocument();
    });

    it('lists every pinned session, with a count, across folders', () => {
      const OTHER = 'C:\\Users\\x\\other';
      renderSidebar({
        projects: [PROJECT, OTHER],
        tabs: [
          makeTab('pinned-here', { pinned: true }),
          makeTab('pinned-there', { pinned: true, cwd: OTHER }),
          makeTab('not-pinned'),
        ],
      });
      const strip = screen.getByText('Pinned').parentElement!.parentElement!;
      expect(within(strip).getByText('pinned-here')).toBeInTheDocument();
      expect(within(strip).getByText('pinned-there')).toBeInTheDocument();
      expect(within(strip).queryByText('not-pinned')).not.toBeInTheDocument();
      expect(within(strip).getByText('2')).toBeInTheDocument();
    });

    it('excludes an exited pinned session', () => {
      renderSidebar({ tabs: [makeTab('pinned', { pinned: true }), makeTab('gone', { pinned: true, exited: true })] });
      const strip = screen.getByText('Pinned').parentElement!.parentElement!;
      expect(within(strip).getByText('pinned')).toBeInTheDocument();
      expect(within(strip).queryByText('gone')).not.toBeInTheDocument();
    });

    it('unpins from the strip via its own context menu', async () => {
      const props = renderSidebar({ tabs: [makeTab('pinned', { pinned: true })] });
      const strip = screen.getByText('Pinned').parentElement!.parentElement!;
      fireEvent.contextMenu(within(strip).getByText('pinned'));
      await userEvent.click(await screen.findByText('Unpin'));
      expect(props.onTogglePin).toHaveBeenCalledWith('pinned');
    });
  });

  describe('“Waiting on you” strip', () => {
    it('is absent when no session needs input', () => {
      renderSidebar({ tabs: [makeTab('a', { status: 'working' }), makeTab('b', { status: 'idle' })] });
      expect(screen.queryByText('Waiting on you')).not.toBeInTheDocument();
    });

    it('lists every session that needs input, with a count, across folders', () => {
      const OTHER = 'C:\\Users\\x\\other';
      renderSidebar({
        projects: [PROJECT, OTHER],
        tabs: [
          makeTab('needs-here', { status: 'requires_response' }),
          makeTab('needs-there', { status: 'requires_response', cwd: OTHER }),
          makeTab('busy', { status: 'working' }),
        ],
      });
      const strip = screen.getByText('Waiting on you').parentElement!.parentElement!;
      expect(within(strip).getByText('needs-here')).toBeInTheDocument();
      expect(within(strip).getByText('needs-there')).toBeInTheDocument();
      expect(within(strip).queryByText('busy')).not.toBeInTheDocument();
      expect(within(strip).getByText('2')).toBeInTheDocument();
    });

    it('excludes shells and exited sessions', () => {
      renderSidebar({
        tabs: [
          makeTab('claude-waiting', { status: 'requires_response' }),
          makeTab('shell-waiting', { kind: 'shell', status: 'requires_response' }),
          makeTab('dead', { status: 'requires_response', exited: true }),
        ],
      });
      const strip = screen.getByText('Waiting on you').parentElement!.parentElement!;
      expect(within(strip).getByText('claude-waiting')).toBeInTheDocument();
      expect(within(strip).queryByText('shell-waiting')).not.toBeInTheDocument();
      expect(within(strip).queryByText('dead')).not.toBeInTheDocument();
      expect(within(strip).getByText('1')).toBeInTheDocument();
    });

    it('selects a waiting session when its strip row is clicked', async () => {
      const props = renderSidebar({ tabs: [makeTab('needs-me', { status: 'requires_response' })] });
      const strip = screen.getByText('Waiting on you').parentElement!.parentElement!;
      await userEvent.click(within(strip).getByText('needs-me'));
      expect(props.onSelectTab).toHaveBeenCalledWith('needs-me');
    });
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

  it('toggles the history panel from the footer menu', async () => {
    const props = renderSidebar();
    await userEvent.click(screen.getByRole('button', { name: 'History, files, settings' }));
    await userEvent.click(await screen.findByText('History'));
    expect(props.onToggleHistory).toHaveBeenCalled();
  });

  it('toggles settings from the footer menu', async () => {
    const props = renderSidebar();
    await userEvent.click(screen.getByRole('button', { name: 'History, files, settings' }));
    await userEvent.click(await screen.findByText('Settings'));
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
  it('goes Home from the wordmark, expanded or collapsed', async () => {
    const expanded = renderSidebar();
    await userEvent.click(screen.getByRole('button', { name: /too many terminals/i }));
    expect(expanded.onGoHome).toHaveBeenCalled();
    cleanup();
    const railed = renderSidebar({ collapsed: true });
    await userEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(railed.onGoHome).toHaveBeenCalled();
  });
});

describe('folder credentials glyph', () => {
  /** The glyph itself carries no text — it's a bare icon — so its presence is
   *  the tooltip trigger mounting. The tooltip body only exists in the DOM
   *  once open (it's portalled and conditionally rendered), so tests that
   *  need its text must open it first via focus, which Radix opens
   *  synchronously (no hover-delay to wait out in jsdom). */
  const trigger = () => document.querySelector('[data-slot="tooltip-trigger"]');

  const openTooltip = async () => {
    await waitFor(() => expect(trigger()).not.toBeNull());
    fireEvent.focus(trigger()!);
    return (await screen.findByRole('tooltip')).textContent!;
  };

  const report = (over: Partial<ipc.EnvReport> = {}): ipc.EnvReport => ({
    vars: [], refused: [], unreadable: false, folderScoped: true, ...over,
  });

  it('groups variables by the file each one comes from', async () => {
    vi.mocked(ipc.envNames).mockResolvedValue(report({
      vars: [
        { name: 'API_KEY', source: 'dotenv' },
        { name: 'SHARED_TOKEN', source: 'global' },
        { name: 'PROJECT_KEY', source: 'project' },
        { name: 'LOCAL_KEY', source: 'local' },
      ],
      refused: ['PATH'],
    }));
    renderSidebar();

    const title = await openTooltip();
    expect(title).toContain('.claude/settings.local.json — 1');
    expect(title).toContain('LOCAL_KEY');
    expect(title).toContain('.claude/settings.json — 1');
    expect(title).toContain('~/.claude/settings.json — 1');
    expect(title).toContain('.env — 1');
    expect(title).toContain('Refused (reserved): PATH');
    // "from where" — the folder itself, last line.
    expect(title).toContain(PROJECT);
  });

  it('lists the strongest source first, so a clash reads top-down', async () => {
    vi.mocked(ipc.envNames).mockResolvedValue(report({
      vars: [
        { name: 'FROM_DOTENV', source: 'dotenv' },
        { name: 'FROM_LOCAL', source: 'local' },
      ],
    }));
    renderSidebar();

    const title = await openTooltip();
    expect(title.indexOf('settings.local.json')).toBeLessThan(title.indexOf('.env — '));
  });

  it('stays dark for a folder with no credentials of its own', async () => {
    renderSidebar();
    await waitFor(() => expect(ipc.envNames).toHaveBeenCalledWith(PROJECT));
    expect(trigger()).toBeNull();
  });

  it('stays dark when only the global settings file contributes', async () => {
    // Otherwise every folder lights up and the glyph distinguishes nothing.
    vi.mocked(ipc.envNames).mockResolvedValue(report({
      vars: [{ name: 'SHARED_TOKEN', source: 'global' }],
      folderScoped: false,
    }));
    renderSidebar();

    await waitFor(() => expect(ipc.envNames).toHaveBeenCalledWith(PROJECT));
    expect(trigger()).toBeNull();
  });

  it('says so when the .env is there but unreadable', async () => {
    vi.mocked(ipc.envNames).mockResolvedValue(report({ unreadable: true }));
    renderSidebar();

    expect(await openTooltip()).toContain("couldn't be read");
  });

  it('never renders a value, only names', async () => {
    vi.mocked(ipc.envNames).mockResolvedValue(report({
      vars: [{ name: 'API_KEY', source: 'dotenv' }],
    }));
    renderSidebar();

    const title = await openTooltip();
    expect(title).toContain('API_KEY');
    // The backend hands over names only; nothing in the tree can leak a secret.
    expect(document.body.innerHTML).not.toContain('sk-');
  });
});
