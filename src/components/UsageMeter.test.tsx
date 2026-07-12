import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UsageStats } from '@/types';

vi.mock('@/lib/ipc');

import * as ipc from '@/lib/ipc';
import UsageMeter, { formatTokens } from './UsageMeter';

const STATS: UsageStats = {
  available: true,
  date: '2026-07-12',
  totalTokens: 1_234_000,
  byModel: { 'claude-sonnet-5': 1_000_000, 'claude-haiku-4-5': 234_000 },
  cacheReadTokens: 42,
};

afterEach(cleanup);

describe('formatTokens', () => {
  it('abbreviates thousands and millions', () => {
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(12_400)).toBe('12k');
    expect(formatTokens(1_234_000)).toBe('1.2M');
  });
});

describe('UsageMeter', () => {
  it('renders nothing when stats are unavailable', async () => {
    vi.mocked(ipc.getUsageStats).mockResolvedValue({ ...STATS, available: false });
    const { container } = render(<UsageMeter />);
    await vi.waitFor(() => expect(ipc.getUsageStats).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('shows total and expands to a per-model breakdown', async () => {
    vi.mocked(ipc.getUsageStats).mockResolvedValue(STATS);
    render(<UsageMeter />);

    const toggle = await screen.findByText('1.2M tokens today');
    await userEvent.click(toggle);

    expect(screen.getByText('claude-sonnet-5')).toBeInTheDocument();
    expect(screen.getByText('claude-haiku-4-5')).toBeInTheDocument();
    expect(screen.getByText('cache reads (near-free)')).toBeInTheDocument();
  });
});
