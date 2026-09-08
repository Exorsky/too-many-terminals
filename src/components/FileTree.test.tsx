import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ipc');

import * as ipc from '@/lib/ipc';
import FileTree from './FileTree';

const ROOT = { name: 'project', path: '/proj', isDir: true };

afterEach(cleanup);

describe('FileTree', () => {
  it('starts fully collapsed, including the project root', async () => {
    vi.mocked(ipc.listDir).mockResolvedValue([{ name: 'src', path: '/proj/src', isDir: true }]);

    render(<FileTree root={ROOT} activePath={null} onOpen={vi.fn()} />);

    expect(screen.getByText('project')).toBeInTheDocument();
    expect(screen.queryByText('src')).not.toBeInTheDocument();
    expect(ipc.listDir).not.toHaveBeenCalled();
  });

  it('loads and shows the root folder children once expanded', async () => {
    vi.mocked(ipc.listDir).mockResolvedValue([
      { name: 'src', path: '/proj/src', isDir: true },
      { name: 'README.md', path: '/proj/README.md', isDir: false },
    ]);

    render(<FileTree root={ROOT} activePath={null} onOpen={vi.fn()} />);
    fireEvent.click(screen.getByText('project'));

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
    fireEvent.click(screen.getByText('project'));

    await screen.findByText('src');
    expect(ipc.listDir).not.toHaveBeenCalledWith('/proj/src');

    fireEvent.click(screen.getByText('src'));
    expect(await screen.findByText('App.tsx')).toBeInTheDocument();
  });

  it('re-fetches a folder after it is collapsed and re-expanded, picking up new files', async () => {
    let calls = 0;
    vi.mocked(ipc.listDir).mockImplementation(async () => {
      calls += 1;
      return calls === 1
        ? [{ name: 'README.md', path: '/proj/README.md', isDir: false }]
        : [
            { name: 'README.md', path: '/proj/README.md', isDir: false },
            { name: 'new.txt', path: '/proj/new.txt', isDir: false },
          ];
    });

    render(<FileTree root={ROOT} activePath={null} onOpen={vi.fn()} />);
    fireEvent.click(screen.getByText('project')); // expand
    await screen.findByText('README.md');
    expect(screen.queryByText('new.txt')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('project')); // collapse
    expect(screen.queryByText('README.md')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('project')); // re-expand
    expect(await screen.findByText('new.txt')).toBeInTheDocument();
    expect(calls).toBe(2); // one fetch per expand; collapsing must not itself fetch
  });

  it('calls onOpen with the file path when a file row is clicked', async () => {
    vi.mocked(ipc.listDir).mockResolvedValue([{ name: 'App.tsx', path: '/proj/App.tsx', isDir: false }]);
    const onOpen = vi.fn();

    render(<FileTree root={ROOT} activePath={null} onOpen={onOpen} />);
    fireEvent.click(screen.getByText('project'));
    fireEvent.click(await screen.findByText('App.tsx'));

    expect(onOpen).toHaveBeenCalledWith('/proj/App.tsx');
  });
});

describe('FileTree, while a folder stays open', () => {
  const entry = (name: string, isDir = false) => ({ name, path: `/proj/${name}`, isDir });

  /** Fake timers have to be in place before the render, or the poll's interval
   *  is created against the real clock and advancing does nothing. */
  function setup(initial: ReturnType<typeof entry>[]) {
    vi.useFakeTimers();
    vi.mocked(ipc.listDir).mockResolvedValue(initial);
    render(<FileTree root={ROOT} activePath={null} onOpen={vi.fn()} />);
    fireEvent.click(screen.getByText('project'));
  }

  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('picks up a file written next door without being collapsed first', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    setup([entry('a.ts')]);
    await act(async () => {});
    expect(screen.getByText('a.ts')).toBeInTheDocument();

    // A session in the next pane creates one.
    vi.mocked(ipc.listDir).mockResolvedValue([entry('a.ts'), entry('b.ts')]);
    await act(async () => { vi.advanceTimersByTime(2000); });

    expect(screen.getByText('b.ts')).toBeInTheDocument();
  });

  it('drops a file that disappeared', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    setup([entry('a.ts'), entry('b.ts')]);
    await act(async () => {});

    vi.mocked(ipc.listDir).mockResolvedValue([entry('a.ts')]);
    await act(async () => { vi.advanceTimersByTime(2000); });

    expect(screen.queryByText('b.ts')).not.toBeInTheDocument();
  });

  it('stops polling while the window is not focused', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    setup([entry('a.ts')]);
    await act(async () => {});
    const afterOpen = vi.mocked(ipc.listDir).mock.calls.length;

    await act(async () => { vi.advanceTimersByTime(10_000); });

    // Nobody is looking, so nothing is re-read.
    expect(vi.mocked(ipc.listDir).mock.calls.length).toBe(afterOpen);
  });
});
