import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ipc');

import * as ipc from '@/lib/ipc';
import type { SessionStat, Tab } from '@/types';
import SessionActivity from './SessionActivity';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const Label = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;

const session: Tab = {
  id: 't1', kind: 'claude', name: 'x', shellId: null, cwd: '/proj', projectDir: '/proj',
  resumeSessionId: 's1', exited: false, status: 'idle',
};

function stat(overrides: Partial<SessionStat> = {}): SessionStat {
  return {
    sessionId: 's1', lastUsedIso: '2026-11-16T08:00:00Z', startedIso: null, endedIso: null, turns: 18,
    inputTokens: 1000, outputTokens: 2000, cacheReadTokens: 9000, cacheCreationTokens: 0, model: null,
    preview: '', commands: [], writes: [], reads: 23, edits: 4, shell: 9, ...overrides,
  };
}

describe('SessionActivity', () => {
  it('lists writes, counts the rest, and reports the count back', async () => {
    vi.mocked(ipc.getSessionActivity).mockResolvedValue(stat({
      writes: [{ atIso: '2026-11-16T08:00:00Z', label: 'git push origin feat/x' }],
    }));
    const onWritesSeen = vi.fn();
    render(<SessionActivity session={session} onWritesSeen={onWritesSeen} Label={Label} />);

    expect(await screen.findByText('git push origin feat/x')).toBeInTheDocument();
    expect(screen.getByText('1 write')).toBeInTheDocument();
    expect(screen.getByText('23 reads')).toBeInTheDocument();
    expect(screen.getByText('12K')).toBeInTheDocument();
    expect(screen.getByText('90%')).toBeInTheDocument();
    expect(ipc.getSessionActivity).toHaveBeenCalledWith('/proj', 's1');
    expect(onWritesSeen).toHaveBeenCalledWith(1);
  });

  it('reads the transcript when a turn ends — not when one starts, nor on each write', async () => {
    vi.mocked(ipc.getSessionActivity).mockResolvedValue(stat());
    const onWritesSeen = vi.fn();
    const { rerender } = render(<SessionActivity session={session} onWritesSeen={onWritesSeen} Label={Label} />);
    await screen.findByText('read-only');
    expect(ipc.getSessionActivity).toHaveBeenCalledTimes(1);
    rerender(<SessionActivity session={{ ...session, status: 'working' }} onWritesSeen={onWritesSeen} Label={Label} />);
    rerender(<SessionActivity session={{ ...session, status: 'working', writes: 1 }} onWritesSeen={onWritesSeen} Label={Label} />);
    expect(ipc.getSessionActivity).toHaveBeenCalledTimes(1);
    rerender(<SessionActivity session={{ ...session, status: 'idle', writes: 1 }} onWritesSeen={onWritesSeen} Label={Label} />);
    await vi.waitFor(() => expect(ipc.getSessionActivity).toHaveBeenCalledTimes(2));
  });

  it('says read-only when nothing was written', async () => {
    vi.mocked(ipc.getSessionActivity).mockResolvedValue(stat());
    render(<SessionActivity session={session} onWritesSeen={vi.fn()} Label={Label} />);
    expect(await screen.findByText('read-only')).toBeInTheDocument();
  });

  it('renders nothing before the session has a transcript', () => {
    const { container } = render(
      <SessionActivity session={{ ...session, resumeSessionId: null }} onWritesSeen={vi.fn()} Label={Label} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(ipc.getSessionActivity).not.toHaveBeenCalled();
  });
});
