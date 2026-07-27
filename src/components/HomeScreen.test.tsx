import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionHistoryEntry, Tab } from '@/types';

vi.mock('@/lib/ipc');

import * as ipc from '@/lib/ipc';
import HomeScreen, { warmth } from './HomeScreen';

function entry(id: string, preview: string, iso: string): SessionHistoryEntry {
  return { sessionId: id, preview, lastUsedIso: iso };
}

const APP = 'C:\\code\\claude-terminal';
const FLOWS = 'C:\\code\\n8n-flows';

const SESSIONS: Record<string, SessionHistoryEntry[]> = {
  [APP]: [
    entry('a1', 'split the terminal beside the transcript', '2026-07-27T00:10:00Z'),
    entry('a2', 'why does the pty die when dormant', '2026-07-26T09:00:00Z'),
  ],
  [FLOWS]: [entry('b1', 'webhook fires twice on retry', '2026-07-20T09:00:00Z')],
};

function liveTab(over: Partial<Tab> = {}): Tab {
  return {
    id: 'tab-1', kind: 'claude', name: 'Claude', shellId: null, cwd: APP,
    resumeSessionId: null, exited: false, status: 'working', ...over,
  };
}

function setup(projects: string[] = [APP, FLOWS], tabs: Tab[] = []) {
  const onResume = vi.fn();
  const onSelectTab = vi.fn();
  const onNewSession = vi.fn();
  const onAddProject = vi.fn();
  const onOpenHistory = vi.fn();
  render(
    <HomeScreen
      projects={projects}
      tabs={tabs}
      onResume={onResume}
      onSelectTab={onSelectTab}
      onNewSession={onNewSession}
      onAddProject={onAddProject}
      onOpenHistory={onOpenHistory}
    />,
  );
  return { onResume, onSelectTab, onNewSession, onAddProject, onOpenHistory };
}

