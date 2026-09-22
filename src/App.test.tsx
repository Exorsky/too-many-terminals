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
    listSessions: ok([]),
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
import App from './App';

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  resetTasksForTest();
});

/** The group a session row sits under, by walking back up the sidebar's flat
 *  list to the nearest heading — which is exactly how a reader finds it too. */
function groupOfRow(row: Element): string | null {
  let node: Element | null = row;
  while ((node = node.previousElementSibling)) {
    const heading = node.querySelector('span');
    if (node.matches('.mt-3') && heading) return heading.textContent;
    if (node.matches('[data-project-row]')) return node.textContent?.trim().replace(/\d+$/, '') ?? null;
  }
  return null;
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

/** The label of the active tab in each pane — what the strip says you are
 *  looking at. */
function activeTabLabels(): string[] {
  return [...document.querySelectorAll('[data-pane-tab][data-active]')]
    .map((n) => n.textContent?.replace(/×$/, '').trim() ?? '');
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

  it('shows one session list and no global session tabs', async () => {
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
    expect(activeTabLabels()).toEqual(['Alpha']);
  });

  it('gives a pane real tabs — draggable, closable, one per thing', async () => {
    render(<App />);
    await ready();
    fireEvent.click(sessionRow('Alpha'));
    await waitFor(() => expect(painted()).toEqual(['tab-alpha']));

    const tab = document.querySelector('[data-pane-tab]') as HTMLElement;
    expect(tab).toHaveAttribute('draggable', 'true');
    expect(within(tab).getByLabelText('Close Alpha')).toBeInTheDocument();
    expect(screen.getByLabelText('Add a tool to the workspace')).toBeInTheDocument();
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
  it('⌘N creates a usable Inbox session with no modal and no folder picker', async () => {
    render(<App />);
    await ready();

    fireEvent.keyDown(window, { key: 'n', metaKey: true });

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
    expect(activeTabLabels()).toEqual(['Alpha']);
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

    await waitFor(() => expect(groupOfRow(sessionRow('Alpha'))).toBe('Inbox'));
    expect(ipc.killPty).not.toHaveBeenCalled();
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

    // Out of the project group and into its own, which is folded by default.
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

  it('adds to the workspace as a tab, and splits only when you drag', async () => {
    render(<App />);
    await ready();
    fireEvent.click(sessionRow('Alpha'));
    await waitFor(() => expect(painted()).toEqual(['tab-alpha']));

    await openMenu(within(sessionRow('Beta')).getByLabelText('Actions for Beta'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Add to workspace…' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Claude' }));

    // One pane, two tabs. Geometry costs a drag, not a menu click.
    await waitFor(() => expect(document.querySelectorAll('[data-pane-tab]')).toHaveLength(2));
    expect(panes()).toHaveLength(1);
    expect(activeTabLabels()).toEqual(['Beta']);
    // And the sessions are still listed exactly once, in the sidebar.
    expect([...document.querySelectorAll('[data-session-name]')]
      .filter((n) => n.textContent === 'Alpha')).toHaveLength(1);
  });

  it('closing a tab leaves the session open and running', async () => {
    render(<App />);
    await ready();
    fireEvent.click(sessionRow('Alpha'));
    await openMenu(within(sessionRow('Beta')).getByLabelText('Actions for Beta'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Add to workspace…' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Claude' }));
    await waitFor(() => expect(document.querySelectorAll('[data-pane-tab]')).toHaveLength(2));

    await userEvent.click(screen.getByLabelText('Close Beta'));

    await waitFor(() => expect(document.querySelectorAll('[data-pane-tab]')).toHaveLength(1));
    // Still in the sidebar, still not killed: a tab is a view, not a life.
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
  it('is one visible button beside the tabs, not a buried menu', async () => {
    // The regression this guards: it used to live two levels deep in the
    // header's ⋯, which is not where anyone looks for "Shell" — the word is
    // right there in the tool strip.
    render(<App />);
    await ready();
    fireEvent.click(sessionRow('Alpha'));
    await waitFor(() => expect(painted()).toEqual(['tab-alpha']));

    await userEvent.click(screen.getByLabelText('Add a tool to the workspace'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Shell' }));

    // Two tabs of one session: its Claude and its own shell, two real ptys,
    // still one row in the sidebar.
    await waitFor(() => expect(document.querySelectorAll('[data-pane-tab]')).toHaveLength(2));
    expect(activeTabLabels()).toEqual(['Alpha · Shell']);
    await waitFor(() => expect(painted()).toEqual(['tab-alpha::shell']));
    expect([...document.querySelectorAll('[data-session-name]')]
      .filter((n) => n.textContent === 'Alpha')).toHaveLength(1);
  });

  it('can also be added straight from the sidebar', async () => {
    render(<App />);
    await ready();
    fireEvent.click(sessionRow('Alpha'));
    await waitFor(() => expect(painted()).toEqual(['tab-alpha']));

    await openMenu(within(sessionRow('Beta')).getByLabelText('Actions for Beta'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Add to workspace…' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Shell' }));

    await waitFor(() => expect(painted()).toEqual(['tab-beta::shell']));
  });
});

describe('starting a session', () => {
  it('⌘N still starts Claude with no questions asked', async () => {
    render(<App />);
    await ready();
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
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Claude + Shell' }));

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
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Shell' }));

    await waitFor(() => expect(ipc.spawnPty).toHaveBeenCalled());
    const spawn = lastCall(vi.mocked(ipc.spawnPty).mock.calls)[0];
    expect(spawn.kind).toBe('powershell');
    expect(spawn.cwd).toMatch(/\.tmt[/\\]scratch[/\\]/);
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

  it('a tab dragged onto a pane edge splits the grid', async () => {
    render(<App />);
    await ready();
    fireEvent.click(sessionRow('Alpha'));
    await openMenu(within(sessionRow('Beta')).getByLabelText('Actions for Beta'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Add to workspace…' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Claude' }));
    await waitFor(() => expect(document.querySelectorAll('[data-pane-tab]')).toHaveLength(2));
    expect(document.querySelectorAll('[data-pane]')).toHaveLength(1);

    const tab = document.querySelectorAll('[data-pane-tab]')[1] as HTMLElement;
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
    expect(activeTabLabels().sort()).toEqual(['Alpha', 'Beta']);
  });
});
