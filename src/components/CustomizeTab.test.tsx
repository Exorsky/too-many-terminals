import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ipc from '@/lib/ipc';
import { resetSettingsForTest, DEFAULT_SETTINGS } from '@/lib/settings-store';

/** Fields added after these fixtures were written. */
const { newTabPosition, jiraEnabled, jiraBaseUrl, jiraProjectKeys, jiraTokenVar } = DEFAULT_SETTINGS;
const NEW_DEFAULTS = { newTabPosition, jiraEnabled, jiraBaseUrl, jiraProjectKeys, jiraTokenVar };
import CustomizeTab from './CustomizeTab';
import ConfirmDialog from './ConfirmDialog';

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

describe('CustomizeTab', () => {
  it('sorts presets into dark and light', async () => {
    render(<CustomizeTab />);
    const light = await screen.findByRole('region', { name: 'Light themes' });
    expect(within(light).getByText('Catppuccin Latte')).toBeInTheDocument();
    expect(within(light).queryByText('Default')).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Dark themes' })).getByText('Tokyo Night')).toBeInTheDocument();
  });

  it('imports a pasted scheme as a custom theme and saves it', async () => {
    render(<CustomizeTab />);
    await userEvent.click(await screen.findByRole('button', { name: /Import/ }));
    const field = screen.getByLabelText('Color scheme');
    fireEvent.change(field, { target: { value: 'nonsense' } });
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(screen.getByText(/Not a scheme this can read/)).toBeInTheDocument();

    fireEvent.change(field, { target: { value: JSON.stringify({
      name: 'Pasted', background: '#101010', foreground: '#eeeeee',
      red: '#ff0000', green: '#00ff00', yellow: '#ffff00', blue: '#0000ff', purple: '#ff00ff', cyan: '#00ffff',
    }) } });
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(screen.getByLabelText('Theme name')).toHaveValue('Pasted');
    const calls = vi.mocked(ipc.saveSettings).mock.calls;
    const saved = calls[calls.length - 1][0];
    expect(saved.customThemes).toEqual([expect.objectContaining({ name: 'Pasted' })]);
  });

  it('renders all built-in presets', async () => {
    render(<CustomizeTab />);
    expect(await screen.findByText('Default')).toBeInTheDocument();
    expect(screen.getByText('Amber')).toBeInTheDocument();
    expect(screen.getByText('Violet')).toBeInTheDocument();
    expect(screen.getByText('Seafoam')).toBeInTheDocument();
  });

  it('renders saved custom themes from settings', async () => {
    vi.mocked(ipc.loadSettings).mockResolvedValue({
      selectedThemeId: 'my-theme',
      customThemes: [{ id: 'my-theme', name: 'My Theme', colors: {} }],
      showMarkdownToggle: true, notificationsEnabled: true, autoSleepMinutes: 15, usageRefreshSeconds: 60, compactList: false, ...NEW_DEFAULTS,
    });
    render(<CustomizeTab />);
    expect(await screen.findByText('My Theme')).toBeInTheDocument();
  });

  it('selecting a preset persists it and updates CSS variables', async () => {
    render(<CustomizeTab />);
    await userEvent.click(await screen.findByText('Amber'));

    expect(ipc.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ selectedThemeId: 'amber', customThemes: [] }));
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('#e8b45a');
  });

  it('duplicating a theme opens the editor and persists the copy', async () => {
    render(<CustomizeTab />);
    await userEvent.click(await screen.findByLabelText('Duplicate Violet'));

    expect(screen.getByText('Violet copy')).toBeInTheDocument();
    expect(screen.getByLabelText('Theme name')).toHaveValue('Violet copy');

    const saved = vi.mocked(ipc.saveSettings).mock.lastCall![0];
    expect(saved.customThemes).toHaveLength(1);
    const copy = saved.customThemes[0] as { id: string; name: string };
    expect(copy.name).toBe('Violet copy');
    expect(saved.selectedThemeId).toBe(copy.id);
  });

  it('editing a color live-previews and Save persists it', async () => {
    render(<CustomizeTab />);
    await userEvent.click(await screen.findByLabelText('Duplicate Default'));
    vi.mocked(ipc.saveSettings).mockClear();

    fireEvent.change(screen.getByLabelText('Accent'), { target: { value: '#ff0000' } });
    // Live preview happens before Save.
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('#ff0000');
    expect(ipc.saveSettings).not.toHaveBeenCalled();

    await userEvent.click(screen.getByText('Save'));
    const saved = vi.mocked(ipc.saveSettings).mock.lastCall![0];
    expect((saved.customThemes[0] as { colors: { primary: string } }).colors.primary).toBe('#ff0000');
    // Editor closes after saving.
    expect(screen.queryByLabelText('Theme name')).not.toBeInTheDocument();
  });

  it('deleting the selected custom theme falls back to Default', async () => {
    vi.mocked(ipc.loadSettings).mockResolvedValue({
      selectedThemeId: 'my-theme',
      customThemes: [{ id: 'my-theme', name: 'My Theme', colors: {} }],
      showMarkdownToggle: true, notificationsEnabled: true, autoSleepMinutes: 15, usageRefreshSeconds: 60, compactList: false, ...NEW_DEFAULTS,
    });
    render(<><CustomizeTab /><ConfirmDialog /></>);
    await userEvent.click(await screen.findByLabelText('Delete My Theme'));
    // Nothing is gone until the dialog says so.
    expect(screen.getByText('My Theme')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete theme' }));

    expect(screen.queryByText('My Theme')).not.toBeInTheDocument();
    expect(ipc.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ selectedThemeId: 'default', customThemes: [] }));
  });

  it('built-in themes have no edit or delete buttons', async () => {
    render(<CustomizeTab />);
    await screen.findByText('Default');
    expect(screen.queryByLabelText('Edit Default')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Delete Default')).not.toBeInTheDocument();
  });
});
