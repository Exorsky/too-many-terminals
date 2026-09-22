import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ipc from '@/lib/ipc';
import type { SessionHistoryEntry, TranscriptHit } from '@/types';
import SessionHistoryPanel from './SessionHistoryPanel';

vi.mock('@/lib/ipc');

const PROJECT = 'C:\\Users\\x\\project';
const SESSION_ID = 'f4b51762-11f9-4fb5-bf45-208b462912fe';

function entry(overrides: Partial<SessionHistoryEntry> = {}): SessionHistoryEntry {
  return {
    sessionId: SESSION_ID,
    preview: 'add a script to bulk-rename screenshots',
    lastUsedIso: new Date().toISOString(),
    ...overrides,
  };
}

function hit(overrides: Partial<TranscriptHit> = {}): TranscriptHit {
  return {
    sessionId: SESSION_ID,
    projectDir: PROJECT,
    snippet: '…we kept getting 429 responses from the upstream…',
    role: 'assistant',
    matchCount: 3,
    lastUsedIso: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(ipc.listSessions).mockResolvedValue([entry()]);
  vi.mocked(ipc.searchTranscripts).mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPanel(sessionNames: Record<string, string> = {}) {
  const onResume = vi.fn();
  const onRead = vi.fn();
  render(
    <SessionHistoryPanel
      projects={[PROJECT]}
      sessionNames={sessionNames}
      onResume={onResume}
      onRead={onRead}
    />,
  );
  return { onResume, onRead };
}

describe('SessionHistoryPanel', () => {
  it('falls back to the raw preview when this session was never named', async () => {
    renderPanel();
    expect(await screen.findByText('add a script to bulk-rename screenshots')).toBeInTheDocument();
  });

  // The reported bug: names used to be read off the open tabs, so closing a
  // session's tab stripped its title from History and left an unrecognizable
  // row. The store outlives the tab, so no tab needs to exist here.
  it('names a session whose tab is long closed', async () => {
    renderPanel({ [SESSION_ID]: 'Code Testing Session' });
    expect(await screen.findByText('Code Testing Session')).toBeInTheDocument();
    expect(screen.getByText('add a script to bulk-rename screenshots')).toBeInTheDocument();
  });

  it('search matches a session by its name, not just the raw preview', async () => {
    renderPanel({ [SESSION_ID]: 'Code Testing Session' });
    await screen.findByText('Code Testing Session');

    await userEvent.type(screen.getByPlaceholderText('Search names, folders and transcripts…'), 'testing session');
    // The matched substring renders inside its own <mark> — still present, so the row survived the filter.
    expect(screen.getByText('Testing Session')).toBeInTheDocument();
  });

  it('a search term matching only the name does not fall into the "no results" empty state', async () => {
    renderPanel({ [SESSION_ID]: 'Code Testing Session' });
    await screen.findByText('Code Testing Session');

    await userEvent.type(screen.getByPlaceholderText('Search names, folders and transcripts…'), 'zzz-not-a-match');
    expect(await screen.findByText(/No sessions match/)).toBeInTheDocument();
  });

  describe('the calendar', () => {
    const OLD_ID = 'a0000000-0000-0000-0000-000000000000';
    const fiveDaysAgo = new Date(Date.now() - 5 * 86_400_000);

    beforeEach(() => {
      vi.mocked(ipc.listSessions).mockResolvedValue([
        entry(),
        entry({ sessionId: OLD_ID, preview: 'why does the pty die', lastUsedIso: fiveDaysAgo.toISOString() }),
      ]);
    });

    it('scopes the list to the day you click, and back', async () => {
      renderPanel();
      await screen.findByText('add a script to bulk-rename screenshots');

      const month = fiveDaysAgo.toLocaleString('en-US', { month: 'short' });
      const cell = `${month} ${fiveDaysAgo.getFullYear()} ${fiveDaysAgo.getDate()} — 1 session`;
      await userEvent.click(screen.getByRole('button', { name: cell }));

      // Twice over: the surviving row, and the hover caption the click left behind.
      expect(screen.getAllByText('why does the pty die').length).toBeGreaterThan(0);
      expect(screen.queryByText('add a script to bulk-rename screenshots')).not.toBeInTheDocument();
      expect(screen.getByTitle('Show every date')).toBeInTheDocument();

      // The chip clears the day — the grid it was picked from never filtered itself.
      await userEvent.click(screen.getByTitle('Show every date'));
      expect(screen.getByText('add a script to bulk-rename screenshots')).toBeInTheDocument();
    });

    it('hides and shows the grid', async () => {
      renderPanel();
      await screen.findByText('Sessions per day');

      await userEvent.click(screen.getByTitle('Hide the calendar (c)'));
      expect(screen.queryByText('Sessions per day')).not.toBeInTheDocument();

      await userEvent.click(screen.getByTitle('Show the calendar (c)'));
      expect(screen.getByText('Sessions per day')).toBeInTheDocument();
    });
  });
});

describe('SessionHistoryPanel transcript search', () => {
  it('surfaces a session whose match is inside the transcript, not the preview', async () => {
    // The preview is only the first message, which is exactly the limitation
    // this search exists to remove.
    vi.mocked(ipc.searchTranscripts).mockResolvedValue([hit()]);
    renderPanel();
    await screen.findByText(/bulk-rename screenshots/);

    await userEvent.type(screen.getByPlaceholderText('Search names, folders and transcripts…'), '429');

    expect(await screen.findByText(/responses from the upstream/)).toBeInTheDocument();
    expect(screen.getByText('3 in text')).toBeInTheDocument();
  });

  it('carries in a hit from a project that is not open', async () => {
    vi.mocked(ipc.searchTranscripts).mockResolvedValue([
      hit({ sessionId: 'other-session', projectDir: '/home/x/closed-project', snippet: 'the 429 came from Loki' }),
    ]);
    renderPanel();
    await screen.findByText(/bulk-rename screenshots/);

    await userEvent.type(screen.getByPlaceholderText('Search names, folders and transcripts…'), '429');

    // Search covers every transcript on disk; a folder you closed months ago is
    // precisely the one you can no longer find by scrolling.
    expect(await screen.findByText(/came from Loki/)).toBeInTheDocument();
  });

  it('says it is still looking while the scan runs', async () => {
    // Until this resolves the list shows only metadata matches, and a thin list
    // with no explanation reads as "there is nothing else", which is a lie.
    let release: (hits: TranscriptHit[]) => void = () => {};
    vi.mocked(ipc.searchTranscripts).mockReturnValue(
      new Promise<TranscriptHit[]>((resolve) => { release = resolve; }),
    );
    renderPanel();
    await screen.findByText(/bulk-rename screenshots/);

    await userEvent.type(screen.getByPlaceholderText('Search names, folders and transcripts…'), '429');

    expect(await screen.findByRole('status')).toHaveTextContent('Searching transcripts…');

    release([hit()]);
    await screen.findByText(/responses from the upstream/);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does not scan on a one-character query', async () => {
    renderPanel();
    await screen.findByText(/bulk-rename screenshots/);

    await userEvent.type(screen.getByPlaceholderText('Search names, folders and transcripts…'), 'q');

    expect(ipc.searchTranscripts).not.toHaveBeenCalled();
  });
});
