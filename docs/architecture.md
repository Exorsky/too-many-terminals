# Architecture

## Why Tauri

The previous incarnation (Electron fork, see `windows-claude`) shipped Chromium + Node in
every build (~100+ MB per platform). Tauri 2 uses the OS webview (WebView2 / WKWebView /
WebKitGTK) and a small Rust binary, keeping installers in the ~10–25 MB range.

## The product model

Three concepts, and only two of them are places you navigate to:

| Concept | What it is | Where it lives |
|---|---|---|
| **Session** | What you're working on right now — a Claude Code process, its shell, its files | `Tab` in `types.ts`; one is selected at a time |
| **Project** | Optional organizing context for sessions and To-Dos | `projects: string[]` + `Tab.projectDir` |
| **To-Do** | Something you intend to do — not a queue for Claude | `Task` in `types.ts`, `lib/tasks.ts` |

The top-level navigation is **Sessions | To-Do**. A project is deliberately not a third
mode: it organizes what's inside a mode. A session filed under no project is in the
**Inbox**, which is the absence of a project (`projectDir === null`) and not a reserved
folder — that's what makes ⌘N able to start a session without asking anything first.

`Tab.cwd` (where the process runs) and `Tab.projectDir` (what it's filed under) are
separate fields. Filing a session under a project changes only the second, because Claude
Code keys a transcript by working directory and moving a live one would orphan the
conversation. See [features/scratch-sessions.md](features/scratch-sessions.md).

## Process model

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│ Webview (React, src/)       │        │ Rust core (src-tauri/src/)   │
│                             │        │                              │
│ App.tsx — shell + state     │ invoke │ commands.rs — thin adapters  │
│ lib/sessions.ts — vocabulary│        │                              │
│ lib/ipc.ts — ONLY IPC seam ─┼───────►│ pty.rs — portable-pty        │
│ SessionsSidebar.tsx         │◄───────┤ shell.rs — per-OS shells     │
│ SessionWorkspace.tsx        │channel │ claude.rs — claude CLI cmd   │
│ Terminal.tsx — xterm.js     │ events │ session_history.rs           │
│ TodoView.tsx  lib/tasks.ts  │        │ session_usage.rs  tasks.rs   │
│ terminalCache.ts            │        │ workspace.rs                 │
└─────────────────────────────┘        └──────────────────────────────┘
```

## IPC design

- **Commands** (`invoke`): `pty_spawn`, `pty_write`, `pty_resize`, `pty_kill`,
  `list_shells`, `home_dir`, `list_sessions`, `delete_session`, `get_session_usage_stats`,
  `create_scratch_dir`, `load_tasks`, `save_tasks`.
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
- `src/lib/sessions.ts` is the session vocabulary — status, grouping, ordering, the
  workspace-file migration — with no React in it. Three surfaces (sidebar, palette,
  session header) read the same answers from it, which is what stops a session reading
  one way in the list and another in the header.
- `src/lib/tabs.ts` owns `{ tabs, selectedId }`. One selected session, not a grid: the
  2x2 pane grid and its per-pane tab strips were removed in v0.25 — see
  [features/panes.md](features/panes.md) for what that was and why it went.
- `src/lib/tasks.ts` owns the To-Do model and its store. `tasks.json` is opaque to Rust
  (`Vec<serde_json::Value>`, same pattern as `customThemes`), so a task growing a field
  is a one-file change.
- Rust core modules (`pty.rs`, `shell.rs`, `claude.rs`, `session_history.rs`, `session_usage.rs`)
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
  loss (common on WebKitGTK). The context is held only by the **visible** terminal —
  `Terminal.tsx` disposes the WebGL addon when a tab is hidden and re-activates it on
  re-show, so many open sessions don't exhaust the webview's WebGL2 context limit. One
  session is on screen at a time, so at most one Claude terminal and one shell terminal
  hold a context.

## Known follow-ups

- Output is coalesced (see PTY output above) but there's no ack-based **flow control** yet
  (Electron version had pause/resume watermarks). Add backpressure if a sustained flood
  still outpaces the webview.
