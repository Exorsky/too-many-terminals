import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ipc from '@/lib/ipc';
import { resetSettingsForTest } from '@/lib/settings-store';
import CustomizeTab from './CustomizeTab';

vi.mock('@/lib/ipc');

beforeEach(() => {
  resetSettingsForTest();
  vi.mocked(ipc.loadSettings).mockResolvedValue({
    selectedThemeId: 'default', customThemes: [], showSessionBar: true, showMarkdownToggle: true, notificationsEnabled: true,
  });
  vi.mocked(ipc.saveSettings).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CustomizeTab', () => {
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
      showSessionBar: true, showMarkdownToggle: true, notificationsEnabled: true,
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
      showSessionBar: true, showMarkdownToggle: true, notificationsEnabled: true,
    });
    render(<CustomizeTab />);
    await userEvent.click(await screen.findByLabelText('Delete My Theme'));

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
