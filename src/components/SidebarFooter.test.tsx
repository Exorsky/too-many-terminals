import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionUsageStats } from '@/types';

vi.mock('@/lib/ipc');

import * as ipc from '@/lib/ipc';
import SidebarFooter, { formatDuration, paceFraction } from './SidebarFooter';

const IN_2H = new Date(Date.now() + 2 * 60 * 60 * 1000 + 60 * 1000).toISOString();
// +5h of slack so a slow test run can't round this down to "2d 23h" —
// formatDuration only needs to land somewhere in the "3d" range.
const IN_3D = new Date(Date.now() + (3 * 24 + 5) * 60 * 60 * 1000).toISOString();

const STATS: SessionUsageStats = {
  available: true,
  session: { percent: 14, resetsAtIso: IN_2H },
  week: { percent: 16, resetsAtIso: IN_3D },
  fetchedAtMs: Date.now(),
  fromCache: false,
};

function mockStats(stats: SessionUsageStats) {
  vi.mocked(ipc.getSessionUsageStats).mockResolvedValue(stats);
}

afterEach(cleanup);

describe('formatDuration', () => {
  it('shows hours and minutes under a day, days and hours beyond it', () => {
    expect(formatDuration(3 * 3600 + 25 * 60)).toBe('3h 25m');
    expect(formatDuration(9 * 60)).toBe('9m');
    expect(formatDuration(2 * 86400 + 5 * 3600)).toBe('2d 5h');
    expect(formatDuration(-30)).toBe('0m');
  });
});

describe('paceFraction', () => {
  const now = Date.parse('2026-01-01T12:00:00Z');
  const FIVE_HOURS = 5 * 3600;
  const at = (hoursAhead: number) => new Date(now + hoursAhead * 3600 * 1000).toISOString();

  it('is how much of the window the clock has already spent', () => {
    // Resets in 3h45m, so 1h15m of a 5h window is gone.
    expect(paceFraction(at(3.75), FIVE_HOURS, now)).toBeCloseTo(0.25, 5);
    expect(paceFraction(at(2.5), FIVE_HOURS, now)).toBeCloseTo(0.5, 5);
  });

  it('clamps rather than running off the bar', () => {
    // A cached reset time can sit in the past, or further out than the window.
    expect(paceFraction(at(-1), FIVE_HOURS, now)).toBe(1);
    expect(paceFraction(at(9), FIVE_HOURS, now)).toBe(0);
  });

  it('reads an unparseable time as the start of the window', () => {
    expect(paceFraction('not a date', FIVE_HOURS, now)).toBe(0);
  });
});

describe('SidebarFooter', () => {
  it('names each window rather than leaving two bare numbers', async () => {
    mockStats(STATS);
    render(<SidebarFooter />);

    expect(await screen.findByText('Session')).toBeInTheDocument();
    expect(screen.getByText('Week')).toBeInTheDocument();
    expect(screen.getByText('14%')).toBeInTheDocument();
    expect(screen.getByText('16%')).toBeInTheDocument();
  });

  it('shows the countdown to reset on the row itself, not behind a menu', async () => {
    mockStats(STATS);
    render(<SidebarFooter />);

    expect(await screen.findByText(/^2h/)).toBeInTheDocument();
    expect(screen.getByText(/^3d/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Session usage' })).toHaveAttribute('aria-valuenow', '14');
  });

  it('renders nothing at all when neither window is available', async () => {
    mockStats({ available: false, session: null, week: null, fetchedAtMs: null, fromCache: false });
    render(<SidebarFooter />);

    await vi.waitFor(() => expect(ipc.getSessionUsageStats).toHaveBeenCalled());
    expect(screen.queryByTestId('usage-meter')).not.toBeInTheDocument();
  });

  it('omits a window the API did not report', async () => {
    mockStats({ ...STATS, week: null });
    render(<SidebarFooter />);

    expect(await screen.findByText('Session')).toBeInTheDocument();
    expect(screen.queryByText('Week')).not.toBeInTheDocument();
  });

  it('flags a stale cached fallback rather than presenting it as live', async () => {
    mockStats({ ...STATS, fromCache: true, fetchedAtMs: Date.now() - 90 * 60 * 1000 });
    render(<SidebarFooter />);

    await screen.findByText('Session');
    expect(screen.getByTestId('usage-meter')).toHaveAttribute('title', 'cached — as of 1h 30m ago');
  });

  it('marks where the clock stands, so fill past it reads as burning fast', async () => {
    mockStats(STATS);
    render(<SidebarFooter />);

    await screen.findByText('Session');
    // 2h1m left of a 5h window: ~60% of the window gone against 14% used.
    const bar = screen.getByRole('progressbar', { name: 'Session usage' });
    expect(within(bar).getByTitle(/Behind the clock/)).toBeInTheDocument();
  });
});
