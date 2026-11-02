import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@/lib/ipc', () => ({
  statPaths: vi.fn(async (_cwd: string, paths: string[]) => paths.map((p) => (
    p === 'docs' ? { path: '/repo/docs', isDir: true, size: 0 }
      : p === 'src/app.ts' ? { path: '/repo/src/app.ts', isDir: false, size: 2048 } : null))),
  readFile: vi.fn(async () => 'line 1\nline 2'),
  listDir: vi.fn(async () => [{ name: 'a.md', path: '/repo/docs/a.md', isDir: false }]),
  readFileBytes: vi.fn(),
  openWithSystem: vi.fn(),
  revealInFileManager: vi.fn(),
  fileManagerName: () => 'Finder',
}));

import * as ipc from '@/lib/ipc';
import { clickPathLink, closePathCard, hidePathCard, launches, showPathCard } from '@/lib/path-links';
import PathCard from './PathCard';

afterEach(() => {
  act(() => { closePathCard(); });
  vi.useRealTimers();
  cleanup();
});

async function hover(path: string) {
  await act(async () => { showPathCard({ cwd: '/repo', path }, 0, 0); vi.advanceTimersByTime(300); });
  await act(async () => { await vi.runAllTimersAsync(); });
}

it('previews a text file and opens it as a tab', async () => {
  vi.useFakeTimers();
  const onOpenFile = vi.fn();
  render(<PathCard onOpenFile={onOpenFile} />);
  await hover('src/app.ts');

  expect(screen.getByText('app.ts')).toBeTruthy();
  expect(screen.getByText('2.0 KB')).toBeTruthy();
  expect(screen.getByText(/line 1\s+line 2/)).toBeTruthy();
  fireEvent.click(screen.getByText('Open in tab'));
  expect(onOpenFile).toHaveBeenCalledWith('/repo', '/repo/src/app.ts');
});

it('opens a text file with the OS app on request', async () => {
  vi.useFakeTimers();
  render(<PathCard onOpenFile={vi.fn()} />);
  await hover('src/app.ts');
  fireEvent.click(screen.getByText('Open with app'));
  expect(ipc.openWithSystem).toHaveBeenCalledWith('/repo/src/app.ts');
});

it('lists a folder and hands it to the OS', async () => {
  vi.useFakeTimers();
  render(<PathCard onOpenFile={vi.fn()} />);
  await hover('docs');

  expect(screen.getByText('a.md')).toBeTruthy();
  fireEvent.click(screen.getByText('Open folder'));
  expect(ipc.openWithSystem).toHaveBeenCalledWith('/repo/docs');
});

it('shows nothing for a path that does not exist', async () => {
  vi.useFakeTimers();
  render(<PathCard onOpenFile={vi.fn()} />);
  await hover('and/or');
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('a plain click pins the card — hovers and leaving keep it — and Esc closes it', async () => {
  vi.useFakeTimers();
  const onOpenFile = vi.fn();
  render(<PathCard onOpenFile={onOpenFile} />);
  await act(async () => { clickPathLink({ cwd: '/repo', path: 'src/app.ts' }, new MouseEvent('click'), 0, 0); });
  await act(async () => { await vi.runAllTimersAsync(); });
  expect(screen.getByText('Esc closes')).toBeTruthy();
  expect(onOpenFile).not.toHaveBeenCalled();

  await act(async () => { hidePathCard(); showPathCard({ cwd: '/repo', path: 'docs' }, 0, 0); await vi.runAllTimersAsync(); });
  expect(screen.getByText('app.ts')).toBeTruthy();

  act(() => { fireEvent.keyDown(window, { key: 'Escape' }); });
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('⌘-click opens without a card', async () => {
  vi.useFakeTimers();
  const onOpenFile = vi.fn();
  render(<PathCard onOpenFile={onOpenFile} />);
  await act(async () => {
    clickPathLink({ cwd: '/repo', path: 'src/app.ts' }, new MouseEvent('click', { metaKey: true }), 0, 0);
    await vi.runAllTimersAsync();
  });
  expect(onOpenFile).toHaveBeenCalledWith('/repo', '/repo/src/app.ts');
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('never launches what the OS would run', () => {
  expect(launches('/Applications/Evil.app/')).toBe(true);
  expect(launches('C:\\x\\setup.EXE')).toBe(true);
  expect(launches('/repo/run.command')).toBe(true);
  expect(launches('/repo/src/app.ts')).toBe(false);
});
