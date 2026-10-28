import { cleanup, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';


vi.mock('@/lib/ipc', () => {
  const ok = (v: unknown) => vi.fn().mockResolvedValue(v);
  const noop = () => {};
  return {
    listShells: ok([{ id: 'powershell', label: 'PowerShell', command: 'pwsh' }]),
    homeDir: ok('/home/u'),
    loadWorkspace: ok({
      projects: ['/proj'],
      collapsed: false,
      sessionNames: {},
      // As the backend hands them over — already migrated. Turning an older
      // file into this shape is `workspace::migrate`'s job and is tested in
      // Rust; by the time it crosses IPC a null projectDir means the Inbox and
      // nothing else, which is the whole point of the schema version.
      tabs: [
        { id: 'tab-alpha', kind: 'claude', name: 'Alpha', shellId: null, resumeSessionId: 'sess-a', cwd: '/proj', projectDir: '/proj' },
        { id: 'tab-beta', kind: 'claude', name: 'Beta', shellId: null, resumeSessionId: 'sess-b', cwd: '/proj', projectDir: '/proj' },
        { id: 'tab-loose', kind: 'claude', name: 'Loose thought', shellId: null, resumeSessionId: 'sess-c', cwd: '/home/u/.tmt/scratch/aaa', projectDir: null },
      ],
    }),
    saveWorkspace: ok(undefined),
    createScratchDir: vi.fn((id: string) => Promise.resolve(`/home/u/.tmt/scratch/${id}`)),
    loadTasks: ok([]),
    saveTasks: ok(undefined),
    spawnPty: ok(undefined),
    killPty: vi.fn(),
    resizePty: vi.fn(),
    writeToPty: vi.fn(),
    notify: ok(undefined),
    ensureNotificationPermission: ok(true),
    canOpenSystemNotificationSettings: ok(false),
    openSystemNotificationSettings: ok(undefined),
    openDirectory: vi.fn(),
    revealInFileManager: vi.fn(),
    fileManagerName: () => 'Finder',
    openExternal: vi.fn(),
    openInVscode: vi.fn(),
    pickFolder: ok(null),
    importSession: ok(null),
    exportSession: ok(undefined),
    uninstallHooks: ok(undefined),
    envNames: ok({ vars: [], refused: [], unreadable: false, folderScoped: false }),
    onTabStatus: ok(noop),
    onTabNamed: ok(noop),
    onPtyExit: ok(noop),
    onClaudeSessionResolved: ok(noop),
    listDir: ok([]),
    readFile: ok(''),
    writeFile: ok(undefined),
    loadSettings: ok({}),
    saveSettings: ok(undefined),
    getSessionUsageStats: ok({ available: false, session: null, week: null, fetchedAtMs: null, fromCache: false }),
    getSessionStats: ok([]),
    // Fresh transcripts, so the restored sessions are under Today rather than
    // folded away in an older day.
    listSessions: ok(['sess-a', 'sess-b', 'sess-c'].map((sessionId) => (
      { sessionId, preview: '', lastUsedIso: new Date().toISOString() }))),
    deleteSession: ok(undefined),
    readTranscript: ok([]),
  };
});

vi.mock('@/components/Terminal', () => ({
  default: ({ tabId, isVisible }: { tabId: string; isVisible: boolean }) =>
    <div data-testid={`term-${tabId}`} data-visible={String(isVisible)} />,
}));
vi.mock('@/components/terminalCache', () => ({
  disposeTerminal: vi.fn(), writeToTerminal: vi.fn(), terminalCache: new Map(), flushPendingWrites: vi.fn(),
}));

import * as ipc from '@/lib/ipc';
import { resetTasksForTest } from '@/lib/tasks';
import { settleConfirm } from '@/lib/confirm';
import App from './App';

// A dialog left open by a failing test would hide the next test's whole UI.
afterEach(() => { settleConfirm(false); cleanup(); });
beforeEach(() => {
  vi.clearAllMocks();
  resetTasksForTest();
});

/** Where a session is filed, as its row says it: the project on its second
 *  line, or nothing there for the Inbox. The top level mixes every project, so
 *  the row is the only place this is shown. */
function groupOfRow(row: Element): string {
  return row.querySelector('[data-session-meta]')?.textContent ?? 'Inbox';
}

function sessionRow(name: string): HTMLElement {
  const rows = [...document.querySelectorAll('[data-session-row]')] as HTMLElement[];
  const found = rows.find((r) => r.querySelector('[data-session-name]')?.textContent === name);
  if (!found) throw new Error(`no session row named ${name} (have: ${rows.map((r) => r.textContent).join(', ')})`);
  return found;
}

/** The most recent call to a mocked ipc function. (`Array.prototype.at` is
 *  outside this project's TS lib target.) */
function lastCall<T extends unknown[]>(calls: T[]): T {
  return calls[calls.length - 1];
}

/** Radix opens a menu on pointerdown, so these go through `userEvent` rather
 *  than `fireEvent.click`. See src/tests/setup.ts for the jsdom shim. */
const openMenu = (trigger: HTMLElement) => userEvent.click(trigger);

/** The label of the active view in each pane's header. A lone pane has no
 *  header — the session tab above already names it. */
function activeTabLabels(): string[] {
  return [...document.querySelectorAll('[data-pane-tab][data-active]')]
    .map((n) => n.textContent?.replace(/×$/, '').trim() ?? '');
}

/** The session tabs across the top, in strip order. */
function sessionTabs(): string[] {
  return [...document.querySelectorAll('[data-session-tab-name]')].map((n) => n.textContent ?? '');
}

/** The session tab on screen. */
function currentSessionTab(): string | null {
  return document.querySelector('[data-session-tab][aria-selected="true"] [data-session-tab-name]')?.textContent ?? null;
}

function painted(): string[] {
  return [...document.querySelectorAll('[data-testid^="term-"]')]
    .filter((n) => (n as HTMLElement).dataset.visible === 'true')
    .map((n) => (n as HTMLElement).getAttribute('data-testid')!.replace('term-', ''));
}

async function ready() {
  await waitFor(() => expect(document.querySelectorAll('[data-session-row]').length).toBe(3));
}

describe('information architecture', () => {
  it('restores sessions into the Inbox or their project, never both', async () => {
    render(<App />);
    await ready();
    expect(groupOfRow(sessionRow('Loose thought'))).toBe('Inbox');
    expect(groupOfRow(sessionRow('Alpha'))).toContain('proj');
  });

  it('lists each session once in the sidebar', async () => {
    render(<App />);
    await ready();
    // Every session appears exactly once in the chrome. The old layout had the
    // same session in a rail, a list and a tab strip at the same time.
    const alphas = [...document.querySelectorAll('[data-session-name]')]
      .filter((n) => n.textContent === 'Alpha');
    expect(alphas).toHaveLength(1);
  });

  it('opens a restored project session and paints its terminal', async () => {
    render(<App />);
    await ready();
    fireEvent.click(sessionRow('Alpha'));
    await waitFor(() => expect(painted()).toEqual(['tab-alpha']));
    expect(currentSessionTab()).toBe('Alpha');
    // One pane showing one thing needs no header of its own.
    expect(activeTabLabels()).toEqual([]);
  });

  it('opens sessions as tabs, newest at the left', async () => {
    render(<App />);
    await ready();
    fireEvent.click(sessionRow('Alpha'));
    fireEvent.click(sessionRow('Beta'));
    await waitFor(() => expect(sessionTabs()).toEqual(['Beta', 'Alpha']));
    // Opening one that's already there doesn't shuffle the strip.
    fireEvent.click(sessionRow('Alpha'));
    await waitFor(() => expect(currentSessionTab()).toBe('Alpha'));
    expect(sessionTabs()).toEqual(['Beta', 'Alpha']);
  });

  it('closing a tab keeps the session running in the sidebar', async () => {
    render(<App />);
    await ready();
    fireEvent.click(sessionRow('Alpha'));
    await waitFor(() => expect(sessionTabs()).toEqual(['Alpha']));
    await userEvent.click(screen.getByLabelText('Close tab Alpha'));
    await waitFor(() => expect(sessionTabs()).toEqual([]));
    expect(sessionRow('Alpha')).toBeInTheDocument();
    expect(ipc.killPty).not.toHaveBeenCalled();
  });

  it('keeps the inspector closed until asked', async () => {
    render(<App />);
    await ready();
    fireEvent.click(sessionRow('Alpha'));
    await waitFor(() => expect(painted()).toEqual(['tab-alpha']));
    expect(document.querySelector('[data-session-inspector]')).toBeNull();

    fireEvent.click(screen.getByLabelText('Session details'));
    await waitFor(() => expect(document.querySelector('[data-session-inspector]')).not.toBeNull());
  });
});

describe('scratch sessions', () => {
  it('⌘N then Enter creates a usable Inbox session with no folder picker', async () => {
    render(<App />);
    await ready();

    fireEvent.keyDown(window, { key: 'n', metaKey: true });
    // The dialog opens on Inbox + Claude, so Enter starts exactly that.
    await screen.findByRole('dialog', { name: 'New session' });
    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(ipc.createScratchDir).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(ipc.spawnPty).toHaveBeenCalled());
    expect(ipc.pickFolder).not.toHaveBeenCalled();

    const spawn = vi.mocked(ipc.spawnPty).mock.calls[0][0];
    expect(spawn.kind).toBe('claude');
    expect(spawn.cwd).toMatch(/\.tmt[/\\]scratch[/\\]/);

    // And it lands in the Inbox, selected and ready to type into.
    await waitFor(() => expect(groupOfRow(sessionRow('Claude'))).toBe('Inbox'));
    expect(painted()).toEqual([spawn.tabId]);
  });

  it('moving a scratch session to a project refiles it without respawning', async () => {
    render(<App />);
    await ready();
    fireEvent.click(sessionRow('Loose thought'));
    await waitFor(() => expect(painted()).toEqual(['tab-loose']));
    const spawnsBefore = vi.mocked(ipc.spawnPty).mock.calls.length;

    await openMenu(within(sessionRow('Loose thought')).getByLabelText('Actions for Loose thought'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Move to project…' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'proj' }));

    await waitFor(() => expect(groupOfRow(sessionRow('Loose thought'))).toContain('proj'));
    // The conversation is untouched: same session, same pty, same directory.
    expect(vi.mocked(ipc.spawnPty).mock.calls.length).toBe(spawnsBefore);
    expect(ipc.killPty).not.toHaveBeenCalled();
    expect(painted()).toEqual(['tab-loose']);
  });
});

describe('navigation', () => {
  it('⌘K finds a session by name and opens it', async () => {
    render(<App />);
    await ready();

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const dialog = await screen.findByRole('dialog', { name: 'Jump to a session' });
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'beta' } });
    fireEvent.keyDown(within(dialog).getByRole('textbox'), { key: 'Enter' });

    await waitFor(() => expect(painted()).toEqual(['tab-beta']));
  });

  it('⌘⇧F hides the sidebar and the inspector, leaving the terminal', async () => {
    render(<App />);
    await ready();
    fireEvent.click(sessionRow('Alpha'));
    fireEvent.click(screen.getByLabelText('Session details'));
    await waitFor(() => expect(document.querySelector('[data-session-inspector]')).not.toBeNull());

    fireEvent.keyDown(window, { key: 'F', metaKey: true, shiftKey: true });

    await waitFor(() => expect(document.querySelectorAll('[data-session-row]').length).toBe(0));
    expect(document.querySelector('[data-session-inspector]')).toBeNull();
    // Still the same live terminal, still saying which session you're in —
    // the strip stays, its controls don't.
    expect(painted()).toEqual(['tab-alpha']);
    expect(currentSessionTab()).toBe('Alpha');
    expect(screen.queryByLabelText('Session actions')).toBeNull();
  });

  it('⌘B folds the sidebar away and back', async () => {
    render(<App />);
    await ready();
    fireEvent.keyDown(window, { key: 'b', metaKey: true });
    await waitFor(() => expect(document.querySelectorAll('[data-session-row]').length).toBe(0));
    fireEvent.keyDown(window, { key: 'b', metaKey: true });
    await ready();
  });
});

