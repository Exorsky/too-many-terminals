import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ipc');

import * as ipc from '@/lib/ipc';
import FileViewer from './FileViewer';

afterEach(cleanup);

describe('FileViewer', () => {
  it('shows plain text content for a non-markdown file', async () => {
    vi.mocked(ipc.readFile).mockResolvedValue('console.log("hi")');
    render(<FileViewer path="/proj/index.ts" />);

    expect(await screen.findByText('console.log("hi")')).toBeInTheDocument();
  });

  it('renders markdown content through the Markdown component', async () => {
    vi.mocked(ipc.readFile).mockResolvedValue('# Title\n\nSome text.');
    render(<FileViewer path="/proj/README.md" />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Title' })).toBeInTheDocument();
  });

  it('shows the backend error message when the read fails', async () => {
    vi.mocked(ipc.readFile).mockRejectedValue('Not a text file');
    render(<FileViewer path="/proj/photo.png" />);

    expect(await screen.findByText('Not a text file')).toBeInTheDocument();
  });
});
