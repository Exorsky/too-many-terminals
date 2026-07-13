import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ipc from '@/lib/ipc';
import type { SessionHistoryEntry, TranscriptTurn } from '@/types';
import SessionReader from './SessionReader';

vi.mock('@/lib/ipc');

const entry: SessionHistoryEntry = {
  sessionId: 'a1f7c92xyz',
  preview: 'fix the pty kill',
  lastUsedIso: '2026-07-11T14:22:00Z',
};

const turns: TranscriptTurn[] = [
  { role: 'user', timestamp: '2026-07-11T14:22:00Z', blocks: [{ kind: 'text', text: 'fix pty.rs' }] },
  {
    role: 'assistant',
    timestamp: '2026-07-11T14:22:10Z',
    blocks: [
      { kind: 'text', text: 'Use `taskkill` with **/T**.' },
      { kind: 'tool', name: 'Edit', detail: 'src/pty.rs' },
    ],
  },
];

beforeEach(() => {
  vi.mocked(ipc.readTranscript).mockResolvedValue(turns);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderReader() {
  return render(
    <SessionReader projectDir="/home/dev/app" entry={entry} onClose={() => {}} onResume={() => {}} />,
  );
}

describe('SessionReader', () => {
  it('renders user text and assistant markdown once the transcript loads', async () => {
    renderReader();
    expect(await screen.findByText('fix pty.rs')).toBeInTheDocument();
    // inline markdown: code span + bold rendered as their own elements
    expect(screen.getByText('taskkill').tagName).toBe('CODE');
    expect(screen.getByText('/T').tagName).toBe('STRONG');
    // tool call collapses to a chip showing its name + argument
    expect(screen.getByText('Edit')).toBeInTheDocument();
    expect(screen.getByText('src/pty.rs')).toBeInTheDocument();
    expect(screen.getByText('2 turns')).toBeInTheDocument();
  });

  it('switches to the raw Markdown source and back', async () => {
    renderReader();
    await screen.findByText('fix pty.rs');

    await userEvent.click(screen.getByText('Raw'));
    // raw view shows the serialized document, headings and all
    const pre = document.querySelector('pre');
    expect(pre?.textContent).toContain('## Claude');
    expect(pre?.textContent).toContain('> Edit: src/pty.rs');

    await userEvent.click(screen.getByText('Rendered'));
    expect(screen.getByText('taskkill').tagName).toBe('CODE');
  });

  it('copies the whole conversation as Markdown', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderReader();
    await screen.findByText('fix pty.rs');
    await userEvent.click(screen.getByText('Copy all'));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).toContain('## You\n\nfix pty.rs');
  });

  it('surfaces a friendly error when the transcript cannot be read', async () => {
    vi.mocked(ipc.readTranscript).mockRejectedValue('gone');
    renderReader();
    expect(await screen.findByText("Couldn't read this session")).toBeInTheDocument();
  });
});
