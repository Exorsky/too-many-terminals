# Architecture

## Why Tauri

The previous incarnation (Electron fork, see `windows-claude`) shipped Chromium + Node in
every build (~100+ MB per platform). Tauri 2 uses the OS webview (WebView2 / WKWebView /
WebKitGTK) and a small Rust binary, keeping installers in the ~10–25 MB range.

## Process model

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│ Webview (React, src/)       │        │ Rust core (src-tauri/src/)   │
│                             │        │                              │
│ App.tsx — tabs state        │ invoke │ commands.rs — thin adapters  │
│ lib/ipc.ts — ONLY IPC seam ─┼───────►│ pty.rs — portable-pty        │
│ Terminal.tsx — xterm.js     │◄───────┤ shell.rs — per-OS shells     │
│ terminalCache.ts            │channel │ claude.rs — claude CLI cmd   │
│ SessionHistoryPanel.tsx     │ events │ session_history.rs           │
│ UsageMeter.tsx              │        │ usage.rs                     │
└─────────────────────────────┘        └──────────────────────────────┘
```

## IPC design

- **Commands** (`invoke`): `pty_spawn`, `pty_write`, `pty_resize`, `pty_kill`,
  `list_shells`, `home_dir`, `list_sessions`, `delete_session`, `get_usage_stats`.
  Slow filesystem scans are `#[tauri::command(async)]` so they don't block the IPC thread.
- **PTY output**: one Tauri **Channel per tab**, passed to `pty_spawn`. A blocking reader
  thread pushes raw chunks into an in-process channel; a second thread (`pty.rs::coalesce`)
  batches bursts — appending further chunks that arrive within a short window (`BATCH_WINDOW`,
  4 ms) up to a size cap (`BATCH_MAX_BYTES`, 64 KiB) — before sending one
  `InvokeResponseBody::Raw(Vec<u8>)` across the IPC boundary. This collapses a flood of tiny
  reads (`yes`, build output) into far fewer messages without perceptible latency; bytes and
  order are preserved exactly. JS receives an `ArrayBuffer` and feeds `Uint8Array` straight
  into xterm (no base64, no UTF-8 chunk-splitting issues). If raw channels misbehave on some
  webview, the fallback (base64) only touches `src/lib/ipc.ts`.
- **PTY exit**: a low-frequency `pty-exit` Tauri event with `{ tabId }`.

## Module boundaries

- `src/lib/ipc.ts` is the **only** frontend module importing `@tauri-apps/api`.
  Components depend on its interface; vitest automocks it.
- Rust core modules (`pty.rs`, `shell.rs`, `claude.rs`, `session_history.rs`, `usage.rs`)
  take plain arguments (`&Path` roots, `Platform` enum) instead of touching Tauri state or
  `cfg!` directly, so `cargo test` covers all three platforms' logic on any host.
- `commands.rs` adapts those modules to Tauri (State, Channel, AppHandle) and contains no
  logic of its own.

## Platform notes

- **Windows kill semantics**: ConPTY `child.kill()` doesn't kill grandchildren; `pty.rs`
  uses `taskkill /PID <pid> /T /F`. All ptys are killed on app exit (`RunEvent::Exit`).
- **macOS/Linux PATH**: GUI-launched apps get a minimal PATH; `claude.rs` resolves the
  login shell's PATH once (`$SHELL -lc 'echo $PATH'`) and injects it into every pty.
- **Windows claude shim**: `claude` is an npm `.cmd` shim, spawned via `cmd.exe /c claude`.
- **WebGL**: xterm tries the WebGL renderer and falls back to the DOM renderer on context
  loss (common on WebKitGTK).

## Known follow-ups

- Output is coalesced (see PTY output above) but there's no ack-based **flow control** yet
  (Electron version had pause/resume watermarks). Add backpressure if a sustained flood
  still outpaces the webview.
