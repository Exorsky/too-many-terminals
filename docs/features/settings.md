# Settings

The Settings button (sidebar footer, or the icon rail when collapsed) swaps the main
pane to `SettingsView`, mirroring how the History button swaps in
`SessionHistoryPanel` — terminals stay mounted but hidden underneath. Opening one
of History/Settings closes the other; selecting or spawning a tab closes both.

`SettingsView` owns its own sub-tab state (`general` | `customize`) with a small
in-component tab strip — no router. General hosts app preferences (currently the
session-bar switches); Customize hosts the theme system (see [themes.md](themes.md)).

## General preferences

Two switches gate the [session bar](session-reader.md):

- **Show the session bar** (`showSessionBar`) — the strip above the terminal.
- **Show the Markdown toggle** (`showMarkdownToggle`) — the Terminal/Markdown
  switch in the bar; disabled while the bar itself is hidden.

Both default to `true` (opt-out) and persist in `settings.json`.

A **Notifications** section adds one more switch — **Notify when a session
needs you** (`notificationsEnabled`, default `true`) — gating the desktop
notifications described in [notifications.md](notifications.md).

A **Sessions** section adds a dropdown — **Auto-sleep idle sessions**
(`autoSleepMinutes`, default `15`) — choosing how long an idle, off-screen
Claude session may run before its process is freed. **Off** (0) disables it.
See the auto-sleep section of
[workspace-persistence.md](workspace-persistence.md).

## Settings store

All settings reads/writes go through `src/lib/settings-store.ts` — a small
in-memory mirror of `AppSettings` with `loadSettings` (once), `patchSettings`
(merge-then-save, so a theme write can't drop a UI pref or vice versa), and a
`useSettings` hook. `main.tsx` loads it before first paint (for the theme);
`CustomizeTab` and General both write through `patchSettings`.

## Files

- `src/components/SettingsView.tsx` — the view + General/Customize sub-tabs + General switches
- `src/components/CustomizeTab.tsx` — theme picker/editor (Customize sub-tab)
- `src/lib/settings-store.ts` (+ tests) — shared settings state
- Wiring: `App.tsx` (`showSettings` state, mutual exclusion with `showHistory`;
  reads `showSessionBar`/`showMarkdownToggle`/`autoSleepMinutes` via `useSettings`),
  `Sidebar.tsx` (`showSettings`/`onToggleSettings` props, footer + collapsed-rail buttons)
- `src-tauri/src/settings.rs` — persisted `AppSettings` (incl. `auto_sleep_minutes`)
