import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ipc');

import * as ipc from '@/lib/ipc';
import FileTree from './FileTree';

const ROOT = { name: 'project', path: '/proj', isDir: true };

afterEach(cleanup);

describe('FileTree', () => {
  it('loads and shows the root folder children on mount (root starts expanded)', async () => {
    vi.mocked(ipc.listDir).mockResolvedValue([
      { name: 'src', path: '/proj/src', isDir: true },
      { name: 'README.md', path: '/proj/README.md', isDir: false },
    ]);

    render(<FileTree root={ROOT} activePath={null} onOpen={vi.fn()} />);

    expect(await screen.findByText('src')).toBeInTheDocument();
    expect(screen.getByText('README.md')).toBeInTheDocument();
    expect(ipc.listDir).toHaveBeenCalledWith('/proj');
  });

  it('does not fetch a subdirectory until it is expanded', async () => {
    vi.mocked(ipc.listDir).mockImplementation(async (dir: string) => {
      if (dir === '/proj') return [{ name: 'src', path: '/proj/src', isDir: true }];
      if (dir === '/proj/src') return [{ name: 'App.tsx', path: '/proj/src/App.tsx', isDir: false }];
      return [];
    });

    render(<FileTree root={ROOT} activePath={null} onOpen={vi.fn()} />);

    await screen.findByText('src');
    expect(ipc.listDir).not.toHaveBeenCalledWith('/proj/src');

    fireEvent.click(screen.getByText('src'));
    expect(await screen.findByText('App.tsx')).toBeInTheDocument();
  });

  it('calls onOpen with the file path when a file row is clicked', async () => {
    vi.mocked(ipc.listDir).mockResolvedValue([{ name: 'App.tsx', path: '/proj/App.tsx', isDir: false }]);
    const onOpen = vi.fn();

    render(<FileTree root={ROOT} activePath={null} onOpen={onOpen} />);
    fireEvent.click(await screen.findByText('App.tsx'));

    expect(onOpen).toHaveBeenCalledWith('/proj/App.tsx');
  });
});
