# VS Code handoff

Right-click a live Claude tab → **Open in VS Code** hands the session to the
native Claude Code VS Code extension, mid-conversation, without losing
anything.

## Why this is small

TMT and the VS Code extension both read/write the exact same transcript file:
`~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`, resolved the same way —
`CLAUDE_CONFIG_DIR ?? ~/.claude` + `projects` (confirmed by reading the
extension's bundled `extension.js`, not just its docs). There's nothing to
migrate; the session already exists wherever both tools look.

The extension also answers a deep link — again read out of its bundle:

```js
case "/open": { let T = E.get("session"), O = E.get("prompt");
  commands.executeCommand("claude-vscode.primaryEditor.open", T, O); return }
```

So the whole feature is "make sure VS Code has the right folder open, then
tell its Claude Code extension which session to resume":

```
vscode://anthropic.claude-code/open?session=<session-id>
```

The extension's own constraint is that the session must belong to the
workspace currently open in VS Code — hence step one below.

## What happens on click

1. The TMT tab is put to sleep (`sleepTab` — same mechanism idle background
   tabs use, see [terminals.md](terminals.md)): its pty is killed but
   `resumeSessionId` is kept. This matters because only one `claude` process
   should ever be appending to a transcript at a time.
2. `code <cwd>` is spawned to open/focus VS Code on the session's folder.
3. After a fixed 1.5s delay — VS Code needs a moment to focus the window and
   activate the extension — the `vscode://…open?session=…` URI is fired via
   the OS's default URL handler.

Clicking the TMT tab again later wakes it with `claude --resume <id>`, same as
any other dormant tab, picking up whatever happened in VS Code in the
meantime. The round trip is free — it's the existing resume path, not new
code.

## The reverse direction needs nothing

A session started in the VS Code extension already appears in TMT's
[session history](session-history.md) for that folder, because the storage is
shared. There is no VS Code-side mechanism to call out to an external app, so
a `toomanyterminals://` deep link would have no caller — not built.

## Requirements and limits

- The `code` CLI must be on `PATH` (VS Code → Command Palette → "Shell
  Command: Install 'code' command in PATH", or check the box during install
  on Windows). If it's missing, the command fails with a readable error
  rather than hanging.
- Cursor / VSCodium / Insiders aren't covered — different binary name, and
  their forks may register a different URI scheme.
- If several VS Code windows are open, the URI goes to whichever one is
  focused when it fires; `code <dir>` is what's supposed to make that the
  right window, but a very busy machine could in theory lose that race.
- The context menu item only appears once a Claude tab's session id has been
  learned (see `sessionResolved` in `src/lib/tabs.ts`) — a brand-new tab has
  nothing to hand off yet.
- **Don't resume the same session in both places at once.** If you wake the
  TMT tab again while VS Code still has it open, two `claude` processes end up
  writing the same transcript file concurrently. On Windows this can wedge one
  of them on a file lock. `pty_write`/`pty_resize` run off the main thread
  (`#[tauri::command(async)]`) specifically so a wedged pty can't freeze the
  whole window — but that one tab's terminal will still sit dead until you
  close VS Code's copy (or the tab) and reopen. This is inherent to
  `claude --resume` having no cross-process coordination, not specific to this
  feature — the same conflict happens running `--resume` twice from two plain
  terminals.

## Files

- `src-tauri/src/editor.rs` — `code_command` (Windows `.cmd` shim wrapping,
  same reason as `claude::claude_command`) and `session_uri`. Plain Rust, unit
  tested.
- `src-tauri/src/commands.rs` — `open_in_vscode(cwd, session_id)`: spawns
  `code`, then the delayed `vscode://` open via
  `tauri_plugin_opener::OpenerExt`.
- `src/lib/ipc.ts` — `openInVscode`.
- `src/components/Sidebar.tsx` — the `TabRow` context menu item, gated on
  `tab.kind === 'claude' && tab.resumeSessionId`.
- `src/App.tsx` — `handleOpenInVscode` sleeps the tab, then calls the IPC.
