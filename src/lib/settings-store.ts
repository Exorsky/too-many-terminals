/**
 * A tiny in-memory mirror of the persisted `AppSettings`, so the several places
 * that read or write settings (theme editor, General preferences, the app shell)
 * stay in sync and never clobber each other's fields. All writes go through
 * `patchSettings`, which merges over the current value before saving — so
 * changing a UI pref can't wipe custom themes, and vice versa.
 *
 * Settings load exactly once (`loadSettings`); components subscribe via the
 * `useSettings` hook and re-render when any field changes.
 */
import { useSyncExternalStore } from 'react';
import * as ipc from '@/lib/ipc';
import type { AppSettings } from '@/types';

export const DEFAULT_SETTINGS: AppSettings = {
  selectedThemeId: 'default',
  customThemes: [],
  showMarkdownToggle: true,
  notificationsEnabled: true,
  autoSleepMinutes: 15,
  usageRefreshSeconds: 300,
};

let current: AppSettings = { ...DEFAULT_SETTINGS };
let loadPromise: Promise<AppSettings> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function getSettings(): AppSettings {
  return current;
}

/** Loads persisted settings once, merging over defaults so fields absent from
 *  an older file take their default. Repeat calls return the same promise. */
export function loadSettings(): Promise<AppSettings> {
  if (!loadPromise) {
    loadPromise = ipc
      .loadSettings()
      .then((loaded) => {
        current = { ...DEFAULT_SETTINGS, ...loaded };
        emit();
        return current;
      })
      .catch(() => current);
  }
  return loadPromise;
}

/** Merges a partial update into the current settings, notifies subscribers, and
 *  persists the whole object. Fire-and-forget on the write. */
export function patchSettings(patch: Partial<AppSettings>): void {
  current = { ...current, ...patch };
  emit();
  void ipc.saveSettings(current).catch(() => {});
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React binding — re-renders on any settings change. */
export function useSettings(): AppSettings {
  return useSyncExternalStore(subscribe, getSettings, getSettings);
}

/** Test-only: reset the in-memory store between cases. */
export function resetSettingsForTest(): void {
  current = { ...DEFAULT_SETTINGS };
  loadPromise = null;
  listeners.clear();
}
