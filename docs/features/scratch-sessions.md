# Scratch sessions and the Inbox

> **⌘N, and you're typing.** No modal, no folder picker, no decision about where
> this belongs.

## The problem

Starting a Claude session used to require picking a project folder first. That is
fine for "work on the API service" and completely wrong for "I just want to ask
Claude something", which is the more common case by a wide margin. Every question
you can't be bothered to file ends up somewhere else — a browser tab, a terminal
you'll forget about — because the app asked you to categorize it before you'd even
typed it.

## The Inbox

A session's `projectDir` is either a project folder or `null`. `null` is the Inbox.

That is the whole mechanism. The Inbox is **not** a reserved folder and not a fake
project: it is the absence of one. Nothing has to exist before a session can be in
it, which is what lets ⌘N skip every question.

## What ⌘N does

```
⌘N
 ↓  create_scratch_dir(<8 hex chars>)      →  ~/.tmt/scratch/<id>
 ↓  pty_spawn { kind: "claude", cwd }      →  a normal Claude Code session
 ↓  projectDir: null                       →  appears in the Inbox
 ↓  selected                                →  the terminal has focus
```

A scratch session is an ordinary session in every other respect: the same
`pty_spawn`, the same hooks for live status and auto-naming, the same workspace
persistence, the same `--resume` on the next launch. Nothing about it is special
except where its working directory came from.

### Why `~/.tmt/scratch/<id>` and not somewhere else

Claude Code keys a transcript by its working directory — a session in `/a/b` writes
to `~/.claude/projects/-a-b/<session>.jsonl`. So the scratch path is not an
implementation detail: it is baked into where the conversation lives, and it has to
be stable, short and legible.

- **Not the platform config dir.** `~/Library/Application Support/too-many-terminals/…`
  works but produces an unreadable slug, and this path is shown in the session header.
- **Not `/tmp`.** It gets cleaned out from under a live session, and every restart
  would orphan yesterday's conversations.
- **`~/.tmt/scratch/<id>`.** One directory per session, created on demand, never
  removed by the app. `workspace::create_scratch_dir` is idempotent, so reopening a
  session that already has one is not an error.

## Filing a session later

**Move to project…** appears in the session row's ⋯ menu, the session header's ⋯
menu, and the inspector. It sets `projectDir` and **nothing else**:

| Field | On "Move to project" |
|---|---|
| `projectDir` | changes |
| `cwd` | unchanged |
| the pty | not restarted |
| the Claude session id | unchanged |
| the transcript | stays where it is |

The alternative — physically moving the working directory — would mean killing the
process, moving files that Claude may have open, and orphaning the transcript under
its old path slug. The organizational association is the thing you actually wanted
to change, so that is the only thing that changes. The inspector always shows the
real working directory, so this is never a lie by omission.

Removing a project does the same thing in reverse: its sessions are refiled to the
Inbox, still running. Closing a folder is a statement about the sidebar, not about
the work.

## Migration

A workspace file written before this feature has no `projectDir` on its saved tabs.
`restoreTab` in `src/lib/sessions.ts` derives one: a `cwd` that is one of the open
projects **is** that project, anything else goes to the Inbox. That is exactly what
those tabs meant under the old model, so nothing appears to move on first launch
after upgrading.

An explicit `null` is honoured as the Inbox and never re-derived — otherwise a
scratch session whose directory happened to be added as a project would silently
refile itself.
