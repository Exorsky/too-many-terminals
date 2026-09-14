import { cleanup, fireEvent, render, screen, waitFor, createEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ipc', () => {
  const ok = (v: unknown) => vi.fn().mockResolvedValue(v);
  const noop = () => {};
  return {
    listShells: ok([{ id: 'powershell', label: 'PowerShell', command: 'pwsh' }]),
    homeDir: ok('/home'),
    loadWorkspace: ok({
      projects: ['/proj'],
      collapsed: false,
      sessionNames: {},
      tabs: [
        { kind: 'claude', name: 'Alpha', shellId: null, resumeSessionId: 'sess-a', cwd: '/proj' },
        { kind: 'claude', name: 'Beta', shellId: null, resumeSessionId: 'sess-b', cwd: '/proj' },
        { kind: 'claude', name: 'Gamma', shellId: null, resumeSessionId: 'sess-c', cwd: '/proj' },
      ],
    }),
    saveWorkspace: ok(undefined),
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
    envNames: ok([]),
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

import App from './App';

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

function panes(c: HTMLElement) { return [...c.querySelectorAll('[data-pane]')] as HTMLElement[]; }

/** Tab ids whose terminal is actually painted, per pane. */
function paintedIn(pane: HTMLElement) {
  return [...pane.querySelectorAll('[data-testid^="term-"]')]
    .filter((n) => (n as HTMLElement).dataset.visible === 'true')
    .map((n) => (n as HTMLElement).getAttribute('data-testid')!.replace('term-', ''));
}
/** Tab names in a pane's strip. */
function stripOf(pane: HTMLElement) {
  return [...pane.querySelectorAll('[draggable="true"]')].map((n) => n.textContent?.replace(/×$/, '').trim());
}

/** Leave Home by picking a restored session out of the sidebar. */
async function enterSession(name: string) {
  const row = (await screen.findAllByText(name))[0];
  fireEvent.click(row);
}

/** Drag a tab out of its strip and drop it on `targetPane` at a normalised
 *  position. The drop zones only exist mid-drag, so they're found after the
 *  dragstart, exactly as a real pointer would meet them. */
async function dragTabOnto(tab: HTMLElement, targetPane: () => HTMLElement, x: number, y: number) {
  const dt = {
    _d: new Map<string, string>(),
    get types() { return [...this._d.keys()]; },
    setData(t: string, v: string) { this._d.set(t, v); },
    getData(t: string) { return this._d.get(t) ?? ''; },
    effectAllowed: '', dropEffect: '',
  };
  fireEvent.dragStart(tab, { dataTransfer: dt });

  let zone: HTMLElement | null = null;
  await waitFor(() => {
    zone = targetPane().querySelector('.z-30');
    expect(zone, 'drop zones never appeared').not.toBeNull();
  });
  const z = zone!;
  Object.defineProperty(z, 'getBoundingClientRect', {
    value: () => ({ left: 0, top: 0, width: 400, height: 200, right: 400, bottom: 200 }),
  });
  for (const type of ['dragOver', 'drop'] as const) {
    const ev = createEvent[type](z, { dataTransfer: dt });
    Object.defineProperty(ev, 'clientX', { value: x });
    Object.defineProperty(ev, 'clientY', { value: y });
    fireEvent(z, ev);
  }
}

describe('App pane integration', () => {
  it('restores sessions into one pane and paints the one you enter', async () => {
    const { container } = render(<App />);
    await waitFor(() => expect(screen.getAllByText('Alpha').length).toBeGreaterThan(0));
    await enterSession('Alpha');

    await waitFor(() => expect(panes(container).length).toBe(1));
    expect(paintedIn(panes(container)[0])).toHaveLength(1);
  });

  it('a tab dropped on a pane edge splits, and BOTH panes paint', async () => {
    const { container } = render(<App />);
    await waitFor(() => expect(screen.getAllByText('Alpha').length).toBeGreaterThan(0));
    await enterSession('Alpha');
    await enterSession('Beta');
    await waitFor(() => expect(stripOf(panes(container)[0]).length).toBe(3));

    const tab = panes(container)[0].querySelectorAll('[draggable="true"]')[0] as HTMLElement;
    await dragTabOnto(tab, () => panes(container)[0], 390, 100);

    await waitFor(() => expect(panes(container).length).toBe(2));
    const [p1, p2] = panes(container);
    console.log('pane1 strip', stripOf(p1), 'painted', paintedIn(p1));
    console.log('pane2 strip', stripOf(p2), 'painted', paintedIn(p2));
    expect(paintedIn(p1), 'left pane paints nothing').toHaveLength(1);
    expect(paintedIn(p2), 'right pane paints nothing').toHaveLength(1);
    // And it landed where it was dropped, not back where it came from.
    expect(stripOf(p2)).toEqual(['Alpha']);
    expect(stripOf(p1)).not.toContain('Alpha');
  });

  it('a drop in the middle moves the tab into that pane', async () => {
    const { container } = render(<App />);
    await waitFor(() => expect(screen.getAllByText('Alpha').length).toBeGreaterThan(0));
    await enterSession('Alpha');
    await waitFor(() => expect(stripOf(panes(container)[0]).length).toBe(3));

    // split one off so there are two panes to move between
    let tab = panes(container)[0].querySelectorAll('[draggable="true"]')[0] as HTMLElement;
    await dragTabOnto(tab, () => panes(container)[0], 390, 100);
    await waitFor(() => expect(panes(container).length).toBe(2));

    // now drag another tab from the left pane into the right pane's middle
    tab = panes(container)[0].querySelectorAll('[draggable="true"]')[0] as HTMLElement;
    const name = tab.textContent?.replace(/×$/, '').trim();
    await dragTabOnto(tab, () => panes(container)[1], 200, 100);

    const [p1, p2] = panes(container);
    expect(panes(container).length).toBe(2);
    expect(stripOf(p2)).toContain(name);
    expect(stripOf(p1)).not.toContain(name);
    expect(paintedIn(p1)).toHaveLength(1);
    expect(paintedIn(p2)).toHaveLength(1);
  });

  it('a drop on the empty run of a strip moves the tab into that pane', async () => {
    const { container } = render(<App />);
    await waitFor(() => expect(screen.getAllByText('Alpha').length).toBeGreaterThan(0));
    await enterSession('Alpha');
    await waitFor(() => expect(stripOf(panes(container)[0]).length).toBe(3));

    let tab = panes(container)[0].querySelectorAll('[draggable="true"]')[0] as HTMLElement;
    await dragTabOnto(tab, () => panes(container)[0], 390, 100);
    await waitFor(() => expect(panes(container).length).toBe(2));

    // Drop on the right pane's strip itself, past its only tab — this used to
    // hit no handler, so the tab stayed in the pane it came from.
    tab = panes(container)[0].querySelectorAll('[draggable="true"]')[0] as HTMLElement;
    const name = tab.textContent?.replace(/×$/, '').trim();
    const dt = {
      _d: new Map<string, string>(),
      get types() { return [...this._d.keys()]; },
      setData(t: string, v: string) { this._d.set(t, v); },
      getData(t: string) { return this._d.get(t) ?? ''; },
      effectAllowed: '', dropEffect: '',
    };
    fireEvent.dragStart(tab, { dataTransfer: dt });
    const strip = panes(container)[1].querySelector('.h-8') as HTMLElement;
    fireEvent(strip, createEvent.dragOver(strip, { dataTransfer: dt }));
    fireEvent(strip, createEvent.drop(strip, { dataTransfer: dt }));

    await waitFor(() => expect(stripOf(panes(container)[1])).toContain(name));
    expect(stripOf(panes(container)[0])).not.toContain(name);
    for (const [i, pane] of panes(container).entries()) {
      expect(paintedIn(pane), `pane ${i} paints nothing`).toHaveLength(1);
    }
  });

  it('every pane of a three-pane L paints, including after a new session arrives', async () => {
    const { container } = render(<App />);
    await waitFor(() => expect(screen.getAllByText('Alpha').length).toBeGreaterThan(0));
    await enterSession('Alpha');
    await waitFor(() => expect(stripOf(panes(container)[0]).length).toBe(3));

    // split right, then split the new pane downwards -> L
    let tab = panes(container)[0].querySelectorAll('[draggable="true"]')[0] as HTMLElement;
    await dragTabOnto(tab, () => panes(container)[0], 390, 100);
    await waitFor(() => expect(panes(container).length).toBe(2));

    tab = panes(container)[0].querySelectorAll('[draggable="true"]')[0] as HTMLElement;
    await dragTabOnto(tab, () => panes(container)[0], 200, 195);
    await waitFor(() => expect(panes(container).length).toBe(3));

    for (const [i, pane] of panes(container).entries()) {
      expect(paintedIn(pane), `pane ${i} of the L paints nothing`).toHaveLength(1);
    }

    // entering another session from the sidebar must not blank anything
    await enterSession('Gamma');
    for (const [i, pane] of panes(container).entries()) {
      expect(paintedIn(pane), `pane ${i} blanked after a new session`).toHaveLength(1);
    }
  });
});
