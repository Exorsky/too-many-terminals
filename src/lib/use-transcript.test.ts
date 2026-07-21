import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranscriptTurn } from '@/types';

vi.mock('@/lib/ipc');

import * as ipc from '@/lib/ipc';
import { useTranscript } from './use-transcript';

const read = vi.mocked(ipc.readTranscript);

function turn(text: string): TranscriptTurn {
  return { role: 'assistant', timestamp: null, blocks: [{ kind: 'text', text }] };
}

beforeEach(() => vi.clearAllMocks());

describe('useTranscript', () => {
  it('loads turns for a session', async () => {
    read.mockResolvedValue([turn('a')]);
    const { result } = renderHook(() => useTranscript('proj', 'sess', 0));
    await waitFor(() => expect(result.current.turns).toHaveLength(1));
  });

  it('keeps the same turns on a live re-read that did not change', async () => {
    read.mockResolvedValue([turn('a')]);
    const { result, rerender } = renderHook(({ k }) => useTranscript('proj', 'sess', k), {
      initialProps: { k: 0 },
    });
    await waitFor(() => expect(result.current.turns).toHaveLength(1));
    const first = result.current.turns;

    read.mockResolvedValue([turn('a')]); // identical content, brand-new array
    rerender({ k: 1 });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(result.current.turns).toBe(first); // reference unchanged → no re-render
  });

  it('swaps in new turns when the transcript grew', async () => {
    read.mockResolvedValue([turn('a')]);
    const { result, rerender } = renderHook(({ k }) => useTranscript('proj', 'sess', k), {
      initialProps: { k: 0 },
    });
    await waitFor(() => expect(result.current.turns).toHaveLength(1));

    read.mockResolvedValue([turn('a'), turn('b')]);
    rerender({ k: 1 });
    await waitFor(() => expect(result.current.turns).toHaveLength(2));
  });

  it('yields an empty, non-loading result without ids', () => {
    const { result } = renderHook(() => useTranscript(null, null, 0));
    expect(result.current).toEqual({ turns: [], error: null });
  });
});
