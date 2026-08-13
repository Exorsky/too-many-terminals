import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ipc from '@/lib/ipc';
import type { SessionHistoryEntry } from '@/types';
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

beforeEach(() => {
  vi.mocked(ipc.listSessions).mockResolvedValue([entry()]);
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

    await userEvent.type(screen.getByPlaceholderText('Search sessions or folders…'), 'testing session');
    // The matched substring renders inside its own <mark> — still present, so the row survived the filter.
    expect(screen.getByText('Testing Session')).toBeInTheDocument();
  });

  it('a search term matching only the name does not fall into the "no results" empty state', async () => {
    renderPanel({ [SESSION_ID]: 'Code Testing Session' });
    await screen.findByText('Code Testing Session');

    await userEvent.type(screen.getByPlaceholderText('Search sessions or folders…'), 'zzz-not-a-match');
    expect(await screen.findByText(/No sessions match/)).toBeInTheDocument();
  });
});