describe('To-Do', () => {
  async function openTodo() {
    fireEvent.click(screen.getByRole('button', { name: /To-Do/ }));
    return screen.findByRole('heading', { level: 1, name: 'To-Do' });
  }

  it('captures a task with no project and no session', async () => {
    render(<App />);
    await ready();
    await openTodo();

    fireEvent.click(screen.getByRole('button', { name: 'New task' }));
    const input = await screen.findByLabelText('New task title');
    fireEvent.change(input, { target: { value: 'Migrate this endpoint later' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(screen.getAllByText('Migrate this endpoint later').length).toBeGreaterThan(0));
    expect(ipc.saveTasks).toHaveBeenCalled();
    const saved = lastCall(vi.mocked(ipc.saveTasks).mock.calls)[0] as { projectDir: unknown; sessionIds: unknown }[];
    expect(saved[0].projectDir).toBeNull();
    expect(saved[0].sessionIds).toEqual([]);
  });

  it('puts session actions in the overflow menu, not on the row', async () => {
    render(<App />);
    await ready();
    await openTodo();
    fireEvent.click(screen.getByRole('button', { name: 'New task' }));
    const input = await screen.findByLabelText('New task title');
    fireEvent.change(input, { target: { value: 'Investigate 429s' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    const row = await waitFor(() => document.querySelector('[data-task-row]') as HTMLElement);
    // The row offers a checkbox and a ⋯ — and no way to launch Claude.
    expect(within(row).queryByText(/Start Claude session/)).toBeNull();
    await openMenu(within(row).getByLabelText('Actions for Investigate 429s'));
    expect(await screen.findByRole('menuitem', { name: 'Start Claude session' })).toBeInTheDocument();
  });

  it('starting Claude from a task creates a linked session and hands it the task', async () => {
    render(<App />);
    await ready();
    await openTodo();
    fireEvent.click(screen.getByRole('button', { name: 'New task' }));
    const input = await screen.findByLabelText('New task title');
    fireEvent.change(input, { target: { value: 'Investigate 429s' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    const row = await waitFor(() => document.querySelector('[data-task-row]') as HTMLElement);
    await openMenu(within(row).getByLabelText('Actions for Investigate 429s'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Start Claude session' }));

    await waitFor(() => expect(ipc.spawnPty).toHaveBeenCalled());
    const spawn = lastCall(vi.mocked(ipc.spawnPty).mock.calls)[0];
    expect(spawn.cwd).toMatch(/\.tmt[/\\]scratch[/\\]/);

    // Linked and marked in progress — but never completed on our own.
    const saved = lastCall(vi.mocked(ipc.saveTasks).mock.calls)[0] as {
      sessionIds: string[]; inProgress: boolean; done: boolean;
    }[];
    expect(saved[0].sessionIds).toEqual([spawn.tabId]);
    expect(saved[0].inProgress).toBe(true);
    expect(saved[0].done).toBe(false);
  });

  it('completing a task does not touch its session', async () => {
    render(<App />);
    await ready();
    await openTodo();
    fireEvent.click(screen.getByRole('button', { name: 'New task' }));
    const input = await screen.findByLabelText('New task title');
    fireEvent.change(input, { target: { value: 'Investigate 429s' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    const row = await waitFor(() => document.querySelector('[data-task-row]') as HTMLElement);
    await openMenu(within(row).getByLabelText('Actions for Investigate 429s'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Start Claude session' }));
    await waitFor(() => expect(ipc.spawnPty).toHaveBeenCalled());
    const spawn = lastCall(vi.mocked(ipc.spawnPty).mock.calls)[0];

    fireEvent.click(screen.getByRole('button', { name: /To-Do/ }));
    const done = await waitFor(() => within(
      document.querySelector('[data-task-row]') as HTMLElement,
    ).getByRole('checkbox'));
    fireEvent.click(done);

    await waitFor(() => {
      const saved = lastCall(vi.mocked(ipc.saveTasks).mock.calls)[0] as { done: boolean }[];
      expect(saved[0].done).toBe(true);
    });
    // The session it started is still open and still alive.
    expect(ipc.killPty).not.toHaveBeenCalledWith(spawn.tabId);
  });
});

describe('persistence', () => {
  it('saves every session with the project it is filed under', async () => {
    render(<App />);
    await ready();
    await waitFor(() => expect(ipc.saveWorkspace).toHaveBeenCalled());
    const state = lastCall(vi.mocked(ipc.saveWorkspace).mock.calls)[0];
    expect(state.tabs).toHaveLength(3);
    expect(state.tabs.find((t) => t.name === 'Alpha')?.projectDir).toBe('/proj');
    expect(state.tabs.find((t) => t.name === 'Loose thought')?.projectDir).toBeNull();
    // Ids are written back, so a linked To-Do still resolves next launch.
    expect(state.tabs.map((t) => t.id)).toEqual(['tab-alpha', 'tab-beta', 'tab-loose']);
  });

  it('closing a project keeps its sessions, in the Inbox', async () => {
    render(<App />);
    await ready();
    fireEvent.contextMenu(document.querySelector('[data-project-row]')!);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Remove project' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Remove project' }));

    await waitFor(() => expect(groupOfRow(sessionRow('Alpha'))).toBe('Inbox'));
    expect(ipc.killPty).not.toHaveBeenCalled();
  });
});

describe('grouped by day', () => {
  const fresh = (sessionId: string) => ({ sessionId, preview: '', lastUsedIso: new Date().toISOString() });
  // clearAllMocks keeps implementations, so the override below would leak.
  afterEach(() => {
    vi.mocked(ipc.listSessions).mockResolvedValue(['sess-a', 'sess-b', 'sess-c'].map(fresh));
  });

  it('folds a session nobody has touched for days into its day', async () => {
    const old = new Date(Date.now() - 5 * 86_400_000).toISOString();
    vi.mocked(ipc.listSessions).mockResolvedValue([
      fresh('sess-a'), { sessionId: 'sess-b', preview: '', lastUsedIso: old }, fresh('sess-c'),
    ]);
    render(<App />);
    await waitFor(() => expect(() => sessionRow('Beta')).toThrow());
    sessionRow('Alpha');

    await userEvent.click(screen.getByRole('button', { expanded: false, name: /This week/ }));
    expect(sessionRow('Beta')).toBeInTheDocument();
  });

  it('going into a project shows only its sessions, under its name, with a way back', async () => {
    render(<App />);
    await ready();
    await userEvent.click(document.querySelector('[data-project-row]')!);

    const header = document.querySelector('[data-scope-header]') as HTMLElement;
    expect(header).toHaveTextContent('proj');
    await waitFor(() => expect(() => sessionRow('Loose thought')).toThrow());
    sessionRow('Alpha');
    sessionRow('Beta');
    // Nothing of this project is on screen yet, so the main area shows the
    // project rather than a terminal from elsewhere.
    expect(screen.getByRole('heading', { name: 'proj' })).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Back to all projects'));
    expect(document.querySelector('[data-scope-header]')).toBeNull();
    expect(sessionRow('Loose thought')).toBeInTheDocument();
  });

  it('⌘N inside a project offers that project first', async () => {
    render(<App />);
    await ready();
    await userEvent.click(document.querySelector('[data-project-row]')!);
    fireEvent.keyDown(window, { key: 'n', metaKey: true });
    expect(await screen.findByRole('radio', { name: /proj/ })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('destructive actions', () => {
  it('closing a session asks first, and Cancel leaves it running', async () => {
    render(<App />);
    await ready();

    await openMenu(within(sessionRow('Alpha')).getByLabelText('Actions for Alpha'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Close session' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(sessionRow('Alpha')).toBeInTheDocument();
    expect(ipc.killPty).not.toHaveBeenCalled();

    await openMenu(within(sessionRow('Alpha')).getByLabelText('Actions for Alpha'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Close session' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Close session' }));
    await waitFor(() => expect(() => sessionRow('Alpha')).toThrow());
    expect(ipc.killPty).toHaveBeenCalledWith('tab-alpha');
  });
});

describe('archiving', () => {
  it('takes a session out of the list without closing it', async () => {
    render(<App />);
    await ready();
    fireEvent.click(sessionRow('Alpha'));
    await waitFor(() => expect(painted()).toEqual(['tab-alpha']));

    await openMenu(within(sessionRow('Alpha')).getByLabelText('Actions for Alpha'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Archive' }));

    // Out of Today and into a group of its own, which is folded by default.
    await waitFor(() => expect(groupOfRow(sessionRow('Beta'))).toContain('proj'));
    expect(() => sessionRow('Alpha')).toThrow();
    expect(screen.getByRole('button', { expanded: false, name: /Archived/ })).toBeInTheDocument();

    // Still in the workspace, so it still persists and can come back.
    await waitFor(() => {
      const state = lastCall(vi.mocked(ipc.saveWorkspace).mock.calls)[0];
      expect(state.tabs.find((t) => t.name === 'Alpha')?.archived).toBe(true);
    });
  });
});

describe('the pane grid', () => {
  function panes() {
    return [...document.querySelectorAll('[data-pane]')] as HTMLElement[];
  }

  it('opens another session beside this one, inside the same tab', async () => {
    render(<App />);
    await ready();
    fireEvent.click(sessionRow('Alpha'));
    await waitFor(() => expect(painted()).toEqual(['tab-alpha']));

    await openMenu(within(sessionRow('Beta')).getByLabelText('Actions for Beta'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Open beside current' }));

    await waitFor(() => expect(panes()).toHaveLength(2));
    expect(painted().sort()).toEqual(['tab-alpha', 'tab-beta']);
    // Its own view is named by tool; the guest by its session.
    expect(activeTabLabels()).toEqual(['Claude', 'Beta']);
    expect(sessionTabs()).toEqual(['Alpha']);
  });

  it('closing a pane leaves its session open and running', async () => {
    render(<App />);
    await ready();
    fireEvent.click(sessionRow('Alpha'));
    await openMenu(within(sessionRow('Beta')).getByLabelText('Actions for Beta'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Open beside current' }));
    await waitFor(() => expect(panes()).toHaveLength(2));

    await userEvent.click(screen.getByLabelText('Close Beta'));

    await waitFor(() => expect(panes()).toHaveLength(1));
    expect(sessionRow('Beta')).toBeInTheDocument();
    expect(ipc.killPty).not.toHaveBeenCalled();
  });
});

describe('the inspector', () => {
  it('sits beside the terminal, not under it', async () => {
    // It used to be a sibling of the pane grid *inside* main, and the grid is
    // `absolute inset-0` — so the grid painted straight over it.
    render(<App />);
    await ready();
    fireEvent.click(sessionRow('Alpha'));
    await waitFor(() => expect(painted()).toEqual(['tab-alpha']));
    fireEvent.click(screen.getByLabelText('Session details'));

    const inspector = await waitFor(() =>
      document.querySelector('[data-session-inspector]') as HTMLElement);
    expect(inspector.closest('[data-terminal-area]')).toBeNull();
    // And it shares a row with the terminal area rather than overlapping it.
    expect(inspector.previousElementSibling).toHaveAttribute('data-terminal-area');
  });
});

describe('adding a shell', () => {
  function panes() {
    return [...document.querySelectorAll('[data-pane]')] as HTMLElement[];
  }

  it('splits a new shell beside Claude, in the same tab', async () => {
    render(<App />);
    await ready();
    fireEvent.click(sessionRow('Alpha'));
    await waitFor(() => expect(painted()).toEqual(['tab-alpha']));

    await userEvent.click(screen.getByLabelText('Split'));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Shell to the right/ }));

    // Two panes of one session: its Claude and a new shell, two real ptys,
    // still one tab and one row in the sidebar.
    await waitFor(() => expect(panes()).toHaveLength(2));
    expect(activeTabLabels()).toEqual(['Claude', 'Shell']);
    await waitFor(() => expect(painted().sort()).toEqual(['tab-alpha', 'tab-alpha::shell:1']));
    expect(sessionTabs()).toEqual(['Alpha']);
    expect([...document.querySelectorAll('[data-session-name]')]
      .filter((n) => n.textContent === 'Alpha')).toHaveLength(1);
  });

  it('each split is another shell, and closing one kills only that shell', async () => {
    render(<App />);
    await ready();
    fireEvent.click(sessionRow('Alpha'));
    await waitFor(() => expect(painted()).toEqual(['tab-alpha']));

    // Ctrl+Shift+D off macOS (jsdom isn't a Mac); ⌘D on one.
    fireEvent.keyDown(window, { key: 'd', ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(window, { key: 'd', ctrlKey: true, shiftKey: true, altKey: true });
    await waitFor(() => expect(panes()).toHaveLength(3));
    expect(activeTabLabels().sort()).toEqual(['Claude', 'Shell', 'Shell 2']);

    await userEvent.click(screen.getByLabelText('Close Shell 2'));
    await waitFor(() => expect(panes()).toHaveLength(2));
    expect(ipc.killPty).toHaveBeenCalledWith('tab-alpha::shell:2');
    expect(ipc.killPty).not.toHaveBeenCalledWith('tab-alpha');
  });
});

describe('closing a tab with splits', () => {
  it('kills its split shells, so the next split is a fresh one', async () => {
    render(<App />);
    await ready();
    fireEvent.click(sessionRow('Alpha'));
    await waitFor(() => expect(painted()).toEqual(['tab-alpha']));
    fireEvent.keyDown(window, { key: 'd', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(painted().sort()).toEqual(['tab-alpha', 'tab-alpha::shell:1']));
    await waitFor(() => expect(vi.mocked(ipc.spawnPty).mock.calls.some((c) => c[0].tabId === 'tab-alpha::shell:1')).toBe(true));

    await userEvent.click(screen.getByLabelText('Close tab Alpha'));
    expect(ipc.killPty).toHaveBeenCalledWith('tab-alpha::shell:1');
    expect(ipc.killPty).not.toHaveBeenCalledWith('tab-alpha');

    vi.mocked(ipc.spawnPty).mockClear();
    fireEvent.click(sessionRow('Alpha'));
    fireEvent.keyDown(window, { key: 'd', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(vi.mocked(ipc.spawnPty).mock.calls.some((c) => c[0].tabId === 'tab-alpha::shell:1')).toBe(true));
  });
});

describe('the logbook', () => {
  it('opens from the usage meter as a tab of its own, beside the sessions', async () => {
    const soon = new Date(Date.now() + 3600_000).toISOString();
    vi.mocked(ipc.getSessionUsageStats).mockResolvedValue({
      available: true, session: { percent: 42, resetsAtIso: soon }, week: { percent: 18, resetsAtIso: soon },
      fetchedAtMs: Date.now(), fromCache: false,
    } as never);
    render(<App />);
    await ready();
    fireEvent.click(sessionRow('Alpha'));
    await waitFor(() => expect(painted()).toEqual(['tab-alpha']));

    await userEvent.click(await screen.findByLabelText('Open the logbook'));
    const logbook = () => document.querySelector('[data-extra-tab]') as HTMLElement | null;
    await waitFor(() => expect(logbook()).toHaveAttribute('aria-selected', 'true'));
    // Nothing of Alpha's is painted while the logbook is up, but its tab stays.
    expect(painted()).toEqual([]);
    expect(sessionTabs()).toEqual(['Alpha']);
    expect(currentSessionTab()).toBeNull();

    // Back to the session; the logbook keeps its tab until closed.
    fireEvent.mouseDown(document.querySelector('[data-session-tab]')!, { button: 0 });
    await waitFor(() => expect(painted()).toEqual(['tab-alpha']));
    expect(logbook()).toHaveAttribute('aria-selected', 'false');
    await userEvent.click(screen.getByLabelText('Close tab Logbook'));
    expect(logbook()).toBeNull();
  });
});

describe('starting a session', () => {
  it('⌘N twice still starts Claude with no questions asked', async () => {
    render(<App />);
    await ready();
    fireEvent.keyDown(window, { key: 'n', metaKey: true });
    await screen.findByRole('dialog', { name: 'New session' });
    fireEvent.keyDown(window, { key: 'n', metaKey: true });

    await waitFor(() => expect(ipc.spawnPty).toHaveBeenCalledTimes(1));
    expect(lastCall(vi.mocked(ipc.spawnPty).mock.calls)[0].kind).toBe('claude');
    expect(ipc.pickFolder).not.toHaveBeenCalled();
  });

  it('can start Claude and its shell together, laid out up front', async () => {
    // The layout is chosen at the moment you start something, because that is
    // when you already know which kind of job this is.
    render(<App />);
    await ready();

    await userEvent.click(screen.getByRole('button', { name: /New session/ }));
    await userEvent.click(await screen.findByRole('radio', { name: /Claude \+ Shell/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Start session' }));

    await waitFor(() => expect(document.querySelectorAll('[data-pane-tab]')).toHaveLength(2));
    const spawned = vi.mocked(ipc.spawnPty).mock.calls.map((c) => c[0].kind);
    expect(spawned).toContain('claude');
    expect(spawned).toContain('powershell');
    // Two ptys, one session, one row in the sidebar.
    await waitFor(() => expect(document.querySelectorAll('[data-session-row]')).toHaveLength(4));
  });

  it('can start a plain shell with no Claude at all', async () => {
    render(<App />);
    await ready();

    await userEvent.click(screen.getByRole('button', { name: /New session/ }));
    await userEvent.click(await screen.findByRole('radio', { name: /^Shell/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Start session' }));

    await waitFor(() => expect(ipc.spawnPty).toHaveBeenCalled());
    const spawn = lastCall(vi.mocked(ipc.spawnPty).mock.calls)[0];
    expect(spawn.kind).toBe('powershell');
    expect(spawn.cwd).toMatch(/\.tmt[/\\]scratch[/\\]/);
  });
});

describe('the file explorer', () => {
  // The reported bug: the menu is portaled outside the peeked panel, so the
  // click on its item counted as "outside", closed the panel, and unmounted
  // the menu before the item could fire. Nothing opened.
  it('Show in Finder works from a peeked panel', async () => {
    render(<App />);
    await ready();
    await userEvent.click(screen.getByLabelText('Show files'));
    const panel = await waitFor(() => {
      const el = document.querySelector('[data-files-panel]');
      if (!el) throw new Error('no files panel');
      return el as HTMLElement;
    });

    fireEvent.contextMenu(within(panel).getByText('proj'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Show in Finder' }));

    expect(ipc.revealInFileManager).toHaveBeenCalledWith('/proj');
  });
});

describe('the New session dialog', () => {
  it('starts in the picked project, under the name you gave it', async () => {
    render(<App />);
    await ready();

    await userEvent.click(screen.getByRole('button', { name: /New session/ }));
    await userEvent.click(await screen.findByRole('radio', { name: /proj/ }));
    await userEvent.type(screen.getByLabelText(/^Name/), 'ABC-1 move repo');
    await userEvent.click(screen.getByRole('button', { name: 'Start session' }));

    await waitFor(() => expect(ipc.spawnPty).toHaveBeenCalled());
    expect(lastCall(vi.mocked(ipc.spawnPty).mock.calls)[0].cwd).toBe('/proj');
    expect(ipc.createScratchDir).not.toHaveBeenCalled();
    await waitFor(() => expect(groupOfRow(sessionRow('ABC-1 move repo'))).toBe('proj'));
  });

  it('Cancel starts nothing', async () => {
    render(<App />);
    await ready();
    await userEvent.click(screen.getByRole('button', { name: /New session/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(ipc.spawnPty).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('dragging tabs around the workspace', () => {
  /** A dataTransfer whose `types` grows as `setData` is called, like the real
   *  one — the drop targets decide from `types` during dragover, where
   *  `getData` is blocked. */
  function fakeDataTransfer() {
    const store = new Map<string, string>();
    return {
      get types() { return [...store.keys()]; },
      setData: (t: string, v: string) => { store.set(t, v); },
      getData: (t: string) => store.get(t) ?? '',
      effectAllowed: '',
      dropEffect: '',
    };
  }

  it('a session dragged from the sidebar onto a pane edge splits it', async () => {
    render(<App />);
    await ready();
    fireEvent.click(sessionRow('Alpha'));
    await waitFor(() => expect(painted()).toEqual(['tab-alpha']));
    expect(document.querySelectorAll('[data-pane]')).toHaveLength(1);

    const tab = sessionRow('Beta');
    const dataTransfer = fakeDataTransfer();
    fireEvent.dragStart(tab, { dataTransfer });

    // Drop zones only exist mid-drag, exactly as a real pointer would meet them.
    const zone = await waitFor(() => {
      const z = document.querySelector('[data-pane] .z-30') as HTMLElement;
      expect(z).not.toBeNull();
      return z;
    });
    Object.defineProperty(zone, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 400, height: 200, right: 400, bottom: 200 }),
    });
    for (const type of ['dragOver', 'drop'] as const) {
      const ev = createEvent[type](zone, { dataTransfer });
      Object.defineProperty(ev, 'clientX', { value: 390 });
      Object.defineProperty(ev, 'clientY', { value: 100 });
      fireEvent(zone, ev);
    }

    // Two panes, one tab each, both terminals live.
    await waitFor(() => expect(document.querySelectorAll('[data-pane]')).toHaveLength(2));
    expect(painted().sort()).toEqual(['tab-alpha', 'tab-beta']);
    expect(activeTabLabels().sort()).toEqual(['Beta', 'Claude']);
  });
});
