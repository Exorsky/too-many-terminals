import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionUsageStats } from '@/types';

vi.mock('@/lib/ipc');

import * as ipc from '@/lib/ipc';
import UsageMeter, { formatDuration } from './UsageMeter';

const IN_2H = new Date(Date.now() + 2 * 60 * 60 * 1000 + 60 * 1000).toISOString();
const IN_3D = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

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

describe('UsageMeter', () => {
  it('renders nothing when neither the API nor the cache had anything', async () => {
    mockStats({ available: false, session: null, week: null, fetchedAtMs: null, fromCache: false });
    const { container } = render(<UsageMeter />);
    await vi.waitFor(() => expect(ipc.getSessionUsageStats).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the official percentage and reset countdown for both windows', async () => {
    mockStats(STATS);
    render(<UsageMeter />);

    expect(await screen.findByText('14%')).toBeInTheDocument();
    expect(screen.getByText('16%')).toBeInTheDocument();
    expect(screen.getByText(/resets in 2h/)).toBeInTheDocument();
    expect(screen.getByText(/resets in 3d/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Session usage' })).toHaveAttribute('aria-valuenow', '14');
  });

  it('omits a window the API did not report', async () => {
    mockStats({ ...STATS, week: null });
    render(<UsageMeter />);
    await screen.findByText('14%');
    expect(screen.queryByText('This week')).not.toBeInTheDocument();
  });

  it('flags a stale cached fallback rather than passing it off as live', async () => {
    mockStats({ ...STATS, fromCache: true, fetchedAtMs: Date.now() - 90 * 60 * 1000 });
    render(<UsageMeter />);
    expect(await screen.findByText('cached — as of 1h 30m ago')).toBeInTheDocument();
  });

  it('does not age a live fetch, however long the app has been open', async () => {
    mockStats({ ...STATS, fromCache: false, fetchedAtMs: Date.now() - 90 * 60 * 1000 });
    render(<UsageMeter />);
    await screen.findByText('14%');
    expect(screen.queryByText(/cached/)).not.toBeInTheDocument();
  });
});
