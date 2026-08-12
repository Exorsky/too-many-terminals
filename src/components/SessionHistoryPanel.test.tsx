import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ipc from '@/lib/ipc';
import type { SessionHistoryEntry, Tab } from '@/types';
import SessionHistoryPanel from './SessionHistoryPanel';

vi.mock('@/lib/ipc');

const PROJECT = 'C:\\Users\\x\\project';

function entry(overrides: Partial<SessionHistoryEntry> = {}): SessionHistoryEntry {
  return {
    sessionId: 'f4b51762-11f9-4fb5-bf45-208b462912fe',
    preview: 'add a script to bulk-rename screenshots',
    lastUsedIso: new Date().toISOString(),
    ...overrides,
  };
}

function tab(overrides: Partial<Tab> = {}): Tab {
  return {
    id: 't1',
    kind: 'claude',
    name: 'Claude',
    shellId: null,
    cwd: PROJECT,
    resumeSessionId: null,
    exited: false,
    status: 'new',
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

function renderPanel(tabs: Tab[] = []) {
  const onResume = vi.fn();
  const onRead = vi.fn();
  render(
    <SessionHistoryPanel projects={[PROJECT]} tabs={tabs} onResume={onResume} onRead={onRead} />,
  );
  return { onResume, onRead };
}

describe('SessionHistoryPanel', () => {
  it('falls back to the raw preview when no tab was ever named for this session', async () => {
    renderPanel([]);
    expect(await screen.findByText('add a script to bulk-rename screenshots')).toBeInTheDocument();
  });

  it('shows the session\'s assigned tab name above the preview when one exists', async () => {
    renderPanel([
      tab({ resumeSessionId: 'f4b51762-11f9-4fb5-bf45-208b462912fe', name: 'Code Testing Session' }),
    ]);
    expect(await screen.findByText('Code Testing Session')).toBeInTheDocument();
    expect(screen.getByText('add a script to bulk-rename screenshots')).toBeInTheDocument();
  });

  it('ignores the still-unnamed placeholder — a fresh tab has no real name yet', async () => {
    renderPanel([tab({ resumeSessionId: 'f4b51762-11f9-4fb5-bf45-208b462912fe', name: 'Claude' })]);
    await screen.findByText('add a script to bulk-rename screenshots');
    expect(screen.queryAllByText('Claude')).toHaveLength(0);
  });

  it('search matches a session by its assigned name, not just the raw preview', async () => {
    renderPanel([
      tab({ resumeSessionId: 'f4b51762-11f9-4fb5-bf45-208b462912fe', name: 'Code Testing Session' }),
    ]);
    await screen.findByText('Code Testing Session');

    await userEvent.type(screen.getByPlaceholderText('Search sessions or folders…'), 'testing session');
    // The matched substring renders inside its own <mark> — still present, so the row survived the filter.
    expect(screen.getByText('Testing Session')).toBeInTheDocument();
  });

  it('a search term matching only the name does not fall into the "no results" empty state', async () => {
    renderPanel([
      tab({ resumeSessionId: 'f4b51762-11f9-4fb5-bf45-208b462912fe', name: 'Code Testing Session' }),
    ]);
    await screen.findByText('Code Testing Session');

    await userEvent.type(screen.getByPlaceholderText('Search sessions or folders…'), 'zzz-not-a-match');
    expect(await screen.findByText(/No sessions match/)).toBeInTheDocument();
  });
});
