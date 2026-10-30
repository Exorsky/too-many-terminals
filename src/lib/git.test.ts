import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./ipc');

import * as ipc from './ipc';
import type { GitStatus } from './ipc';
import { getGitStatus, gitMarks, refreshGit, resetGitForTest } from './git';

const status = (files: GitStatus['files'] = []): GitStatus => ({
  root: '/repo', branch: 'main', head: 'abc1234', upstream: 'origin/main', ahead: 0, behind: 0, files,
});

afterEach(() => { resetGitForTest(); vi.useRealTimers(); vi.clearAllMocks(); });

describe('git status per folder', () => {
  it('asks once while a request is in flight, and not again while fresh', async () => {
    vi.mocked(ipc.gitStatus).mockResolvedValue(status());
    await Promise.all([refreshGit('/repo'), refreshGit('/repo')]);
    await refreshGit('/repo');
    expect(ipc.gitStatus).toHaveBeenCalledTimes(1);
    expect(getGitStatus('/repo')?.branch).toBe('main');
  });

  it('a forced refresh still waits out the 2s gap, then asks', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(ipc.gitStatus).mockResolvedValue(status());
    await refreshGit('/repo');
    await refreshGit('/repo', true);
    expect(ipc.gitStatus).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2500);
    await refreshGit('/repo', true);
    expect(ipc.gitStatus).toHaveBeenCalledTimes(2);
  });

  it('outside a repo, or when git fails, there is simply no status', async () => {
    vi.mocked(ipc.gitStatus).mockRejectedValue(new Error('no git'));
    await refreshGit('/tmp');
    expect(getGitStatus('/tmp')).toBeNull();
  });
});

describe('marks for a file tree', () => {
  it('marks each file and every folder above a change', () => {
    const marks = gitMarks(status([{ path: 'src/lib/a.ts', code: 'M' }, { path: 'notes/', code: 'U' }]));
    expect(marks.files.get('/repo/src/lib/a.ts')).toBe('M');
    expect(marks.files.get('/repo/notes')).toBe('U');
    expect([...marks.dirs].sort()).toEqual(['/repo/src', '/repo/src/lib']);
  });
});
