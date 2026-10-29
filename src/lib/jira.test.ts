import { describe, expect, it } from 'vitest';
import { findIssueKeys, firstIssueKey, issueUrl, parseIssueInput, stripIssueKey } from './jira';

describe('finding issue keys', () => {
  it('finds every key and where it sits', () => {
    expect(findIssueKeys('see PROJ-4821 and HELP-12', ['PROJ', 'HELP'])).toEqual([
      { key: 'PROJ-4821', index: 4 },
      { key: 'HELP-12', index: 18 },
    ]);
  });

  it('only the listed projects count, and no list means no links', () => {
    // These look exactly like issue keys — and a hover would cost a request.
    expect(findIssueKeys('UTF-8, SHA-256, PROJ-1', ['PROJ'])).toEqual([{ key: 'PROJ-1', index: 16 }]);
    expect(findIssueKeys('UTF-8, SHA-256, PROJ-1', [])).toEqual([]);
  });

  it('ignores lowercase, leading zeros and keys glued to other words', () => {
    expect(findIssueKeys('proj-1 PROJ-0 xPROJ-1 PROJ-1x', ['PROJ'])).toEqual([]);
  });
});

describe('a key in a session name', () => {
  it('lifts the key out with its separator', () => {
    expect(stripIssueKey('PROJ-4821 · Fix alert noise', 'PROJ-4821')).toBe('Fix alert noise');
    expect(stripIssueKey('[HELP-1] VPN drops', 'HELP-1')).toBe('VPN drops');
    expect(stripIssueKey('Fix alert noise (PROJ-4821)', 'PROJ-4821')).toBe('Fix alert noise');
  });

  it('keeps the name when the key is all there is', () => {
    expect(stripIssueKey('PROJ-4821', 'PROJ-4821')).toBe('PROJ-4821');
  });
});

describe('typed or pasted into New session', () => {
  it('takes a bare key, in any case', () => {
    expect(parseIssueInput(' proj-4821 ', ['PROJ'])).toBe('PROJ-4821');
  });

  it('takes a Jira URL that carries one', () => {
    expect(parseIssueInput('https://jira.example.com/browse/PROJ-4821', ['PROJ'])).toBe('PROJ-4821');
    expect(parseIssueInput('https://jira.example.com/projects/X?selectedIssue=HELP-7', ['HELP'])).toBe('HELP-7');
  });

  it('is nothing for nothing', () => {
    expect(parseIssueInput('', [])).toBeNull();
    expect(firstIssueKey('no keys here', [])).toBeNull();
  });
});

it('builds the browse URL whatever the base ends with', () => {
  expect(issueUrl('https://jira.example.com/', 'A1-2')).toBe('https://jira.example.com/browse/A1-2');
});

it('the issue card always shows the full date', async () => {
  const { formatIssueDate } = await import('@/components/IssueCard');
  const iso = new Date(2026, 9, 28, 14, 16).toISOString();
  expect(formatIssueDate(iso)).toBe('28.10.2026 14:16');
  expect(formatIssueDate(null)).toBeNull();
  expect(formatIssueDate('nonsense')).toBeNull();
});

describe('Jira lookups stay cheap', () => {
  it('asks once per key, shares in-flight requests, and remembers a failure', async () => {
    const ipc = await import('./ipc');
    const { fetchIssue, clearIssueCache } = await import('./jira');
    const { vi } = await import('vitest');
    clearIssueCache();
    const spy = vi.spyOn(ipc, 'jiraIssue')
      .mockResolvedValueOnce({ key: 'PROJ-1' } as never)
      .mockRejectedValueOnce('PROJ-2 not found');

    await Promise.all([fetchIssue('PROJ-1'), fetchIssue('PROJ-1')]);
    await fetchIssue('PROJ-1');
    await fetchIssue('PROJ-2').catch(() => {});
    await fetchIssue('PROJ-2').catch(() => {});

    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it('asks for your issues once, and hovering one of them asks nothing more', async () => {
    const ipc = await import('./ipc');
    const { fetchIssue, fetchIssueDetail, fetchMyIssues, clearIssueCache } = await import('./jira');
    const { vi } = await import('vitest');
    clearIssueCache();
    const mine = vi.spyOn(ipc, 'jiraMyIssues').mockResolvedValue([{ key: 'PROJ-7', summary: 'Mine', detail: { description: 'D', comment: null } } as never]);
    const one = vi.spyOn(ipc, 'jiraIssue');

    await fetchMyIssues('JIRA_API_TOKEN');
    await fetchMyIssues('JIRA_API_TOKEN');
    expect(mine).toHaveBeenCalledTimes(1);
    expect((await fetchIssue('PROJ-7')).summary).toBe('Mine');
    const detailSpy = vi.spyOn(ipc, 'jiraIssueDetail');
    expect((await fetchIssueDetail('PROJ-7')).description).toBe('D');
    expect(detailSpy).not.toHaveBeenCalled();
    detailSpy.mockRestore();
    expect(one).not.toHaveBeenCalled();
    // Refresh right away: inside the 30s floor, nothing leaves.
    await fetchMyIssues('JIRA_API_TOKEN', true);
    expect(mine).toHaveBeenCalledTimes(1);
    // Another token is another person: asks again.
    await fetchMyIssues('OTHER_TOKEN');
    expect(mine).toHaveBeenCalledTimes(2);
    mine.mockRestore();
    one.mockRestore();
  });
});

it('Jira is on only when switched on and given a URL', async () => {
  const { jiraOn } = await import('./jira');
  expect(jiraOn({ jiraEnabled: true, jiraBaseUrl: 'https://jira.example.com' })).toBe(true);
  expect(jiraOn({ jiraEnabled: false, jiraBaseUrl: 'https://jira.example.com' })).toBe(false);
  expect(jiraOn({ jiraEnabled: true, jiraBaseUrl: '' })).toBe(false);
});

it('sweeping across keys with a card open only shows the key the pointer stops on', async () => {
  const { vi } = await import('vitest');
  const { act, renderHook } = await import('@testing-library/react');
  const { showIssueCard, hideIssueCard, useIssueCard } = await import('./jira');
  vi.useFakeTimers();
  const { result } = renderHook(() => useIssueCard());
  const shown: string[] = [];
  const step = (key: string, ms: number) => {
    act(() => { showIssueCard(key, 0, 0); vi.advanceTimersByTime(ms); });
    const k = result.current?.key;
    if (k && shown[shown.length - 1] !== k) shown.push(k);
  };

  step('PROJ-1', 300);
  step('PROJ-2', 100); // passing over — never shown, never fetched
  step('PROJ-3', 100);
  step('PROJ-4', 300); // stopped here
  expect(shown).toEqual(['PROJ-1', 'PROJ-4']);

  act(() => { hideIssueCard(); vi.advanceTimersByTime(200); });
  vi.useRealTimers();
});
