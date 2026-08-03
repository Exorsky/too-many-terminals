import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ipc');

import * as ipc from '@/lib/ipc';
import FileExplorerPanel from './FileExplorerPanel';

afterEach(cleanup);

describe('FileExplorerPanel', () => {
  it('shows an empty state with no open folders', () => {
    render(<FileExplorerPanel projects={[]} activePath={null} onOpenFile={vi.fn()} />);
    expect(screen.getByText('No folders open')).toBeInTheDocument();
  });

  it('renders one tree per open project', async () => {
    vi.mocked(ipc.listDir).mockResolvedValue([]);
    render(<FileExplorerPanel projects={['/proj-a', '/proj-b']} activePath={null} onOpenFile={vi.fn()} />);

    expect(await screen.findByText('proj-a')).toBeInTheDocument();
    expect(screen.getByText('proj-b')).toBeInTheDocument();
  });

  it('searches across projects and opens the file whose row is clicked', async () => {
    vi.mocked(ipc.listDir).mockImplementation(async (dir: string) => {
      if (dir === '/proj') return [{ name: 'App.tsx', path: '/proj/App.tsx', isDir: false }];
      return [];
    });
    const onOpenFile = vi.fn();

    render(<FileExplorerPanel projects={['/proj']} activePath={null} onOpenFile={onOpenFile} />);
    fireEvent.change(screen.getByPlaceholderText('Find files'), { target: { value: 'app' } });

    fireEvent.click(await screen.findByText('App.tsx'));
    expect(onOpenFile).toHaveBeenCalledWith('/proj', '/proj/App.tsx');
  });

  it('reports when a search finds nothing', async () => {
    vi.mocked(ipc.listDir).mockResolvedValue([]);
    render(<FileExplorerPanel projects={['/proj']} activePath={null} onOpenFile={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('Find files'), { target: { value: 'zzz' } });
    expect(await screen.findByText(/No files match/)).toBeInTheDocument();
  });
});
