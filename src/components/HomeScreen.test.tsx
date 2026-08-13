import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionStat, SessionUsageStats } from '@/types';

vi.mock('@/lib/ipc');

import * as ipc from '@/lib/ipc';
import HomeScreen from './HomeScreen';

const APP = 'C:\\code\\claude-terminal';
const FLOWS = 'C:\\code\\n8n-flows';
const day = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

function stat(over: Partial<SessionStat> = {}): SessionStat {
  return {
    sessionId: 's', lastUsedIso: day(1), startedIso: null, endedIso: null,
    turns: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
    model: null, preview: '', commands: [], ...over,
  };
}

const STATS: Record<string, SessionStat[]> = {
  [APP]: [
    stat({ sessionId: 'a1', turns: 10, preview: 'split the terminal', commands: [['git', 5], ['pnpm', 2]], model: 'claude-opus-4-8', outputTokens: 100, lastUsedIso: day(0) }),
    stat({ sessionId: 'a2', turns: 6, preview: 'why does the pty die', commands: [['cargo', 3]], lastUsedIso: day(2) }),
  ],
  [FLOWS]: [stat({ sessionId: 'b1', turns: 4, preview: 'webhook fires twice', commands: [['git', 1]], lastUsedIso: day(1) })],
};

const USAGE: SessionUsageStats = {
  available: true, session: { percent: 34, resetsAtIso: day(-1) }, week: { percent: 21, resetsAtIso: day(-4) },
  fetchedAtMs: Date.now(), fromCache: false,
};

function setup(projects: string[] = [APP, FLOWS]) {
  const onAddProject = vi.fn();
  const utils = render(<HomeScreen projects={projects} onAddProject={onAddProject} />);
  return { onAddProject, ...utils };
}

/** The big number rendered next to a headline unit label. */
function headlineValue(unit: string): string | null | undefined {
  return screen.getByText(unit).previousElementSibling?.textContent;
}

beforeEach(() => {
  vi.mocked(ipc.getSessionStats).mockImplementation((dir: string) => Promise.resolve(STATS[dir] ?? []));
  vi.mocked(ipc.getSessionUsageStats).mockResolvedValue(USAGE);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('HomeScreen dashboard', () => {
  it('rolls session stats into the headline readout', async () => {
    setup();
    await screen.findByText('sessions');
    expect(headlineValue('sessions')).toBe('3');
    expect(headlineValue('turns')).toBe('20'); // 10 + 6 + 4
  });

  it('ranks shell commands merged across sessions', async () => {
    setup();
    await screen.findByText('Top commands');
    // git: 5 (app) + 1 (flows) = 6, the busiest
    const git = await screen.findByText('git');
    const value = git.closest('.grid')?.querySelector('.tabular-nums')?.textContent;
    expect(value).toBe('6');
  });

  it('counts sessions per folder', async () => {
    setup();
    expect(await screen.findByText('claude-terminal')).toBeInTheDocument();
    expect(screen.getByText('n8n-flows')).toBeInTheDocument();
  });

  it('shows the live rate-limit percentages', async () => {
    setup();
    expect(await screen.findByText('34%')).toBeInTheDocument();
    expect(screen.getByText('21%')).toBeInTheDocument();
  });

  it('reveals the session prompt in serif on hover', async () => {
    const { container } = setup();
    await screen.findByText('sessions');
    const marks = container.querySelectorAll<HTMLElement>('.dash-mark');
    expect(marks.length).toBeGreaterThan(0);
    // earliest lit day in view is a2, two days ago
    await userEvent.hover(marks[0]);
    await waitFor(() => expect(screen.getByText('why does the pty die')).toBeInTheDocument());
  });

  it('switches the active time range', async () => {
    setup();
    const all = await screen.findByRole('button', { name: 'All' });
    const thirty = screen.getByRole('button', { name: '30 days' });
    expect(thirty).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(all);
    expect(all).toHaveAttribute('aria-pressed', 'true');
    expect(thirty).toHaveAttribute('aria-pressed', 'false');
  });

  it('invites the user to open a folder when none are open', async () => {
    const { onAddProject } = setup([]);
    expect(await screen.findByText(/fills in your logbook/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /open folder/i }));
    expect(onAddProject).toHaveBeenCalled();
  });
});
