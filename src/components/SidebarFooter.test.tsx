import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionUsageStats } from '@/types';

vi.mock('@/lib/ipc');

import * as ipc from '@/lib/ipc';
import SidebarFooter, { formatDuration } from './SidebarFooter';

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

function renderFooter(overrides: Partial<React.ComponentProps<typeof SidebarFooter>> = {}) {
  const props = {
    showHistory: false,
    showFiles: false,
    showSettings: false,
    onToggleHistory: vi.fn(),
    onToggleFiles: vi.fn(),
    onToggleSettings: vi.fn(),
    ...overrides,
  };
  render(<SidebarFooter {...props} />);
  return props;
}

const trigger = () => screen.getByRole('button', { name: 'History, files, settings' });

afterEach(cleanup);

describe('formatDuration', () => {
  it('shows hours and minutes under a day, days and hours beyond it', () => {
    expect(formatDuration(3 * 3600 + 25 * 60)).toBe('3h 25m');
    expect(formatDuration(9 * 60)).toBe('9m');
    expect(formatDuration(2 * 86400 + 5 * 3600)).toBe('2d 5h');
    expect(formatDuration(-30)).toBe('0m');
  });
});

describe('SidebarFooter', () => {
  it('keeps History/Files/Settings reachable even when usage is unavailable', async () => {
    mockStats({ available: false, session: null, week: null, fetchedAtMs: null, fromCache: false });
    const props = renderFooter();
    await vi.waitFor(() => expect(ipc.getSessionUsageStats).toHaveBeenCalled());

    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    await userEvent.click(trigger());
    await userEvent.click(await screen.findByText('History'));
    expect(props.onToggleHistory).toHaveBeenCalled();
  });

  it('shows both percentages on the trigger without opening the menu', async () => {
    mockStats(STATS);
    renderFooter();
    expect(await screen.findByText('14%')).toBeInTheDocument();
    expect(screen.getByText('16%')).toBeInTheDocument();
    expect(screen.queryByText(/resets in/)).not.toBeInTheDocument();
  });

  it('reveals reset countdowns and bars inside the menu', async () => {
    mockStats(STATS);
    renderFooter();
    await screen.findByText('14%');
    await userEvent.click(trigger());
    expect(await screen.findByText(/resets in 2h/)).toBeInTheDocument();
    expect(screen.getByText(/resets in 3d/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Session usage' })).toHaveAttribute('aria-valuenow', '14');
  });

  it('omits a window the API did not report', async () => {
    mockStats({ ...STATS, week: null });
    renderFooter();
    await screen.findByText('14%');
    expect(screen.queryByText('16%')).not.toBeInTheDocument();
    await userEvent.click(trigger());
    expect(screen.queryByText('This week')).not.toBeInTheDocument();
  });

  it('flags a stale cached fallback rather than presenting it as live', async () => {
    mockStats({ ...STATS, fromCache: true, fetchedAtMs: Date.now() - 90 * 60 * 1000 });
    renderFooter();
    await screen.findByText('14%');
    await userEvent.click(trigger());
    expect(await screen.findByText('cached — as of 1h 30m ago')).toBeInTheDocument();
  });

  it('checkmarks whichever of History/Files/Settings is currently open', async () => {
    mockStats(STATS);
    renderFooter({ showFiles: true });
    await screen.findByText('14%');
    await userEvent.click(trigger());
    const filesItem = (await screen.findByText('Files')).closest('[role="menuitem"]') as HTMLElement;
    expect(within(filesItem).getByTitle('Currently open')).toBeInTheDocument();
    const historyItem = screen.getByText('History').closest('[role="menuitem"]') as HTMLElement;
    expect(within(historyItem).queryByTitle('Currently open')).not.toBeInTheDocument();
  });
});
