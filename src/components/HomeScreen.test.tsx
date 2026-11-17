import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionStat, SessionUsageStats } from '@/types';

vi.mock('@/lib/ipc');

import * as ipc from '@/lib/ipc';
import { resetUsageForTest } from '@/lib/usage-store';
import HomeScreen from './HomeScreen';

const APP = 'C:\\code\\claude-terminal';
const FLOWS = 'C:\\code\\my-flows';
const day = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

function stat(over: Partial<SessionStat> = {}): SessionStat {
  return {
    sessionId: 's', lastUsedIso: day(1), startedIso: null, endedIso: null,
    turns: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
    model: null, preview: '', commands: [], writes: [], reads: 0, edits: 0, shell: 0, ...over,
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
  const onOpenSession = vi.fn();
  const utils = render(<HomeScreen projects={projects} onAddProject={onAddProject} onOpenSession={onOpenSession} />);
  return { onAddProject, onOpenSession, ...utils };
}

/** The big number on a KPI tile, found by the tile's label. */
function kpiValue(label: string): string | null | undefined {
  return screen.getByRole('heading', { name: label }).nextElementSibling?.querySelector('span')?.textContent;
}

beforeEach(() => {
  vi.mocked(ipc.getSessionStats).mockImplementation((dir: string) => Promise.resolve(STATS[dir] ?? []));
  vi.mocked(ipc.getSessionUsageStats).mockResolvedValue(USAGE);
});

afterEach(() => {
  cleanup();
  resetUsageForTest();
  vi.clearAllMocks();
});

describe('HomeScreen dashboard', () => {
  it('rolls session stats into the KPI tiles', async () => {
    setup();
    await screen.findByRole('heading', { name: 'Sessions' });
    expect(kpiValue('Sessions')).toBe('3');
    expect(kpiValue('Total tokens')).toBe('100');
    expect(kpiValue('Avg / turn')).toBe('5'); // 100 tokens over 10 + 6 + 4 turns
  });

  it('stacks each day\'s tokens and reads the day out on hover', async () => {
    const { container } = setup();
    await screen.findByRole('heading', { name: 'Token flow' });
    const caption = container.querySelector('[data-flow-caption]')!;
    // Nothing pointed at: the peak day speaks for the chart.
    expect(caption.textContent).toContain('peak');
    const days = container.querySelectorAll<HTMLElement>('[data-day]');
    expect(days).toHaveLength(30);
    await userEvent.hover(days[days.length - 2]); // yesterday: b1, no tokens
    await waitFor(() => expect(caption.textContent).toContain('0 tokens'));
    await userEvent.hover(days[days.length - 1]); // today: a1's 100 output tokens
    await waitFor(() => expect(caption.textContent).toContain('100 tokens'));
    expect(caption.textContent).toContain('output 100');
    expect(caption.textContent).toContain('1 session');
  });

  it('ranks shell commands merged across sessions', async () => {
    setup();
    await screen.findByText('Top commands');
    // git: 5 (app) + 1 (flows) = 6, the busiest
    const git = await screen.findByText('git');
    const value = git.closest('.grid')?.querySelector('.tabular-nums')?.textContent;
    expect(value).toBe('6');
  });

  it('ranks folders by the tokens they used, with their share', async () => {
    const { container } = setup();
    await screen.findByRole('heading', { name: 'Project consumption' });
    const rows = [...container.querySelectorAll('[data-project-tokens]')].map((r) => r.textContent);
    expect(rows).toEqual(['claude-terminal100100%', 'my-flows00%']);
  });

  it('does not compare against history the 50-per-folder cap cut off', async () => {
    // 50 sessions in the last 10 days: the folder hit the cap, so nothing
    // before them was read — neither the previous 30 days nor this window's start.
    const busy = Array.from({ length: 50 }, (_, i) => stat({ sessionId: `x${i}`, lastUsedIso: day(i % 10), outputTokens: 1, turns: 1 }));
    vi.mocked(ipc.getSessionStats).mockResolvedValue(busy);
    const { container } = setup([APP]);
    await screen.findByRole('heading', { name: 'Sessions' });
    expect(screen.getAllByText('earlier history not loaded')).toHaveLength(4);
    expect(container.querySelector('[data-window-cut]')).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '7 days' }));
    expect(container.querySelector('[data-window-cut]')).toBeNull();
  });

  it('opens a session named on the dashboard', async () => {
    const { container, onOpenSession } = setup();
    await screen.findByRole('heading', { name: 'Largest sessions' });
    // a1 is both the biggest and the latest; the largest list names it first.
    const rows = container.querySelectorAll<HTMLElement>('[data-open-session="a1"]');
    expect(rows).toHaveLength(2);
    await userEvent.click(rows[0]);
    expect(onOpenSession).toHaveBeenCalledWith(APP, { sessionId: 'a1', preview: 'split the terminal', lastUsedIso: expect.any(String) });
  });

  it('shows the live rate-limit percentages', async () => {
    setup();
    expect(await screen.findByText('34%')).toBeInTheDocument();
    expect(screen.getByText('21%')).toBeInTheDocument();
  });

  it('reads out a day\'s totals on hover', async () => {
    const { container } = setup();
    await screen.findByRole('heading', { name: 'Sessions' });
    const lit = container.querySelectorAll<HTMLElement>('.dash-mark');
    expect(lit.length).toBe(3); // three days, one session each
    // earliest lit day in view is a2, two days ago — 100 output tokens ran on a1 only
    await userEvent.hover(lit[0]);
    await waitFor(() => expect(screen.getByText('1 session')).toBeInTheDocument());
    // Also named by the per-folder panel below, hence "all".
    expect(screen.getAllByText('claude-terminal').length).toBeGreaterThan(1);
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