beforeEach(() => {
  vi.mocked(ipc.listSessions).mockImplementation((dir: string) =>
    Promise.resolve(SESSIONS[dir] ?? []),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('HomeScreen', () => {
  it('draws one lit window per past session, labelled for screen readers', async () => {
    setup();
    const windows = await screen.findAllByRole('button', { name: /^Resume session in/ });
    expect(windows).toHaveLength(3);
    expect(windows.some((w) => w.getAttribute('aria-label')?.includes('webhook fires twice'))).toBe(true);
  });

  it('orders towers by last activity, most recent first', async () => {
    setup();
    await screen.findAllByRole('button', { name: /^Resume session in/ });
    const plates = screen.getAllByRole('button', { name: /^New session in/ });
    expect(plates[0]).toHaveAccessibleName('New session in claude-terminal');
    expect(plates[1]).toHaveAccessibleName('New session in n8n-flows');
  });

  it('resumes the clicked session', async () => {
    const { onResume } = setup();
    const win = await screen.findByRole('button', { name: /webhook fires twice/ });
    await userEvent.click(win);
    expect(onResume).toHaveBeenCalledWith(FLOWS, SESSIONS[FLOWS][0]);
  });

  it('shows the session preview while a window is hovered', async () => {
    setup();
    const win = await screen.findByRole('button', { name: /webhook fires twice/ });
    expect(screen.getByText('Nothing running')).toBeInTheDocument();
    await userEvent.hover(win);
    await waitFor(() => expect(screen.getByText('webhook fires twice on retry')).toBeInTheDocument());
  });

  it('starts a new session in the folder whose plate is clicked', async () => {
    const { onNewSession } = setup();
    await screen.findAllByRole('button', { name: /^Resume session in/ });
    await userEvent.click(screen.getByRole('button', { name: 'New session in n8n-flows' }));
    expect(onNewSession).toHaveBeenCalledWith(FLOWS);
  });

  it('invites the user to open a folder when none are open', async () => {
    const { onAddProject } = setup([]);
    expect(await screen.findByText(/every session you run there adds a window/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Resume session in/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /open folder/i }));
    expect(onAddProject).toHaveBeenCalled();
  });

  it('keeps a folder with no sessions as an empty tower', async () => {
    setup(['C:\\code\\fresh']);
    const plate = await screen.findByRole('button', { name: /^New session in/ });
    expect(within(plate).getByText('0')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Resume session in/ })).not.toBeInTheDocument();
  });

  it('moves focus between floors of a tower with the arrow keys', async () => {
    setup();
    const windows = await screen.findAllByRole('button', { name: /^Resume session in/ });
    const top = windows[0];
    top.focus();
    // two sessions in this folder → a 2-column grid, so the second is one step right
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(windows[1]);
    await userEvent.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(top);
  });

  describe('live sessions', () => {
    it('marks a running window and opens its tab instead of resuming', async () => {
      const { onSelectTab, onResume } = setup([APP, FLOWS], [
        liveTab({ id: 'live-1', resumeSessionId: 'a1', status: 'working' }),
      ]);
      const win = await screen.findByRole('button', { name: /split the terminal beside.*Working/ });
      expect(win).toHaveClass('home-win-working');
      await userEvent.click(win);
      expect(onSelectTab).toHaveBeenCalledWith('live-1');
      expect(onResume).not.toHaveBeenCalled();
    });

    it('flags a session that is blocked on you', async () => {
      setup([APP, FLOWS], [liveTab({ resumeSessionId: 'a1', status: 'requires_response' })]);
      const win = await screen.findByRole('button', { name: /Waiting on you/ });
      expect(win).toHaveClass('home-win-waiting');
      expect(screen.getByText('1 waiting on you')).toBeInTheDocument();
    });

    it('gives a session with no history entry yet its own window', async () => {
      setup([APP, FLOWS], [liveTab({ id: 'fresh', resumeSessionId: null, name: 'Fresh run' })]);
      const win = await screen.findByRole('button', { name: /Open Fresh run in claude-terminal/ });
      expect(win).toHaveClass('home-win-live');
      // three recorded sessions plus the unrecorded one
      expect(document.querySelectorAll('.home-win-lit')).toHaveLength(4);
    });

    it('counts what is running instead of claiming nothing is', async () => {
      setup([APP, FLOWS], [
        liveTab({ id: 'l1', resumeSessionId: 'a1' }),
        liveTab({ id: 'l2', resumeSessionId: 'b1', cwd: FLOWS }),
      ]);
      expect(await screen.findByText('2 running')).toBeInTheDocument();
      expect(screen.queryByText('Nothing running')).not.toBeInTheDocument();
    });

    it('ignores exited and shell tabs', async () => {
      setup([APP, FLOWS], [
        liveTab({ id: 'dead', resumeSessionId: 'a1', exited: true }),
        liveTab({ id: 'sh', kind: 'shell', shellId: 'powershell', resumeSessionId: null }),
      ]);
      await screen.findAllByRole('button', { name: /^Resume session in/ });
      expect(screen.getByText('Nothing running')).toBeInTheDocument();
      expect(document.querySelector('.home-win-live')).toBeNull();
    });
  });

  describe('warmth', () => {
    const NOW = Date.parse('2026-07-27T12:00:00Z');
    const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

    it('cools with elapsed time, not with rank in the list', () => {
      expect(warmth(daysAgo(0), NOW)).toBeCloseTo(1, 2);
      expect(warmth(daysAgo(1), NOW)).toBeGreaterThan(warmth(daysAgo(7), NOW));
      expect(warmth(daysAgo(7), NOW)).toBeGreaterThan(warmth(daysAgo(30), NOW));
    });

    it('spends most of its range on the first week', () => {
      // a day-old session should still be clearly warmer than a week-old one
      expect(warmth(daysAgo(1), NOW) - warmth(daysAgo(7), NOW)).toBeGreaterThan(0.15);
    });

    it('bottoms out instead of going negative on ancient sessions', () => {
      expect(warmth(daysAgo(365), NOW)).toBe(0);
      expect(warmth(daysAgo(10_000), NOW)).toBe(0);
    });

    it('treats a future timestamp as brand new rather than over-bright', () => {
      expect(warmth(daysAgo(-3), NOW)).toBe(1);
    });
  });
});
