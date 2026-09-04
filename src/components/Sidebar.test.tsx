import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShellOption, Tab } from '@/types';

vi.mock('@/lib/ipc');

import * as ipc from '@/lib/ipc';
import { resetSettingsForTest } from '@/lib/settings-store';
import Sidebar, { bucketsOf, matchesQuery, pillLabel } from './Sidebar';

const SHELLS: ShellOption[] = [
  { id: 'powershell', label: 'PowerShell', command: 'powershell.exe' },
  { id: 'cmd', label: 'Command Prompt', command: 'cmd.exe' },
];

const PROJECT = 'C:\\Users\\x\\project';
const OTHER = 'C:\\Users\\x\\other';

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
    onOpenInVscode: vi.fn(),
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
    onImportSession: vi.fn(),
    onReorderProject: vi.fn(),
    onToggleCollapse: vi.fn(),
    ...overrides,
  };
  const { container } = render(<Sidebar {...props} />);
  return { ...props, container };
}

/** The session list, scoped away from the pill row above it — both hold text
 *  like "project", so an unscoped `getByText` is ambiguous. */
const list = () => screen.getByTestId('session-list');

beforeEach(() => {
  resetSettingsForTest();
  vi.mocked(ipc.saveSettings).mockResolvedValue(undefined);
  vi.mocked(ipc.listSessions).mockResolvedValue([]);
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
  it('renders every session in one flat list and marks exited ones', () => {
    renderSidebar({ tabs: [makeTab('a'), makeTab('b', { exited: true })] });
    expect(within(list()).getByText('a')).toBeInTheDocument();
    expect(within(list()).getByText('b')).toBeInTheDocument();
    expect(within(list()).getByText('(exited)')).toBeInTheDocument();
  });

  it('excludes file tabs — they live in the top TabBar, not the session list', () => {
    renderSidebar({ tabs: [makeTab('a'), makeTab('f', { kind: 'file', name: 'notes.md' })] });
    expect(within(list()).getByText('a')).toBeInTheDocument();
    expect(screen.queryByText('notes.md')).not.toBeInTheDocument();
  });

  it('selects a session on click and closes via the row button', async () => {
    const props = renderSidebar();
    await userEvent.click(within(list()).getByText('claude-1'));
    expect(props.onSelectTab).toHaveBeenCalledWith('claude-1');

    await userEvent.click(screen.getAllByTitle('Close tab')[0]);
    expect(props.onCloseTab).toHaveBeenCalledWith('claude-1');
  });

  it('right-click menu renames, opens the directory, and closes the session', async () => {
    const props = renderSidebar({ tabs: [makeTab('a')] });
    fireEvent.contextMenu(within(list()).getByText('a'));

    await userEvent.click(await screen.findByText('Open directory'));
    expect(props.onOpenDirectory).toHaveBeenCalledWith(PROJECT);

    fireEvent.contextMenu(within(list()).getByText('a'));
    await userEvent.click(await screen.findByText('Close'));
    expect(props.onCloseTab).toHaveBeenCalledWith('a');
  });

  it('hides "Open in VS Code" until a claude tab has a resumable session id', async () => {
    renderSidebar({ tabs: [makeTab('a')] });
    fireEvent.contextMenu(within(list()).getByText('a'));
    expect(await screen.findByText('Rename')).toBeInTheDocument();
    expect(screen.queryByText('Open in VS Code')).not.toBeInTheDocument();
  });

  it('"Open in VS Code" hands off a resumable claude tab', async () => {
    const props = renderSidebar({ tabs: [makeTab('a', { resumeSessionId: 'sess-1' })] });
    fireEvent.contextMenu(within(list()).getByText('a'));
    await userEvent.click(await screen.findByText('Open in VS Code'));
    expect(props.onOpenInVscode).toHaveBeenCalledWith('a');
  });

  it('right-click menu pins and unpins a session', async () => {
    const props = renderSidebar({ tabs: [makeTab('a')] });
    fireEvent.contextMenu(within(list()).getByText('a'));
    await userEvent.click(await screen.findByText('Pin session'));
    expect(props.onTogglePin).toHaveBeenCalledWith('a');
  });

  it('right-click menu offers Unpin once a session is pinned', async () => {
    renderSidebar({ tabs: [makeTab('a', { pinned: true })] });
    fireEvent.contextMenu(within(list()).getByText('a'));
    expect(await screen.findByText('Unpin')).toBeInTheDocument();
  });

  it('renames a session via double-click, committing on Enter', async () => {
    const props = renderSidebar({ tabs: [makeTab('a')] });
    await userEvent.dblClick(within(list()).getByText('a'));
    const input = screen.getByDisplayValue('a');
    await userEvent.clear(input);
    await userEvent.type(input, 'renamed{Enter}');
    expect(props.onRenameTab).toHaveBeenCalledWith('a', 'renamed');
  });

  it('cancels a rename on Escape without committing', async () => {
    const props = renderSidebar({ tabs: [makeTab('a')] });
    await userEvent.dblClick(within(list()).getByText('a'));
    const input = screen.getByDisplayValue('a');
    await userEvent.clear(input);
    await userEvent.type(input, 'nope{Escape}');
    expect(props.onRenameTab).not.toHaveBeenCalled();
  });

  it('discards a rename that trims to empty', async () => {
    const props = renderSidebar({ tabs: [makeTab('a')] });
    await userEvent.dblClick(within(list()).getByText('a'));
    const input = screen.getByDisplayValue('a');
    await userEvent.clear(input);
    await userEvent.type(input, '   {Enter}');
    expect(props.onRenameTab).not.toHaveBeenCalled();
  });

  it('shows a spinning indicator while a claude tab is working', () => {
    const { container } = renderSidebar({ tabs: [makeTab('a', { status: 'working' })] });
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('shows a pulsing indicator when a claude tab requires a response', () => {
    const { container } = renderSidebar({ tabs: [makeTab('a', { status: 'requires_response' })] });
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('does not render a claude status indicator for shell tabs', () => {
    const { container } = renderSidebar({
      tabs: [makeTab('sh', { kind: 'shell', name: 'PowerShell', status: 'working' })],
    });
    expect(container.querySelector('.animate-spin')).not.toBeInTheDocument();
  });

  describe('the one flat list', () => {
    it('sorts pinned first, then waiting, running, idle and finally asleep', () => {
      renderSidebar({
        tabs: [
          makeTab('sleeper', { status: 'idle', dormant: true }),
          makeTab('finished', { status: 'idle' }),
          makeTab('busy', { status: 'working' }),
          makeTab('blocked', { status: 'requires_response' }),
          makeTab('kept', { pinned: true, status: 'idle', dormant: true }),
        ],
      });
      const names = [...list().querySelectorAll('[data-session-name]')].map((el) => el.textContent);
      expect(names).toEqual(['kept', 'blocked', 'busy', 'finished', 'sleeper']);
    });

    it('keeps the order sessions were opened in among equals', () => {
      renderSidebar({
        tabs: [makeTab('first', { status: 'idle' }), makeTab('second', { status: 'idle' })],
      });
      const names = [...list().querySelectorAll('[data-session-name]')].map((el) => el.textContent);
      expect(names).toEqual(['first', 'second']);
    });

    it('ranks a live idle session above a dormant one — the bug the ribbon showed', () => {
      // `idle` is in no ledger bucket, so deriving the sort from buckets put a
      // finished-and-seen session down with the sleepers while its own row
      // showed a green check.
      renderSidebar({
        tabs: [makeTab('asleep', { status: 'idle', dormant: true }), makeTab('alive', { status: 'idle' })],
      });
      const names = [...list().querySelectorAll('[data-session-name]')].map((el) => el.textContent);
      expect(names).toEqual(['alive', 'asleep']);
    });
  });

  describe('row layout', () => {
    it('puts the folder on its own line, so the name gets the full width', () => {
      renderSidebar({
        projects: [PROJECT, OTHER],
        tabs: [makeTab('a-long-session-name'), makeTab('b', { cwd: OTHER })],
      });
      const row = within(list()).getByText('a-long-session-name').closest('[data-session-row]')!;
      expect(within(row as HTMLElement).getByTestId('row-meta')).toHaveTextContent('project');
    });

    it('drops the second line entirely when it would say nothing', () => {
      renderSidebar({ tabs: [makeTab('a', { status: 'idle' })] });
      expect(screen.queryByTestId('row-meta')).not.toBeInTheDocument();
    });

    it('shows what a working session is doing, target highlighted', () => {
      renderSidebar({
        tabs: [makeTab('a', { status: 'working', statusDetail: 'editing Sidebar.tsx' })],
      });
      const meta = screen.getByTestId('row-meta');
      expect(meta).toHaveTextContent('editing Sidebar.tsx');
      // Scoped to the meta line: the working row's own spinner is text-warning too.
      expect(meta.querySelector('.text-warning')).toHaveTextContent('Sidebar.tsx');
    });

    it('falls back to the bare detail, unhighlighted, when it has no verb to split off', () => {
      renderSidebar({ tabs: [makeTab('a', { status: 'working', statusDetail: 'Bash' })] });
      expect(screen.getByTestId('row-meta')).toHaveTextContent('Bash');
    });

    it('shows how long a session has been waiting', () => {
      renderSidebar({
        tabs: [makeTab('a', { status: 'requires_response', statusChangedAt: Date.now() - 5 * 60_000 })],
      });
      expect(screen.getByTestId('row-meta')).toHaveTextContent('5m');
    });
  });

  describe('session ledger', () => {
    it('shows a status chip only while its count is non-zero', () => {
      renderSidebar({ tabs: [makeTab('a', { status: 'idle' })] });
      expect(screen.queryByLabelText(/waiting on you/)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/^running/)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/just finished/)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/^pinned/)).not.toBeInTheDocument();
    });

    it('counts each bucket across every folder', () => {
      renderSidebar({
        projects: [PROJECT, OTHER],
        tabs: [
          makeTab('needs-here', { status: 'requires_response' }),
          makeTab('needs-there', { status: 'requires_response', cwd: OTHER }),
          makeTab('busy', { status: 'working' }),
          makeTab('done', { status: 'idle', justFinished: true }),
          makeTab('kept', { pinned: true }),
        ],
      });
      expect(screen.getByLabelText('waiting on you: 2')).toBeInTheDocument();
      expect(screen.getByLabelText('running: 1')).toBeInTheDocument();
      expect(screen.getByLabelText('just finished: 1')).toBeInTheDocument();
      expect(screen.getByLabelText('pinned: 1')).toBeInTheDocument();
    });

    it('leaves exited, dormant and shell sessions out of the live counts', () => {
      renderSidebar({
        tabs: [
          makeTab('dead', { status: 'requires_response', exited: true }),
          makeTab('asleep', { status: 'working', dormant: true }),
          makeTab('shell', { kind: 'shell', status: 'working' }),
          makeTab('real', { status: 'working' }),
        ],
      });
      expect(screen.queryByLabelText(/waiting on you/)).not.toBeInTheDocument();
      expect(screen.getByLabelText('running: 1')).toBeInTheDocument();
    });

    it('narrows the list to one bucket, across folders, when its chip is clicked', async () => {
      renderSidebar({
        projects: [PROJECT, OTHER],
        tabs: [
          makeTab('needs-here', { status: 'requires_response' }),
          makeTab('needs-there', { status: 'requires_response', cwd: OTHER }),
          makeTab('busy', { status: 'working' }),
        ],
      });

      await userEvent.click(screen.getByLabelText('waiting on you: 2'));

      expect(within(list()).getByText('needs-here')).toBeInTheDocument();
      expect(within(list()).getByText('needs-there')).toBeInTheDocument();
      expect(within(list()).queryByText('busy')).not.toBeInTheDocument();
      expect(screen.getByTestId('lens')).toHaveTextContent('waiting on you');
    });

    it('restores the full list when the active chip is clicked again', async () => {
      renderSidebar({ tabs: [makeTab('busy', { status: 'working' }), makeTab('quiet', { status: 'idle' })] });
      const chip = screen.getByLabelText('running: 1');

      await userEvent.click(chip);
      expect(within(list()).queryByText('quiet')).not.toBeInTheDocument();

      await userEvent.click(chip);
      expect(within(list()).getByText('quiet')).toBeInTheDocument();
      expect(screen.queryByTestId('lens')).not.toBeInTheDocument();
    });
  });

  describe('filter field', () => {
    it('narrows the list by session name', async () => {
      renderSidebar({ tabs: [makeTab('deploy-rollback'), makeTab('sentry-triage')] });
      await userEvent.type(screen.getByLabelText('Filter sessions'), 'sentry');
      expect(within(list()).getByText('sentry-triage')).toBeInTheDocument();
      expect(within(list()).queryByText('deploy-rollback')).not.toBeInTheDocument();
    });

    it('narrows the list by folder name', async () => {
      renderSidebar({
        projects: [PROJECT, OTHER],
        tabs: [makeTab('here'), makeTab('there', { cwd: OTHER })],
      });
      await userEvent.type(screen.getByLabelText('Filter sessions'), 'other');
      expect(within(list()).getByText('there')).toBeInTheDocument();
      expect(within(list()).queryByText('here')).not.toBeInTheDocument();
    });

    it('narrows within an active bucket rather than replacing it', async () => {
      renderSidebar({
        tabs: [
          makeTab('busy-alpha', { status: 'working' }),
          makeTab('busy-beta', { status: 'working' }),
          makeTab('idle-alpha', { status: 'idle' }),
        ],
      });
      await userEvent.click(screen.getByLabelText('running: 2'));
      await userEvent.type(screen.getByLabelText('Filter sessions'), 'alpha');
      expect(within(list()).getByText('busy-alpha')).toBeInTheDocument();
      expect(within(list()).queryByText('busy-beta')).not.toBeInTheDocument();
      expect(within(list()).queryByText('idle-alpha')).not.toBeInTheDocument();
    });

    it('clears on Escape', async () => {
      renderSidebar({ tabs: [makeTab('deploy-rollback'), makeTab('sentry-triage')] });
      const input = screen.getByLabelText('Filter sessions');
      await userEvent.type(input, 'sentry');
      await userEvent.type(input, '{Escape}');
      expect(input).toHaveValue('');
      expect(within(list()).getByText('deploy-rollback')).toBeInTheDocument();
    });

    it('clears from its own button', async () => {
      renderSidebar({ tabs: [makeTab('deploy-rollback'), makeTab('sentry-triage')] });
      await userEvent.type(screen.getByLabelText('Filter sessions'), 'sentry');
      await userEvent.click(screen.getByLabelText('Clear filter'));
      expect(within(list()).getByText('deploy-rollback')).toBeInTheDocument();
    });

    it('offers a way out when nothing matches', async () => {
      renderSidebar({ tabs: [makeTab('deploy-rollback')] });
      await userEvent.type(screen.getByLabelText('Filter sessions'), 'nothing-like-this');
      expect(screen.getByText(/No sessions match/)).toBeInTheDocument();

      await userEvent.click(screen.getByText('Show all sessions'));
      expect(within(list()).getByText('deploy-rollback')).toBeInTheDocument();
    });
  });

  describe('folder pills', () => {
    it('offers All plus one pill per open folder, each with its own count', () => {
      renderSidebar({
        projects: [PROJECT, OTHER],
        tabs: [makeTab('a'), makeTab('b'), makeTab('c', { cwd: OTHER })],
      });
      expect(screen.getByRole('button', { name: 'All folders, 3 sessions' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'project, 2 sessions' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'other, 1 session' })).toBeInTheDocument();
    });

    it('narrows the list to one folder, and says which above the list', async () => {
      renderSidebar({
        projects: [PROJECT, OTHER],
        tabs: [makeTab('here'), makeTab('there', { cwd: OTHER })],
      });

      await userEvent.click(screen.getByRole('button', { name: 'other, 1 session' }));

      expect(within(list()).getByText('there')).toBeInTheDocument();
      expect(within(list()).queryByText('here')).not.toBeInTheDocument();
      // Picking a folder narrows the list as hard as a status chip does, so it
      // has to be named — a pill can scroll out of its own wrapped row.
      expect(screen.getByTestId('lens')).toHaveTextContent('other');
    });

    it('marks the selected pill as pressed, and unselects on a second click', async () => {
      renderSidebar({ projects: [PROJECT, OTHER], tabs: [makeTab('a')] });
      const pill = screen.getByRole('button', { name: 'project, 1 session' });

      await userEvent.click(pill);
      expect(pill).toHaveAttribute('aria-pressed', 'true');

      await userEvent.click(pill);
      expect(pill).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByRole('button', { name: 'All folders, 1 session' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('drops the per-row folder line once the list is one folder deep', async () => {
      renderSidebar({
        projects: [PROJECT, OTHER],
        tabs: [makeTab('here'), makeTab('there', { cwd: OTHER })],
      });
      expect(screen.getAllByTestId('row-meta').length).toBe(2);

      await userEvent.click(screen.getByRole('button', { name: 'other, 1 session' }));
      expect(screen.queryByTestId('row-meta')).not.toBeInTheDocument();
    });

    it('falls back to All when the selected folder is removed', async () => {
      const props = renderSidebar({
        projects: [PROJECT, OTHER],
        tabs: [makeTab('a'), makeTab('b', { cwd: OTHER })],
      });
      await userEvent.click(screen.getByRole('button', { name: 'other, 1 session' }));
      expect(within(list()).queryByText('a')).not.toBeInTheDocument();

      cleanup();
      renderSidebar({ ...props, projects: [PROJECT], tabs: [makeTab('a')] });
      expect(within(list()).getByText('a')).toBeInTheDocument();
    });

    it('spawns a session from a folder pill\u2019s right-click menu', async () => {
      const props = renderSidebar({ tabs: [] });
      fireEvent.contextMenu(screen.getByRole('button', { name: 'project, 0 sessions' }));

      await userEvent.click(await screen.findByText('New PowerShell'));
      expect(props.onNewShellTab).toHaveBeenCalledWith(PROJECT, 'powershell');
    });

    it('removes a folder from its pill\u2019s right-click menu without touching the dialog', async () => {
      const props = renderSidebar();
      fireEvent.contextMenu(screen.getByRole('button', { name: 'project, 2 sessions' }));
      await userEvent.click(await screen.findByText('Remove folder'));
      expect(props.onRemoveProject).toHaveBeenCalledWith(PROJECT);
      expect(props.onAddProject).not.toHaveBeenCalled();
    });

    it('imports a session from a folder pill\u2019s right-click menu', async () => {
      const props = renderSidebar();
      fireEvent.contextMenu(screen.getByRole('button', { name: 'project, 2 sessions' }));
      await userEvent.click(await screen.findByText('Import session…'));
      expect(props.onImportSession).toHaveBeenCalledWith(PROJECT);
    });

    it('reorders folders by dragging one pill onto another', () => {
      const props = renderSidebar({ projects: [PROJECT, OTHER], tabs: [] });
      const first = screen.getByRole('button', { name: 'project, 0 sessions' });
      const second = screen.getByRole('button', { name: 'other, 0 sessions' });

      fireEvent.dragStart(first);
      const rect = { left: 0, width: 100, top: 0, height: 20, right: 100, bottom: 20 };
      second.getBoundingClientRect = () => rect as DOMRect;
      fireEvent.dragOver(second, { clientX: 90 });
      fireEvent.drop(second, { clientX: 90 });

      expect(props.onReorderProject).toHaveBeenCalledWith(PROJECT, OTHER, 'after');
    });
  });

  describe('new session menu', () => {
    it('offers Claude and every OS shell for the only open folder', async () => {
      const props = renderSidebar({ tabs: [] });
      await userEvent.click(screen.getByLabelText('New session'));

      await userEvent.click(await screen.findByText('Claude'));
      expect(props.onNewClaudeTab).toHaveBeenCalledWith(PROJECT);
    });

    it('scopes to the selected folder when several are open', async () => {
      const props = renderSidebar({ projects: [PROJECT, OTHER], tabs: [] });
      await userEvent.click(screen.getByRole('button', { name: 'other, 0 sessions' }));
      await userEvent.click(screen.getByLabelText('New session'));

      await userEvent.click(await screen.findByText('Claude'));
      expect(props.onNewClaudeTab).toHaveBeenCalledWith(OTHER);
    });

    it('asks which folder when several are open and none is selected', async () => {
      renderSidebar({ projects: [PROJECT, OTHER], tabs: [] });
      await userEvent.click(screen.getByLabelText('New session'));

      const menu = await screen.findByRole('menu');
      expect(within(menu).getByText('project')).toBeInTheDocument();
      expect(within(menu).getByText('other')).toBeInTheDocument();
      expect(within(menu).queryByText('Claude')).not.toBeInTheDocument();
    });

    it('always offers Add folder…', async () => {
      const props = renderSidebar({ tabs: [] });
      await userEvent.click(screen.getByLabelText('New session'));
      await userEvent.click(await screen.findByText('Add folder…'));
      expect(props.onAddProject).toHaveBeenCalled();
    });

    it('prompts to select a folder when none is open', async () => {
      const props = renderSidebar({ projects: [], tabs: [] });
      await userEvent.click(screen.getByText('Select folder…'));
      expect(props.onAddProject).toHaveBeenCalled();
    });
  });

  describe('footer navigation', () => {
    it('goes Home, opens Files and collapses from the footer', async () => {
      const props = renderSidebar();
      await userEvent.click(screen.getByRole('button', { name: 'Home' }));
      expect(props.onGoHome).toHaveBeenCalled();

      await userEvent.click(screen.getByRole('button', { name: 'File explorer' }));
      expect(props.onToggleFiles).toHaveBeenCalled();

      await userEvent.click(screen.getByRole('button', { name: 'Hide sidebar' }));
      expect(props.onToggleCollapse).toHaveBeenCalled();
    });

    it('opens the command palette, history and settings from the footer menu', async () => {
      const props = renderSidebar();
      await userEvent.click(screen.getByRole('button', { name: 'Search, history, settings' }));

      await userEvent.click(await screen.findByText('Search sessions'));
      expect(props.onOpenSearch).toHaveBeenCalled();

      await userEvent.click(screen.getByRole('button', { name: 'Search, history, settings' }));
      await userEvent.click(await screen.findByText('History'));
      expect(props.onToggleHistory).toHaveBeenCalled();
    });
  });

  describe('collapsed rail', () => {
    it('collapses to an icon rail and back', async () => {
      const props = renderSidebar({ collapsed: true });
      expect(screen.queryByLabelText('New session')).not.toBeInTheDocument();
      await userEvent.click(screen.getByTitle('Show sidebar'));
      expect(props.onToggleCollapse).toHaveBeenCalled();
    });

    it('stacks the ledger counts on the rail', () => {
      renderSidebar({
        collapsed: true,
        tabs: [
          makeTab('needs-me', { status: 'requires_response' }),
          makeTab('done-a', { status: 'idle', justFinished: true }),
          makeTab('done-b', { status: 'idle', justFinished: true }),
        ],
      });
      expect(screen.getByTitle('1 waiting on you')).toHaveTextContent('1');
      expect(screen.getByTitle('2 just finished')).toHaveTextContent('2');
    });

    it('shows no counts when nothing is live or pinned', () => {
      renderSidebar({ collapsed: true, tabs: [makeTab('a', { status: 'idle' })] });
      expect(screen.queryByTitle(/waiting on you/)).not.toBeInTheDocument();
      expect(screen.queryByTitle(/just finished/)).not.toBeInTheDocument();
    });

    it('keeps its own navigation, since it has no footer', async () => {
      const props = renderSidebar({ collapsed: true });
      await userEvent.click(screen.getByRole('button', { name: 'Home' }));
      expect(props.onGoHome).toHaveBeenCalled();

      await userEvent.click(screen.getByRole('button', { name: 'Browse past sessions' }));
      expect(props.onToggleHistory).toHaveBeenCalled();

      await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
      expect(props.onToggleSettings).toHaveBeenCalled();
    });
  });
});

describe('bucketsOf', () => {
  it('classifies a live claude session by its status', () => {
    expect(bucketsOf(makeTab('a', { status: 'requires_response' }))).toEqual(['waiting']);
    expect(bucketsOf(makeTab('a', { status: 'working' }))).toEqual(['working']);
    expect(bucketsOf(makeTab('a', { status: 'idle', justFinished: true }))).toEqual(['done']);
    expect(bucketsOf(makeTab('a', { status: 'idle' }))).toEqual([]);
  });

  it('drops exited sessions entirely, pinned included', () => {
    expect(bucketsOf(makeTab('a', { status: 'requires_response', exited: true, pinned: true }))).toEqual([]);
  });

  it('ignores a dormant session status, the way its moon glyph does', () => {
    expect(bucketsOf(makeTab('a', { status: 'working', dormant: true }))).toEqual([]);
    expect(bucketsOf(makeTab('a', { status: 'working', dormant: true, pinned: true }))).toEqual(['pinned']);
  });

  it('never gives a shell a claude status, but does let it be pinned', () => {
    expect(bucketsOf(makeTab('a', { kind: 'shell', status: 'working' }))).toEqual([]);
    expect(bucketsOf(makeTab('a', { kind: 'shell', pinned: true }))).toEqual(['pinned']);
  });
});

describe('pillLabel', () => {
  it('is just the folder name while nothing else shares it', () => {
    expect(pillLabel('C:\\a\\b\\api', ['C:\\a\\b\\api', 'C:\\a\\b\\web'])).toBe('api');
  });

  it('grows the nearest ancestor when two open folders share a name', () => {
    const dirs = ['C:\\a\\one\\api', 'C:\\a\\two\\api', 'C:\\a\\b\\web'];
    expect(pillLabel(dirs[0], dirs)).toBe('one/api');
    expect(pillLabel(dirs[1], dirs)).toBe('two/api');
    // Only the colliding pair grows — the row stays short.
    expect(pillLabel(dirs[2], dirs)).toBe('web');
  });

  it('stays the bare name for a folder sitting at a drive root', () => {
    expect(pillLabel('C:\\api', ['C:\\api'])).toBe('api');
  });
});

describe('matchesQuery', () => {
  it('matches the session name and the folder name, case-insensitively', () => {
    const tab = makeTab('Deploy Rollback', { cwd: 'C:\\x\\observability' });
    expect(matchesQuery(tab, 'rollback')).toBe(true);
    expect(matchesQuery(tab, 'OBSERV')).toBe(true);
    expect(matchesQuery(tab, 'nope')).toBe(false);
  });

  it('matches everything on an empty or whitespace query', () => {
    expect(matchesQuery(makeTab('a'), '')).toBe(true);
    expect(matchesQuery(makeTab('a'), '   ')).toBe(true);
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
