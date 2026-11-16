import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ipc');

import * as ipc from '@/lib/ipc';
import { clearIssueCache } from '@/lib/jira';
import { patchSettings, resetSettingsForTest } from '@/lib/settings-store';
import type { Tab } from '@/types';
import NewSessionDialog from './NewSessionDialog';

const tab = (id: string, name: string, over: Partial<Tab> = {}): Tab => ({
  id, name, kind: 'claude', cwd: '/p', projectDir: '/p', shellId: null, resumeSessionId: null,
  exited: false, status: 'idle', ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  resetSettingsForTest();
  clearIssueCache();
  vi.mocked(ipc.saveSettings).mockResolvedValue();
  vi.mocked(ipc.jiraIssue).mockResolvedValue({
    key: 'ITA-7', summary: 'Rotate cert', status: 'Open', statusCategory: 'new',
    assignee: null, reporter: null, priority: null, created: null, updated: null,
  });
  patchSettings({
    jiraEnabled: true, jiraBaseUrl: 'https://jira.example.com', jiraProjectKeys: ['ITA'],
    jiraPromptTemplates: { ITA: 'work on {key}' },
  });
});
afterEach(cleanup);

function renderDialog(sessions: Tab[]) {
  const onStart = vi.fn();
  const onResume = vi.fn();
  render(
    <NewSessionDialog
      open onOpenChange={vi.fn()} defaultDir={null} projects={[]} counts={new Map()}
      onStart={onStart} onAddProject={vi.fn()}
      initialIssue={{ key: 'ITA-7', summary: 'Rotate cert' }}
      sessions={sessions}
      lastUsed={new Map([['old', 1_000], ['new', 2_000]])}
      onResume={onResume}
    />,
  );
  return { onStart, onResume, dialog: screen.getByRole('dialog') };
}

describe('New session for a ticket that already has sessions', () => {
  it('offers the latest one and resumes it on Enter', () => {
    const { onStart, onResume, dialog } = renderDialog([
      tab('a', 'ITA-7 · first try', { resumeSessionId: 'old' }),
      tab('b', 'ITA-7 · second try', { resumeSessionId: 'new', writes: 2 }),
      tab('c', 'unrelated'),
    ]);
    expect(screen.getByText('ITA-7 already has 2 sessions')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume latest' })).toBeInTheDocument();

    fireEvent.keyDown(dialog, { key: 'Enter' });
    expect(onResume).toHaveBeenCalledWith('b');
    expect(onStart).not.toHaveBeenCalled();
  });

  it('⌘Enter starts a new one anyway, with the project template as the prompt', () => {
    const { onStart, onResume, dialog } = renderDialog([tab('a', 'ITA-7 · first try')]);
    fireEvent.keyDown(dialog, { key: 'Enter', metaKey: true });
    expect(onResume).not.toHaveBeenCalled();
    expect(onStart).toHaveBeenCalledWith(null, 'claude', 'ITA-7 · Rotate cert', 'work on ITA-7');
  });

  it('says nothing when the ticket has no session yet', () => {
    const { onStart, dialog } = renderDialog([tab('c', 'unrelated')]);
    expect(screen.queryByText(/already has/)).not.toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: 'Enter' });
    expect(onStart).toHaveBeenCalledOnce();
  });
});
