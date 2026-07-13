import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ipc from '@/lib/ipc';
import { getSettings, loadSettings, patchSettings, resetSettingsForTest } from './settings-store';

vi.mock('@/lib/ipc');

beforeEach(() => {
  resetSettingsForTest();
  vi.mocked(ipc.saveSettings).mockResolvedValue(undefined);
});

afterEach(() => vi.clearAllMocks());

describe('settings-store', () => {
  it('fills fields absent from an older settings file with defaults', async () => {
    vi.mocked(ipc.loadSettings).mockResolvedValue({ selectedThemeId: 'amber' } as never);
    const loaded = await loadSettings();
    expect(loaded.selectedThemeId).toBe('amber');
    expect(loaded.showSessionBar).toBe(true);
    expect(loaded.showMarkdownToggle).toBe(true);
  });

  it('loads exactly once even if called concurrently', async () => {
    vi.mocked(ipc.loadSettings).mockResolvedValue({
      selectedThemeId: 'default', customThemes: [], showSessionBar: true, showMarkdownToggle: true, notificationsEnabled: true,
    });
    await Promise.all([loadSettings(), loadSettings(), loadSettings()]);
    expect(ipc.loadSettings).toHaveBeenCalledOnce();
  });

  it('merges a patch over current settings without dropping other fields', () => {
    patchSettings({ selectedThemeId: 'violet' });
    patchSettings({ showSessionBar: false });
    // The theme write and the pref write both survive.
    expect(getSettings().selectedThemeId).toBe('violet');
    expect(getSettings().showSessionBar).toBe(false);
    expect(getSettings().showMarkdownToggle).toBe(true);
    // Persisted the full merged object each time.
    expect(ipc.saveSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ selectedThemeId: 'violet', showSessionBar: false }),
    );
  });
});
