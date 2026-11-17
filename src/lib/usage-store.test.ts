import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ipc from '@/lib/ipc';
import { resetSettingsForTest } from '@/lib/settings-store';
import { resetUsageForTest, useUsageStats } from './usage-store';
import type { SessionUsageStats } from '@/types';

vi.mock('@/lib/ipc');

const STATS: SessionUsageStats = {
  available: true, session: { percent: 40, resetsAtIso: '2026-11-17T12:00:00Z' }, week: null, fetchedAtMs: 1, fromCache: false,
};

beforeEach(() => {
  resetSettingsForTest();
  vi.mocked(ipc.getSessionUsageStats).mockResolvedValue(STATS);
});
afterEach(() => { cleanup(); resetUsageForTest(); vi.clearAllMocks(); });

describe('useUsageStats', () => {
  it('polls once for every reader, and a late reader starts with the last read', async () => {
    const first = renderHook(() => useUsageStats());
    await waitFor(() => expect(first.result.current).toEqual(STATS));
    const second = renderHook(() => useUsageStats());
    expect(second.result.current).toEqual(STATS);
    expect(ipc.getSessionUsageStats).toHaveBeenCalledTimes(1);
  });
});
