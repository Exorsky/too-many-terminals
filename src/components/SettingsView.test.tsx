import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ipc from '@/lib/ipc';
import { resetSettingsForTest } from '@/lib/settings-store';
import SettingsView from './SettingsView';

vi.mock('@/lib/ipc');

beforeEach(() => {
  resetSettingsForTest();
  vi.mocked(ipc.loadSettings).mockResolvedValue({
    selectedThemeId: 'default', customThemes: [], showSessionBar: true, showMarkdownToggle: true,
  });
  vi.mocked(ipc.saveSettings).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SettingsView', () => {
  it('shows the General tab with the session-bar preferences by default', () => {
    render(<SettingsView />);
    expect(screen.getByText('Show the session bar')).toBeInTheDocument();
    expect(screen.getByText('Show the Markdown toggle')).toBeInTheDocument();
  });

  it('toggling a preference persists it', async () => {
    render(<SettingsView />);
    await userEvent.click(screen.getByRole('switch', { name: 'Show the session bar' }));
    expect(ipc.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ showSessionBar: false }));
  });

  it('disables the Markdown toggle switch when the bar is hidden', async () => {
    render(<SettingsView />);
    await userEvent.click(screen.getByRole('switch', { name: 'Show the session bar' }));
    expect(screen.getByRole('switch', { name: 'Show the Markdown toggle' })).toBeDisabled();
  });

  it('switches to the Customize tab on click', async () => {
    render(<SettingsView />);
    await userEvent.click(screen.getByText('Customize'));
    expect(await screen.findByText('Theme')).toBeInTheDocument();
  });
});
