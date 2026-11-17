import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ipc from '@/lib/ipc';
import { patchSettings, resetSettingsForTest } from '@/lib/settings-store';
import type { Tab } from '@/types';
import SessionEditDialog, { composeSessionName } from './SessionEditDialog';

vi.mock('@/lib/ipc');

const tab = (over: Partial<Tab> = {}) =>
  ({ id: 't1', name: 'Fix alert noise', kind: 'claude', projectDir: null, pinned: false, ...over } as Tab);

beforeEach(() => {
  resetSettingsForTest();
  vi.mocked(ipc.saveSettings).mockResolvedValue();
  patchSettings({ jiraEnabled: true, jiraBaseUrl: 'https://jira.example.com', jiraProjectKeys: ['PROJ'] });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('composeSessionName', () => {
  it('puts the key in front, the way New session does', () => {
    expect(composeSessionName(' Fix alert noise ', 'PROJ-1')).toBe('PROJ-1 · Fix alert noise');
    expect(composeSessionName('', 'PROJ-1')).toBe('PROJ-1');
    expect(composeSessionName('Fix alert noise', null)).toBe('Fix alert noise');
  });
});

describe('SessionEditDialog', () => {
  it('links a Jira issue, moves the session and pins it in one save', async () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<SessionEditDialog tab={tab()} projects={['/work/api']} onClose={onClose} onSave={onSave} />);
    await userEvent.type(screen.getByPlaceholderText('ABC-123'), 'https://jira.example.com/browse/PROJ-7');
    await userEvent.selectOptions(screen.getByLabelText('Project'), '/work/api');
    await userEvent.click(screen.getByLabelText('Pinned'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({ name: 'PROJ-7 · Fix alert noise', projectDir: '/work/api', pinned: true });
    expect(onClose).toHaveBeenCalled();
  });

  it('splits an existing key out of the name and can unlink it', async () => {
    const onSave = vi.fn();
    render(<SessionEditDialog tab={tab({ name: 'PROJ-3 · VPN drops' })} projects={[]} onClose={() => {}} onSave={onSave} />);
    expect(screen.getByLabelText('Name')).toHaveValue('VPN drops');
    await userEvent.clear(screen.getByPlaceholderText('ABC-123'));
    await userEvent.type(screen.getByLabelText('Name'), '{Enter}');
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: 'VPN drops' }));
  });

  it('refuses text that is not a key instead of dropping it', async () => {
    render(<SessionEditDialog tab={tab()} projects={[]} onClose={() => {}} onSave={() => {}} />);
    await userEvent.type(screen.getByPlaceholderText('ABC-123'), 'nonsense');
    expect(screen.getByText(/Not a key from PROJ/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
