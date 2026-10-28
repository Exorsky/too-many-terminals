import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ipc from '@/lib/ipc';
import { getSettings, loadSettings, patchSettings, resetSettingsForTest, DEFAULT_SETTINGS } from './settings-store';

/** Fields added after these fixtures were written. */
const { newTabPosition, jiraBaseUrl, jiraProjectKeys, jiraTokenVar } = DEFAULT_SETTINGS;
const NEW_DEFAULTS = { newTabPosition, jiraBaseUrl, jiraProjectKeys, jiraTokenVar };

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
    expect(loaded.showMarkdownToggle).toBe(true);
  });

  it('loads exactly once even if called concurrently', async () => {
    vi.mocked(ipc.loadSettings).mockResolvedValue({
      selectedThemeId: 'default', customThemes: [], showMarkdownToggle: true, notificationsEnabled: true, autoSleepMinutes: 15, usageRefreshSeconds: 60, compactList: false, ...NEW_DEFAULTS,
    });
    await Promise.all([loadSettings(), loadSettings(), loadSettings()]);
    expect(ipc.loadSettings).toHaveBeenCalledOnce();
  });

  it('merges a patch over current settings without dropping other fields', () => {
    patchSettings({ selectedThemeId: 'violet' });
    patchSettings({ showMarkdownToggle: false });
    // The theme write and the pref write both survive.
    expect(getSettings().selectedThemeId).toBe('violet');
    expect(getSettings().showMarkdownToggle).toBe(false);
    // Persisted the full merged object each time.
    expect(ipc.saveSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ selectedThemeId: 'violet', showMarkdownToggle: false }),
    );
  });
});
