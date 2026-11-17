import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ipc from '@/lib/ipc';
import { patchSettings, resetSettingsForTest } from '@/lib/settings-store';
import PathText, { commandCwd } from './PathText';

vi.mock('@/lib/ipc');

// Everything named `exists*` or a folder is on disk; the rest isn't.
const onDisk = (p: string) => /exists|^\/work/.test(p) ? { path: p, isDir: !p.includes('.'), size: 1 } : null;

beforeEach(() => {
  resetSettingsForTest();
  vi.mocked(ipc.saveSettings).mockResolvedValue();
  vi.mocked(ipc.statPaths).mockImplementation(async (_cwd, paths) => paths.map(onDisk));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('commandCwd', () => {
  it('takes a leading absolute cd as the folder the rest runs in', () => {
    expect(commandCwd('cd /Users/me/repo && cat a.txt')).toBe('/Users/me/repo');
    expect(commandCwd('cd "/Users/me/my repo"; ls')).toBe('/Users/me/my repo');
    expect(commandCwd('cd src && ls')).toBeNull();
    expect(commandCwd('ls && cd /tmp && ls')).toBeNull();
  });
});

describe('PathText', () => {
  it('links the paths that exist, resolved from a leading cd', async () => {
    const { container } = render(<PathText text="cd /work/repo && cat exists.txt missing.txt" cwd="/home/me" />);
    await waitFor(() => expect(container.querySelectorAll('[data-path-link]')).toHaveLength(2));
    expect([...container.querySelectorAll('[data-path-link]')].map((e) => e.textContent)).toEqual(['/work/repo', 'exists.txt']);
    expect(container.textContent).toBe('cd /work/repo && cat exists.txt missing.txt');
    expect(ipc.statPaths).toHaveBeenCalledWith('/work/repo', ['/work/repo', 'exists.txt', 'missing.txt']);
  });

  it('asks the disk once for every block mounted together', async () => {
    const { container } = render(
      <>
        <PathText text="cat exists-a.md" cwd="/home/me" />
        <PathText text="cat exists-b.md" cwd="/home/me" />
      </>,
    );
    await waitFor(() => expect(container.querySelectorAll('[data-path-link]')).toHaveLength(2));
    expect(ipc.statPaths).toHaveBeenCalledTimes(1);
  });

  it('stays plain text with path links switched off', async () => {
    patchSettings({ pathLinksEnabled: false });
    const { container } = render(<PathText text="cat exists.txt" cwd="/home/me" />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector('[data-path-link]')).toBeNull();
    expect(ipc.statPaths).not.toHaveBeenCalled();
  });
});
