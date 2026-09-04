# Settings

The Settings item (sidebar footer menu, or the icon rail when collapsed) swaps the main
pane to `SettingsView`, mirroring how the History button swaps in
`SessionHistoryPanel` — terminals stay mounted but hidden underneath. Opening one
of History/Settings closes the other; selecting or spawning a tab closes both.

`SettingsView` owns its own category state (`interface` | `notifications` |
`sessions` | `customize`) with a left rail — no router, no top tab strip. Each
category is one focused screen instead of one long scrolling list; the rail
uses the same active-row look (left accent bar) as the sidebar's own tab rows.
Interface/Notifications/Sessions hold plain preferences; Customize hosts the
theme system (see [themes.md](themes.md)).

## Interface

Two switches, both default `true` (opt-out) and persisted in `settings.json`:

- **Show Markdown Preview** (`showMarkdownToggle`) — gates
  [`SessionControls`](session-reader.md#session-controls), the Preview/Split
  controls docked to the tab strip.
## Notifications

One switch — **Notify when a session needs you** (`notificationsEnabled`,
default `true`) — gating the desktop notifications described in
[notifications.md](notifications.md), plus a "Send a test notification"
button.

## Sessions

Two dropdowns, both about background behavior while a session is idle:

- **Auto-sleep idle sessions** (`autoSleepMinutes`, default `15`) — how long
  an idle, off-screen Claude session may run before its process is freed.
  **Off** (0) disables it. See the auto-sleep section of
  [workspace-persistence.md](workspace-persistence.md).
- **Usage refresh interval** (`usageRefreshSeconds`, default `300` (5
  minutes), options 5m/15m/30m) — how often the sidebar's usage meter
  re-fetches your rate-limit percentages. Nothing faster is offered because
  Anthropic's usage endpoint rate-limits and the backend enforces its own
  5-minute floor. See [usage-meter.md](usage-meter.md).

## Settings store

All settings reads/writes go through `src/lib/settings-store.ts` — a small
in-memory mirror of `AppSettings` with `loadSettings` (once), `patchSettings`
(merge-then-save, so a theme write can't drop a UI pref or vice versa), and a
`useSettings` hook. `main.tsx` loads it before first paint (for the theme);
`CustomizeTab` and the other categories all write through `patchSettings`.

## Files

- `src/components/SettingsView.tsx` — the view + left-rail categories +
  Interface/Notifications/Sessions preferences
- `src/components/CustomizeTab.tsx` — theme picker/editor (Customize category)
- `src/lib/settings-store.ts` (+ tests) — shared settings state
- Wiring: `App.tsx` (`showSettings` state, mutual exclusion with `showHistory`;
  reads `showMarkdownToggle`/`autoSleepMinutes` via `useSettings`),
  `Sidebar.tsx` (`showSettings`/`onToggleSettings` props, collapsed-rail button) and
  `SidebarFooter.tsx` (the expanded footer's menu item)

  A **Show folder paths** toggle used to live here, gating a breadcrumb on the
  folder-group header. That header is gone with the folder tree, and folder pills
  disambiguate two same-named folders on their own (`pillLabel`), so the setting
  was removed rather than left as a switch that changed nothing.
- `src-tauri/src/settings.rs` — persisted `AppSettings` (incl. `auto_sleep_minutes`,
  `usage_refresh_seconds`)
