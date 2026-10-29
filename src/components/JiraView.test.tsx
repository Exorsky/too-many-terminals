import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ipc');

import * as ipc from '@/lib/ipc';
import type { JiraIssue } from '@/lib/ipc';
import { clearIssueCache } from '@/lib/jira';
import { patchSettings, resetSettingsForTest } from '@/lib/settings-store';
import type { Tab } from '@/types';
import JiraView from './JiraView';

const issue = (key: string, summary: string, statusCategory: string, status: string): JiraIssue => ({
  key, summary, status, statusCategory, assignee: 'Me', reporter: null, priority: 'High', created: null, updated: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  resetSettingsForTest();
  clearIssueCache();
  vi.mocked(ipc.saveSettings).mockResolvedValue();
  patchSettings({ jiraEnabled: true, jiraBaseUrl: 'https://jira.example.com', jiraProjectKeys: ['PROJ'], jiraTokenVar: 'JIRA_API_TOKEN' });
});
afterEach(cleanup);

describe('My issues', () => {
  it('groups your issues; the chip shows only an unusual status', async () => {
    vi.mocked(ipc.jiraMyIssues).mockResolvedValue([
      issue('PROJ-2', 'Waiting one', 'new', 'Open'),
      issue('PROJ-1', 'Busy one', 'indeterminate', 'In Progress'),
      issue('PROJ-3', 'Stuck one', 'indeterminate', 'Escalated'),
    ]);
    render(<JiraView sessions={[]} onOpenSession={vi.fn()} onNewSession={vi.fn()} />);
    expect(await screen.findByText('Busy one')).toBeInTheDocument();
    expect(screen.getAllByText(/one$/).map((e) => e.textContent)).toEqual(['Busy one', 'Stuck one', 'Waiting one']);
    expect(screen.getByText('Escalated')).toBeInTheDocument();
    expect(screen.queryByText('In Progress')).toBeNull();
    expect(screen.queryByText('Open')).toBeNull();
  });

  it('a click opens the details; the one action opens the session or starts one', async () => {
    vi.mocked(ipc.jiraMyIssues).mockResolvedValue([
      issue('PROJ-1', 'Busy one', 'indeterminate', 'In Progress'),
      issue('PROJ-2', 'Waiting one', 'new', 'Open'),
    ]);
    vi.mocked(ipc.jiraIssueDetail).mockResolvedValue({ description: 'Cut over MX', comment: { author: 'A', created: null, body: 'Ready' } });
    const onOpenSession = vi.fn();
    const onNewSession = vi.fn();
    const sessions = [{ id: 's1', name: 'PROJ-1 · Busy one', kind: 'claude', status: 'idle' } as Tab];
    render(<JiraView sessions={sessions} onOpenSession={onOpenSession} onNewSession={onNewSession} />);

    await userEvent.click(await screen.findByText('Busy one'));
    const details = screen.getByRole('complementary', { name: 'PROJ-1 details' });
    expect(await within(details).findByText('Cut over MX')).toBeInTheDocument();
    expect(within(details).getByText('Ready')).toBeInTheDocument();
    await userEvent.click(within(details).getByRole('button', { name: /Open session/ }));
    expect(onOpenSession).toHaveBeenCalledWith('s1');

    // Double-click acts straight from the row.
    await userEvent.dblClick(screen.getByText('Waiting one'));
    expect(onNewSession).toHaveBeenCalledWith('PROJ-2', 'Waiting one');
  });

  it('priority names fold onto four glyphs', async () => {
    const { priorityLevel } = await import('./JiraView');
    expect(priorityLevel('Blocker')).toBe('critical');
    expect(priorityLevel('Major')).toBe('high');
    expect(priorityLevel('Medium')).toBe('medium');
    expect(priorityLevel('Trivial')).toBe('low');
    expect(priorityLevel(null)).toBeNull();
  });

  it('marks issues where someone else wrote the latest comment', async () => {
    vi.mocked(ipc.jiraMyIssues).mockResolvedValue([
      { ...issue('PROJ-1', 'Answered one', 'indeterminate', 'In Progress'), replyFrom: 'A. Roe', replyAt: null },
      issue('PROJ-2', 'Quiet one', 'indeterminate', 'In Progress'),
    ]);
    render(<JiraView sessions={[]} onOpenSession={vi.fn()} onNewSession={vi.fn()} />);
    expect(await screen.findByText('A. Roe')).toBeInTheDocument();
    expect(screen.getByText(/1 reply/)).toBeInTheDocument();
  });

  it('asks nothing without a token', () => {
    patchSettings({ jiraTokenVar: '' });
    render(<JiraView sessions={[]} onOpenSession={vi.fn()} onNewSession={vi.fn()} />);
    expect(screen.getByText('No token')).toBeInTheDocument();
    expect(ipc.jiraMyIssues).not.toHaveBeenCalled();
  });

  it('a failed refresh keeps the list and says why', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(ipc.jiraMyIssues)
      .mockResolvedValueOnce([issue('PROJ-1', 'Busy one', 'indeterminate', 'In Progress')])
      .mockRejectedValueOnce('Jira unreachable — VPN?');
    render(<JiraView sessions={[]} onOpenSession={vi.fn()} onNewSession={vi.fn()} />);
    await screen.findByText('Busy one');
    vi.advanceTimersByTime(31_000);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/VPN\?/);
    expect(screen.getByText('Busy one')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('says why when Jira refuses', async () => {
    vi.mocked(ipc.jiraMyIssues).mockRejectedValue('Jira redirected to sign-in — VPN?');
    render(<JiraView sessions={[]} onOpenSession={vi.fn()} onNewSession={vi.fn()} />);
    expect(await screen.findByText(/VPN\?/)).toBeInTheDocument();
  });
});
