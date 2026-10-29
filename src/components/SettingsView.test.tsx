import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ipc from '@/lib/ipc';
import { resetSettingsForTest, DEFAULT_SETTINGS } from '@/lib/settings-store';

/** Fields added after these fixtures were written. */
const { newTabPosition, jiraEnabled, jiraBaseUrl, jiraProjectKeys, jiraTokenVar } = DEFAULT_SETTINGS;
const NEW_DEFAULTS = { newTabPosition, jiraEnabled, jiraBaseUrl, jiraProjectKeys, jiraTokenVar };
import SettingsView from './SettingsView';

vi.mock('@/lib/ipc');

beforeEach(() => {
  resetSettingsForTest();
  vi.mocked(ipc.loadSettings).mockResolvedValue({
    selectedThemeId: 'default', customThemes: [], showMarkdownToggle: true, notificationsEnabled: true, autoSleepMinutes: 15, usageRefreshSeconds: 60, compactList: false, ...NEW_DEFAULTS,
  });
  vi.mocked(ipc.saveSettings).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SettingsView', () => {
  it('shows the Interface category with the Markdown Preview preference by default', () => {
    render(<SettingsView />);
    expect(screen.getByText('Show Markdown Preview')).toBeInTheDocument();
  });

  it('toggling the preference persists it', async () => {
    render(<SettingsView />);
    await userEvent.click(screen.getByRole('switch', { name: 'Show Markdown Preview' }));
    expect(ipc.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ showMarkdownToggle: false }));
  });

  it('toggles the notification preference from the Notifications category', async () => {
    render(<SettingsView />);
    await userEvent.click(screen.getByText('Notifications'));
    await userEvent.click(screen.getByRole('switch', { name: 'Notify when a session needs you' }));
    expect(ipc.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ notificationsEnabled: false }));
  });

  it('links to the OS notification settings when the platform has a settings pane', async () => {
    vi.mocked(ipc.canOpenSystemNotificationSettings).mockReturnValue(true);
    render(<SettingsView />);
    await userEvent.click(screen.getByText('Notifications'));
    await userEvent.click(screen.getByRole('button', { name: 'system notification settings' }));
    expect(ipc.openSystemNotificationSettings).toHaveBeenCalled();
  });

  it('omits the settings link on platforms without a notification settings pane', async () => {
    vi.mocked(ipc.canOpenSystemNotificationSettings).mockReturnValue(false);
    render(<SettingsView />);
    await userEvent.click(screen.getByText('Notifications'));
    expect(screen.queryByRole('button', { name: 'system notification settings' })).not.toBeInTheDocument();
  });

  it('changing the auto-sleep threshold persists it from the Sessions category', async () => {
    render(<SettingsView />);
    await userEvent.click(screen.getByText('Sessions'));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Auto-sleep idle sessions' }), '30');
    expect(ipc.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ autoSleepMinutes: 30 }));
  });

  it('switches to the Appearance category on click', async () => {
    render(<SettingsView />);
    await userEvent.click(screen.getByText('Appearance'));
    expect(await screen.findByText('Theme')).toBeInTheDocument();
  });
});

describe('the Jira token variable', () => {
  it('takes a variable name and refuses a pasted token', async () => {
    const { isEnvVarName } = await import('./SettingsView');
    expect(isEnvVarName('JIRA_API_TOKEN')).toBe(true);
    expect(isEnvVarName('aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abcdEFGH')).toBe(false);
    expect(isEnvVarName('jira token')).toBe(false);
  });
});

describe('Settings › Integrations › Jira', () => {
  it('has its own switch, and the rail shows whether it is on', async () => {
    render(<SettingsView />);
    const rail = screen.getByRole('navigation', { name: 'Settings' });
    expect(within(rail).getByLabelText('Off')).toBeInTheDocument();
    await userEvent.click(within(rail).getByRole('button', { name: /Jira/ }));
    await userEvent.click(screen.getByRole('switch', { name: 'Jira' }));
    expect(ipc.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ jiraEnabled: true }));
    // On, but no URL yet: nothing works, so the dot doesn't claim otherwise.
    expect(within(rail).getByLabelText('Off')).toBeInTheDocument();
    const url = screen.getByLabelText('Jira URL');
    await userEvent.type(url, 'https://jira.example.com');
    url.blur();
    expect(await within(rail).findByLabelText('On')).toBeInTheDocument();
  });

  it('refuses a pasted token: not saved, and cleared from the field', async () => {
    render(<SettingsView />);
    await userEvent.click(screen.getByRole('button', { name: /Jira/ }));
    const field = screen.getByLabelText('Token variable') as HTMLInputElement;
    await userEvent.type(field, 'aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abcdEFGH');
    field.blur();
    await screen.findByText(/looks like the token itself/);
    expect(field.value).toBe('');
    const saved = vi.mocked(ipc.saveSettings).mock.calls.map((c) => c[0].jiraTokenVar);
    expect(saved).not.toContain('aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abcdEFGH');
  });
});
