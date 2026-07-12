# Terminals

## Project folder

A working directory must be chosen before any session can start — the sidebar shows
"Select folder…" (or the current folder's name, with a folder icon) and opens the native
OS folder picker (`@tauri-apps/plugin-dialog`, `ipc.pickFolder`). "New session" stays
disabled until a folder is set; every tab spawns with that folder as its `cwd`.

## Sidebar collapse

The sidebar can be hidden to an 11px icon rail (`PanelLeftClose`/`PanelLeftOpen` toggle,
`App.tsx` `collapsed` state) — tabs render as icon-only buttons, History and the folder
picker stay reachable. Matches the original Electron app's collapse behavior.

The sidebar's "New session" menu opens terminal tabs of two kinds:

- **Claude** — runs the `claude` CLI (Claude Code) in a pty.
- **OS shells** — provided by `src-tauri/src/shell.rs` per platform:
  - Windows: PowerShell, Command Prompt
  - macOS: Zsh, Bash
  - Linux: Bash, Zsh, Fish

  The list is static per platform (a shell may not be installed; spawning then fails and
  the tab is marked exited).

## Flow

1. `App.tsx` `spawnTab()` creates a `Tab` (id = `crypto.randomUUID()`), dispatches `add`,
   and calls `ipc.spawnPty()` with a per-tab channel whose callback routes bytes into
   `terminalCache.writeToTerminal`.
2. `commands.rs::pty_spawn` builds the command (`claude.rs` for Claude tabs incl.
   `--resume <sessionId>`, `shell.rs` lookup for shells), spawns via `pty.rs`
   (portable-pty), and starts a reader thread streaming raw bytes over the channel.
3. `Terminal.tsx` lazily creates one xterm instance per tab, cached in
   `terminalCache.ts` across React unmounts so hidden tabs keep buffering output.
   Fit-on-resize (ResizeObserver → `pty_resize`), right-click copy/paste, Ctrl+V paste,
   links open externally via the opener plugin.
4. Closing a tab calls `pty_kill` (Windows: `taskkill /T`), disposes the xterm instance,
   and removes the tab. Backend `pty-exit` events mark tabs whose process died on its own.

## Files

- `src/App.tsx`, `src/components/Sidebar.tsx`, `src/components/Terminal.tsx`,
  `src/components/terminalCache.ts`, `src/lib/tabs.ts`
- `src-tauri/src/pty.rs`, `shell.rs`, `claude.rs`, `commands.rs`

## Tests

- `src/lib/tabs.test.ts` — tab state transitions
- `src/components/Sidebar.test.tsx` — tab rows, shell menu, folder picker, disabled state, collapse
- `cargo test shell::` / `claude::` — per-platform shell lists and claude command shape

Manual PTY verification checklist: docs/development.md.
