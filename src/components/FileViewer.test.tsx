import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Tab } from '@/types';

vi.mock('@/lib/ipc');

import * as ipc from '@/lib/ipc';
import FileViewer from './FileViewer';

afterEach(cleanup);

function makeTab(path: string, overrides: Partial<Tab> = {}): Tab {
  return {
    id: 't1',
    kind: 'file',
    name: path.split('/').pop()!,
    shellId: null,
    cwd: '/proj',
    resumeSessionId: null,
    exited: false,
    status: 'new',
    path,
    ...overrides,
  };
}

describe('FileViewer', () => {
  it('loads the file and clears the loading state', async () => {
    vi.mocked(ipc.readFile).mockResolvedValue('console.log("hi")');
    render(<FileViewer tab={makeTab('/proj/index.ts')} isVisible onDirtyChange={vi.fn()} />);

    expect(screen.getByText('Loading…')).toBeInTheDocument();
    await screen.findByText('Saved');
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('shows the backend error message when the read fails', async () => {
    vi.mocked(ipc.readFile).mockRejectedValue('Not a text file');
    render(<FileViewer tab={makeTab('/proj/photo.png')} isVisible onDirtyChange={vi.fn()} />);

    expect(await screen.findByText('Not a text file')).toBeInTheDocument();
  });

  it('shows a Source/Preview toggle only for markdown files', async () => {
    vi.mocked(ipc.readFile).mockResolvedValue('# Title');
    render(<FileViewer tab={makeTab('/proj/README.md')} isVisible onDirtyChange={vi.fn()} />);
    expect(await screen.findByText('Preview')).toBeInTheDocument();

    cleanup();
    vi.mocked(ipc.readFile).mockResolvedValue('plain text');
    render(<FileViewer tab={makeTab('/proj/notes.txt')} isVisible onDirtyChange={vi.fn()} />);
    await screen.findByText('Saved');
    expect(screen.queryByText('Preview')).not.toBeInTheDocument();
  });

  it('shows the unsaved indicator when the tab is dirty', async () => {
    vi.mocked(ipc.readFile).mockResolvedValue('hello');
    render(<FileViewer tab={makeTab('/proj/notes.txt', { dirty: true })} isVisible onDirtyChange={vi.fn()} />);

    expect(await screen.findByText(/Unsaved changes/)).toBeInTheDocument();
  });

  it('is hidden (display:none) when not the visible tab', async () => {
    vi.mocked(ipc.readFile).mockResolvedValue('hello');
    const { container } = render(<FileViewer tab={makeTab('/proj/notes.txt')} isVisible={false} onDirtyChange={vi.fn()} />);

    const root = container.firstElementChild as HTMLElement;
    expect(root.style.display).toBe('none');
  });
});
