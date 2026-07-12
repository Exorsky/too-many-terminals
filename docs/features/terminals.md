# Terminals

## Project folders

Any number of folders can be open at once (`App.tsx` `projects: string[]`), each rendered
as its own card in the sidebar — hue assigned sequentially in the order folders were added
(`projectHue(index)`, same scheme as the original multi-project app), tab list as its
collapsible body. Click a card's header to expand/collapse just that folder's tabs; click
the X inside it to remove the folder (kills its open tabs, no confirmation — closing tabs
isn't destructive, transcripts stay on disk). "Add folder…" (dashed button below the cards,
or the folder-plus icon in the collapsed rail) opens the native picker
(`@tauri-apps/plugin-dialog`, `ipc.pickFolder`) and appends a new project; picking an
already-open folder is a no-op. Each project's "New session" menu is scoped to that
project — every tab spawns with its owning folder as `cwd`.

## Sidebar collapse

The sidebar can be hidden to an 11px icon rail (`PanelLeftClose`/`PanelLeftOpen` toggle,
`App.tsx` `collapsed` state) — tabs render as icon-only buttons (flat across all projects),
History and "Add folder" stay reachable. Matches the original Electron app's collapse
behavior, including the width transition (`transition-[width]` on a single shared root
element — swapping between two early-return roots would remount instead of animating).

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
- `src/components/Sidebar.test.tsx` — tab rows, per-project shell menu, card expand/collapse,
  add/remove folder, multiple simultaneous project cards, empty state, sidebar collapse
- `cargo test shell::` / `claude::` — per-platform shell lists and claude command shape

Manual PTY verification checklist: docs/development.md.

See also: [workspace persistence](workspace-persistence.md) for how open tabs survive
an app restart.
