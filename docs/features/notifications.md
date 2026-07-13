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
2. The app window is **not focused** (`document.hasFocus()` is false) — if you're
   looking at the app, the status dot and the [inbox](attention-inbox.md) already
   tell you, so a toast would be noise.
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
silently no-op.

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
  importing the notification plugin).
- `src/App.tsx` — `maybeNotify`, `prevStatusRef`/`tabsRef`/`notificationsRef`,
  the permission-request effect, and the notify call in the status listener.
- `src/components/SettingsView.tsx` — the Notifications switch (+ test).
- `src-tauri/src/settings.rs` — `notifications_enabled` field + default (+ tests).
- `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`,
  `src-tauri/capabilities/default.json` — plugin registration, dep, capability.
- `src/types.ts`, `src/lib/settings-store.ts` — the `notificationsEnabled` field
  and its default.
