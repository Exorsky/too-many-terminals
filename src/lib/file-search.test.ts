import { describe, expect, it, vi } from 'vitest';

vi.mock('./ipc');

import * as ipc from './ipc';
import { searchFiles } from './file-search';

describe('searchFiles', () => {
  it('returns nothing for a blank query without touching the filesystem', async () => {
    const matches = await searchFiles(['/proj'], '   ');
    expect(matches).toEqual([]);
    expect(ipc.listDir).not.toHaveBeenCalled();
  });

  it('finds a file nested under a matching root, case-insensitively', async () => {
    vi.mocked(ipc.listDir).mockImplementation(async (dir: string) => {
      if (dir === '/proj') {
        return [
          { name: 'src', path: '/proj/src', isDir: true },
          { name: 'README.md', path: '/proj/README.md', isDir: false },
        ];
      }
      if (dir === '/proj/src') {
        return [{ name: 'App.tsx', path: '/proj/src/App.tsx', isDir: false }];
      }
      return [];
    });

    const matches = await searchFiles(['/proj'], 'app');
    expect(matches).toEqual([{ name: 'App.tsx', path: '/proj/src/App.tsx', root: '/proj' }]);
  });

  it('skips noisy directories like node_modules', async () => {
    vi.mocked(ipc.listDir).mockImplementation(async (dir: string) => {
      if (dir === '/proj') {
        return [
          { name: 'node_modules', path: '/proj/node_modules', isDir: true },
          { name: 'app.ts', path: '/proj/app.ts', isDir: false },
        ];
      }
      throw new Error(`should not descend into ${dir}`);
    });

    const matches = await searchFiles(['/proj'], 'app');
    expect(matches).toEqual([{ name: 'app.ts', path: '/proj/app.ts', root: '/proj' }]);
  });

  it('stops once the match limit is reached', async () => {
    vi.mocked(ipc.listDir).mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({ name: `match-${i}.ts`, path: `/proj/match-${i}.ts`, isDir: false })),
    );

    const matches = await searchFiles(['/proj'], 'match', 3);
    expect(matches).toHaveLength(3);
  });

  it('keeps going past a directory it fails to read', async () => {
    vi.mocked(ipc.listDir).mockImplementation(async (dir: string) => {
      if (dir === '/proj') {
        return [
          { name: 'locked', path: '/proj/locked', isDir: true },
          { name: 'match.ts', path: '/proj/match.ts', isDir: false },
        ];
      }
      throw new Error('permission denied');
    });

    const matches = await searchFiles(['/proj'], 'match');
    expect(matches).toEqual([{ name: 'match.ts', path: '/proj/match.ts', root: '/proj' }]);
  });
});
