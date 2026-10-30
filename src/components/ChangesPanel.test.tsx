import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ipc');

import * as ipc from '@/lib/ipc';
import { resetGitForTest } from '@/lib/git';
import type { Tab } from '@/types';
import ChangesPanel from './ChangesPanel';
import { parseDiff } from './DiffView';

const session = { id: 's', name: 'S', cwd: '/repo', gitStart: 'aaaaaaa1' } as Tab;
const status = { root: '/repo', branch: 'feat/x', head: 'ccc', upstream: null, ahead: 0, behind: 0, files: [{ path: 'new.txt', code: 'U' }] };

beforeEach(() => {
  vi.mocked(ipc.gitStatus).mockResolvedValue(status);
  vi.mocked(ipc.gitChanges).mockResolvedValue({
    uncommitted: [{ path: 'new.txt', code: 'U', added: 2, deleted: 0 }],
    commits: [{ oid: 'bbb', short: 'bbb', parents: ['aaaaaaa1'], refs: ['HEAD', 'feat/x'], subject: 'fix: the thing', time: 0,
      files: [{ path: 'src/a.ts', code: 'M', added: 3, deleted: 1 }] }],
    diverged: false,
  });
  vi.mocked(ipc.gitGraph).mockResolvedValue([
    { oid: 'bbb', short: 'bbb', parents: ['aaaaaaa1'], refs: ['HEAD', 'feat/x'], subject: 'fix: the thing', time: 0, files: [] },
    { oid: 'aaaaaaa1', short: 'aaaaaaa', parents: [], refs: ['main'], subject: 'start', time: 0, files: [] },
  ]);
});
afterEach(() => { cleanup(); resetGitForTest(); vi.clearAllMocks(); });

describe('Changes panel', () => {
  it('lists uncommitted first, then the session\'s commits; a file opens its diff', async () => {
    const onOpenDiff = vi.fn();
    render(<ChangesPanel session={session} onOpenDiff={onOpenDiff} />);
    expect(await screen.findByText('new.txt')).toBeInTheDocument();
    expect(ipc.gitChanges).toHaveBeenCalledWith('/repo', 'aaaaaaa1');
    await userEvent.click(screen.getByText('new.txt'));
    expect(onOpenDiff).toHaveBeenCalledWith('/repo', 'new.txt', null);

    await userEvent.click(screen.getByText('fix: the thing'));
    await userEvent.click(screen.getByText('a.ts'));
    expect(onOpenDiff).toHaveBeenCalledWith('/repo', 'src/a.ts', 'bbb');
  });

  it('the graph names branches and marks where the session started', async () => {
    render(<ChangesPanel session={session} onOpenDiff={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Graph' }));
    expect(await screen.findByText('session start')).toBeInTheDocument();
    expect(screen.getByText('main')).toBeInTheDocument();
  });

  it('a session from before the app recorded its start begins at Uncommitted', async () => {
    render(<ChangesPanel session={{ ...session, gitStart: null }} onOpenDiff={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'This session' })).toBeDisabled();
    expect(ipc.gitChanges).toHaveBeenCalledWith('/repo', null);
  });
});

describe('parsing a diff', () => {
  it('numbers old and new lines and drops the file headers', () => {
    const lines = parseDiff('diff --git a/x b/x\nindex 1..2\n--- a/x\n+++ b/x\n@@ -3,2 +3,3 @@ fn()\n keep\n-old\n+new\n+more\n');
    expect(lines.map((l) => [l.kind, l.oldNo, l.newNo])).toEqual([
      ['hunk', null, null], ['ctx', 3, 3], ['del', 4, null], ['add', null, 4], ['add', null, 5],
    ]);
  });
});
