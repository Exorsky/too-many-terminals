import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ipc');

import * as ipc from '@/lib/ipc';
import FileExplorerPanel, { FilesEdge } from './FileExplorerPanel';

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

describe('FilesEdge', () => {
  it('makes the pointer dwell before it opens anything', () => {
    vi.useFakeTimers();
    try {
      const onPeek = vi.fn();
      render(<FilesEdge onPeek={onPeek} />);
      const edge = screen.getByRole('button', { name: 'Show files' });

      // The right edge is on the way to a scrollbar or a window button, so
      // crossing it is not a request.
      fireEvent.mouseEnter(edge);
      act(() => { vi.advanceTimersByTime(299); });
      expect(onPeek).not.toHaveBeenCalled();

      act(() => { vi.advanceTimersByTime(1); });
      expect(onPeek).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops the wait when the pointer leaves again', () => {
    vi.useFakeTimers();
    try {
      const onPeek = vi.fn();
      render(<FilesEdge onPeek={onPeek} />);
      const edge = screen.getByRole('button', { name: 'Show files' });

      fireEvent.mouseEnter(edge);
      fireEvent.mouseLeave(edge);
      act(() => { vi.advanceTimersByTime(600); });
      expect(onPeek).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens at once on a click, which is already deliberate', () => {
    vi.useFakeTimers();
    try {
      const onPeek = vi.fn();
      render(<FilesEdge onPeek={onPeek} />);
      fireEvent.click(screen.getByRole('button', { name: 'Show files' }));
      // No timer advanced: a click doesn't serve the pointer's grace period.
      expect(onPeek).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens on focus, so the keyboard never waits out a pointer delay', () => {
    const onPeek = vi.fn();
    render(<FilesEdge onPeek={onPeek} />);
    fireEvent.focus(screen.getByRole('button', { name: 'Show files' }));
    expect(onPeek).toHaveBeenCalledTimes(1);
  });
});

describe('the pin', () => {
  it('stays out of the header until the panel can change modes', () => {
    render(<FileExplorerPanel projects={[]} activePath={null} onOpenFile={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /pin files/i })).not.toBeInTheDocument();
  });

  it('offers to pin a peeking panel and to unpin a docked one', async () => {
    const onTogglePin = vi.fn();
    const { rerender } = render(
      <FileExplorerPanel projects={[]} activePath={null} onOpenFile={vi.fn()} pinned={false} onTogglePin={onTogglePin} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Pin files' }));
    expect(onTogglePin).toHaveBeenCalled();

    rerender(
      <FileExplorerPanel projects={[]} activePath={null} onOpenFile={vi.fn()} pinned onTogglePin={onTogglePin} />,
    );
    expect(screen.getByRole('button', { name: 'Unpin files' })).toHaveAttribute('aria-pressed', 'true');
  });
});
