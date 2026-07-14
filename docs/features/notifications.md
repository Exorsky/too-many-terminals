# Desktop notifications

When a Claude session needs you but the app isn't focused, the OS taps you on
the shoulder — so you can switch to your browser or editor and trust the app to
call you back instead of babysitting a long run.

## When it fires

The status listener in `App.tsx` (`onTabStatus`) already knows every Claude
tab's live state from the hooks (see
[tab-status-and-naming.md](tab-status-and-naming.md)). `maybeNotify` turns a
*transition* into a notification, under three guards:

1. The **notifications** preference is on (General settings, default on).
2. You aren't **already looking at that exact tab**. A toast is suppressed only
   when the app is focused *and* the tab that changed is the one on screen
   (`visibleTabIdRef` — the active tab, app focused, no overlay covering it),
   because the status dot right in front of you already says it. A **background
   tab still notifies even while you work in another tab** — the common case
   when juggling several sessions.
3. It's a **real transition**, not the first status we've seen for that tab —
   `prevStatusRef` holds the previous status per tab, and a tab whose first event
   arrives (session start, or workspace restore) is skipped so relaunching
   doesn't fire a burst.

Two transitions notify:

| transition | notification |
| --- | --- |
| → `requires_response` | *"<tab name> — Needs your input"* |
| `working` → `idle` | *"<tab name> — Finished"* |

Shell tabs never emit hook status, so they never notify.

## Permission

`ipc.ensureNotificationPermission()` checks and, if needed, requests the OS
permission once, caching the result. It's called up front on launch when the
pref is on, and again (guarded) before any notification, so the first toast
isn't lost to an unresolved prompt. Denied or unavailable → notifications
silently no-op. The **Send a test notification** button in the Notifications
settings section fires one on demand (reporting *blocked* if the OS refuses),
to separate a delivery/permission problem from the trigger logic.

On **Windows**, OS toasts generally require the app to be *installed* (a Start
Menu shortcut registers the AppUserModelID); a bare `tauri dev` run may not
surface banners. Test with an installed build if a dev run shows nothing.

On **macOS** the caveat is stronger: notifications are tied to a bundled
`.app`'s identifier, so a `tauri dev` run generally can't deliver them at all —
test with a built `.app`. Even a bundled app can be **silently blocked**: the
plugin reports "granted" on desktop regardless, so a system-side block (System
Settings → Notifications → Too Many Terminals set to off/None, or
Focus/Do Not Disturb) looks like a successful send that never appears. Because
that block is undetectable from our side, the test button carries a permanent
hint linking to the OS notification settings —
`openSystemNotificationSettings()` in `ipc.ts` deep-links to the pane
(`x-apple.systempreferences:` on macOS, `ms-settings:` on Windows; hidden on
Linux, where no stable deep link exists). The custom URL schemes are allowed
via an `opener:allow-open-url` scope in `capabilities/default.json`.

## The preference

`notificationsEnabled` (default `true`, opt-out) lives in `AppSettings`
alongside the session-bar prefs, persisted in `settings.json` via the same
[settings store](settings.md). The General tab exposes it under a
**Notifications** heading.

## Platform / follow-ups

- Delivery uses `@tauri-apps/plugin-notification` (registered in `lib.rs`,
  `notification:default` capability), which works on Windows (WebView2), macOS,
  and Linux.
- **Taskbar / dock badge** with a live "waiting" count is *not* included yet:
  Tauri's `setBadgeCount` is unsupported on Windows (it needs a generated
  overlay icon), so a cross-platform badge is a separate follow-up.
- **Per-project mute** (silencing a chatty repo) is a possible refinement on top
  of the single global toggle.

## Files

- `src/lib/ipc.ts` — `ensureNotificationPermission`, `notify` (the only module
  importing the notification plugin), `openSystemNotificationSettings` /
  `canOpenSystemNotificationSettings`.
- `src/App.tsx` — `maybeNotify`, `prevStatusRef`/`tabsRef`/`notificationsRef`,
  the permission-request effect, and the notify call in the status listener.
- `src/components/SettingsView.tsx` — the Notifications switch, the test
  button, and the OS-settings hint under it.
- `src-tauri/src/settings.rs` — `notifications_enabled` field + default (+ tests).
- `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`,
  `src-tauri/capabilities/default.json` — plugin registration, dep, capability.
- `src/types.ts`, `src/lib/settings-store.ts` — the `notificationsEnabled` field
  and its default.
