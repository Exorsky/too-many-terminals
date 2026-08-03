import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionUsageStats, UsageStats } from '@/types';

vi.mock('@/lib/ipc');

import * as ipc from '@/lib/ipc';
import UsageMeter, { formatDuration, formatTokens } from './UsageMeter';

const DAILY_STATS: UsageStats = {
  available: true,
  date: '2026-07-12',
  totalTokens: 1_234_000,
  byModel: { 'claude-sonnet-5': 1_000_000, 'claude-haiku-4-5': 234_000 },
  cacheReadTokens: 42,
};

const DAILY_UNAVAILABLE: UsageStats = { ...DAILY_STATS, available: false };

const SESSION_UNAVAILABLE: SessionUsageStats = {
  available: false, tokensUsed: 0, blockStartIso: null, blockEndIso: null, estimatedLimitTokens: null, blocksSeen: 0,
};

const SESSION_IDLE: SessionUsageStats = { ...SESSION_UNAVAILABLE, available: true };

const SESSION_ACTIVE: SessionUsageStats = {
  available: true,
  tokensUsed: 45_200,
  blockStartIso: '2026-07-12T08:00:00.000Z',
  blockEndIso: new Date(Date.now() + 2 * 60 * 60 * 1000 + 60 * 1000).toISOString(), // ~2h1m out
  estimatedLimitTokens: 120_000,
  blocksSeen: 6,
};

function mockStats(daily: UsageStats, session: SessionUsageStats) {
  vi.mocked(ipc.getUsageStats).mockResolvedValue(daily);
  vi.mocked(ipc.getSessionUsageStats).mockResolvedValue(session);
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
  it('shows hours and minutes, or just minutes under an hour', () => {
    expect(formatDuration(3 * 3600 + 25 * 60)).toBe('3h 25m');
    expect(formatDuration(9 * 60)).toBe('9m');
    expect(formatDuration(-30)).toBe('0m');
  });
});

describe('UsageMeter', () => {
  it('renders nothing when both daily and session stats are unavailable', async () => {
    mockStats(DAILY_UNAVAILABLE, SESSION_UNAVAILABLE);
    const { container } = render(<UsageMeter />);
    await vi.waitFor(() => expect(ipc.getUsageStats).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('shows total and expands to a per-model breakdown', async () => {
    mockStats(DAILY_STATS, SESSION_UNAVAILABLE);
    render(<UsageMeter />);

    const toggle = await screen.findByText('1.2M tokens today');
    await userEvent.click(toggle);

    expect(screen.getByText('claude-sonnet-5')).toBeInTheDocument();
    expect(screen.getByText('claude-haiku-4-5')).toBeInTheDocument();
    expect(screen.getByText('cache reads (near-free)')).toBeInTheDocument();
  });

  it('shows "no active session" when there is history but no live block', async () => {
    mockStats(DAILY_UNAVAILABLE, SESSION_IDLE);
    render(<UsageMeter />);
    expect(await screen.findByText('No active session')).toBeInTheDocument();
  });

  it('shows the active block\'s usage, countdown, and progress bar', async () => {
    mockStats(DAILY_UNAVAILABLE, SESSION_ACTIVE);
    render(<UsageMeter />);

    expect(await screen.findByText(/45k \/ ~120k/)).toBeInTheDocument();
    expect(screen.getByText(/resets in 2h/)).toBeInTheDocument();
    const bar = screen.getByRole('progressbar');
    // 45_200 / 120_000 ≈ 37.7%
    expect(bar).toHaveAttribute('aria-valuenow', '38');
  });

  it('shows a calibrating notice instead of a bar when there is no estimate yet', async () => {
    mockStats(DAILY_UNAVAILABLE, { ...SESSION_ACTIVE, estimatedLimitTokens: null, blocksSeen: 0 });
    render(<UsageMeter />);

    expect(await screen.findByText(/Estimating your usual limit/)).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});
