import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionUsageStats, UsageWindow } from '@/types';

vi.mock('@/lib/ipc');

import * as ipc from '@/lib/ipc';
import UsageMeter, { formatDuration, formatTokens } from './UsageMeter';

const EMPTY_WINDOW: UsageWindow = {
  tokensUsed: 0, blockStartIso: null, blockEndIso: null, estimatedLimitTokens: null, blocksSeen: 0,
};

const UNAVAILABLE: SessionUsageStats = {
  available: false, session: EMPTY_WINDOW, week: EMPTY_WINDOW, byModel: {}, cacheReadTokens: 0,
};

const ACTIVE_SESSION: UsageWindow = {
  tokensUsed: 45_200,
  blockStartIso: '2026-07-12T08:00:00.000Z',
  blockEndIso: new Date(Date.now() + 2 * 60 * 60 * 1000 + 60 * 1000).toISOString(), // ~2h1m out
  estimatedLimitTokens: 120_000,
  blocksSeen: 6,
};

const ACTIVE_WEEK: UsageWindow = {
  tokensUsed: 1_000_000,
  blockStartIso: '2026-07-10T00:00:00.000Z',
  blockEndIso: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(), // ~3d out
  estimatedLimitTokens: 4_000_000,
  blocksSeen: 8,
};

function mockStats(stats: SessionUsageStats) {
  vi.mocked(ipc.getSessionUsageStats).mockResolvedValue(stats);
}

afterEach(cleanup);

describe('formatTokens', () => {
  it('abbreviates thousands and millions', () => {
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(12_400)).toBe('12k');
    expect(formatTokens(1_234_000)).toBe('1.2M');
  });
});

describe('formatDuration', () => {
  it('shows hours and minutes under a day, days and hours beyond it', () => {
    expect(formatDuration(3 * 3600 + 25 * 60)).toBe('3h 25m');
    expect(formatDuration(9 * 60)).toBe('9m');
    expect(formatDuration(2 * 86400 + 5 * 3600)).toBe('2d 5h');
    expect(formatDuration(-30)).toBe('0m');
  });
});

describe('UsageMeter', () => {
  it('renders nothing when there is no transcript history at all', async () => {
    mockStats(UNAVAILABLE);
    const { container } = render(<UsageMeter />);
    await vi.waitFor(() => expect(ipc.getSessionUsageStats).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('shows "no active window" for each window when idle', async () => {
    mockStats({ ...UNAVAILABLE, available: true });
    render(<UsageMeter />);
    expect(await screen.findByText('Session: no active window')).toBeInTheDocument();
    expect(screen.getByText('This week: no active window')).toBeInTheDocument();
  });

  it('shows percentage, tokens, and countdown for an active session window', async () => {
    mockStats({ available: true, session: ACTIVE_SESSION, week: EMPTY_WINDOW, byModel: {}, cacheReadTokens: 0 });
    render(<UsageMeter />);

    // 45_200 / 120_000 ≈ 38%
    expect(await screen.findByText('38%')).toBeInTheDocument();
    expect(screen.getByText(/45k \/ ~120k tokens/)).toBeInTheDocument();
    expect(screen.getByText(/resets in 2h/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Session usage' })).toHaveAttribute('aria-valuenow', '38');
  });

  it('shows the week window alongside the session window', async () => {
    mockStats({ available: true, session: ACTIVE_SESSION, week: ACTIVE_WEEK, byModel: {}, cacheReadTokens: 0 });
    render(<UsageMeter />);

    expect(await screen.findByText('25%')).toBeInTheDocument(); // 1_000_000 / 4_000_000
    expect(screen.getByText(/resets in 3d/)).toBeInTheDocument();
  });

  it('shows a calibrating notice instead of a bar when there is no estimate yet', async () => {
    mockStats({
      available: true,
      session: { ...ACTIVE_SESSION, estimatedLimitTokens: null, blocksSeen: 0 },
      week: EMPTY_WINDOW,
      byModel: {},
      cacheReadTokens: 0,
    });
    render(<UsageMeter />);

    expect(await screen.findByText(/Estimating your usual limit/)).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('expands the model breakdown, scoped to the current week', async () => {
    mockStats({
      available: true,
      session: EMPTY_WINDOW,
      week: ACTIVE_WEEK,
      byModel: { 'claude-sonnet-5': 1_000_000, 'claude-haiku-4-5': 234_000 },
      cacheReadTokens: 42,
    });
    render(<UsageMeter />);

    const toggle = await screen.findByText('Breakdown by model');
    await userEvent.click(toggle);

    expect(screen.getByText('claude-sonnet-5')).toBeInTheDocument();
    expect(screen.getByText('claude-haiku-4-5')).toBeInTheDocument();
    expect(screen.getByText('cache reads (near-free)')).toBeInTheDocument();
  });

  it('hides the breakdown toggle when the week has nothing to show', async () => {
    mockStats({ available: true, session: ACTIVE_SESSION, week: EMPTY_WINDOW, byModel: {}, cacheReadTokens: 0 });
    render(<UsageMeter />);
    await screen.findByText('38%');
    expect(screen.queryByText('Breakdown by model')).not.toBeInTheDocument();
  });
});
