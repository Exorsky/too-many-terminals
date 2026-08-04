# .env loading

A session spawned in a folder that has a `.env` starts already holding that
project's credentials, so you don't have to tell Claude which secrets to use —
or paste them into the conversation, where they'd end up in the transcript.

The terminal prints a dim receipt before the process's own output, naming what
was applied:

```
.env → 7 applied · PATH refused (reserved)
  STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET DATABASE_URL REDIS_URL SENTRY_DSN RESEND_API_KEY LOG_LEVEL
```

Key names only. Values never leave the Rust process — they go straight onto the
child's environment, and the frontend only ever learns which names exist.

## Two signals, two questions

The receipt above answers *what just happened*, but it scrolls away. So the
sidebar answers the other question — *which of my folders carry credentials at
all* — with a small key glyph on the **folder** header row, next to the session
count:

```
● payments-api        🔑  3  ›
● storefront              1  ›
```

Hovering it names the source and the variables:

```
7 variables from .env
STRIPE_SECRET_KEY DATABASE_URL REDIS_URL …
Refused (reserved): PATH
C:\Users\you\code\payments-api
```

It sits on the folder rather than on each session because **a `.env` belongs to
a directory**: every session in `payments-api` gets the same variables, so
marking each session row would print one fact N times — and the session row
(name, folder chip, two hover buttons) has no room left anyway.

No glyph means no `.env` in that folder. Absence is the empty state, the same
rule the Pinned strip follows by rendering nothing rather than a placeholder.
A glyph at half opacity means the file is there but unreadable.

The glyph is deliberately drawn in `muted-foreground`, not in a status color:
`docs/design.md` reserves `success`/`warning`/`attention`/`destructive` for
session state, and a loaded `.env` is metadata, not a status.

## Why this exists when Claude Code has `env`

Claude Code's own `settings.json` already supports an `env` block, applied to
every session and its subprocesses, with the hierarchy you'd expect
(`~/.claude/settings.json` → `<project>/.claude/settings.json` →
`<project>/.claude/settings.local.json`). **That is still the right place for
credentials you're willing to write out by hand**, and this app doesn't
interfere with it — `hooks::merge_settings` preserves unrelated top-level keys.

What Claude Code doesn't do is read `.env` files, and that's where most
projects' credentials already are. This feature covers exactly that gap and
nothing more.

## Ordering is the safety model

In `commands.rs::pty_spawn`, `.env` pairs are applied to the `CommandBuilder`
**before** the app's own `cmd.env(…)` calls. So `PATH`, `TERM` and
`TOO_MANY_TERMINALS_TAB_ID` / `TOO_MANY_TERMINALS_PIPE` always overwrite
anything the file tried to set: a stray `PATH=` can't leave the tab unable to
find `claude`, and no `.env` can redirect the status hooks' pipe.

`dotenv::load` filters those names out on top of that, so the refusal is
*visible* in the receipt rather than silently overwritten. Belt and braces —
both cost one line.

Claude Code's `settings.json` `env` block still wins over all of this, because
the CLI applies it inside its own process after inheriting ours. That
precedence is the right way round: the file you wrote for Claude beats the file
you wrote for your app.

## Parsing rules (`dotenv.rs`)

Deliberately minimal — a 20-line parser instead of a dependency:

| Input | Result |
|---|---|
| `# comment`, blank lines | skipped |
| `export API_KEY=abc` | `export ` prefix tolerated |
| `KEY="abc"`, `KEY='abc'` | matching surrounding quotes stripped |
| `URL=postgres://u:p@h/db?x=1` | everything after the *first* `=` is the value |
| `SECRET=a#b#c` | kept whole — **a trailing `#` is not a comment** |
| `9LEADING=x`, `BAD KEY=x`, `not an assignment` | skipped, never fatal |
| duplicate keys | last one wins |

Two of those are worth the ink:

- **`#` is not a comment character mid-line.** Every dotenv library disagrees,
  but silently truncating a secret at a `#` is a far worse failure than keeping
  a stray comment in a value, and secrets contain punctuation.
- **A malformed line is skipped, not fatal.** A tab that refuses to open
  because of a typo in a `.env` is worse than one missing variable.

## Scope

- Only `<cwd>/.env` — the directory the tab actually opened in. No walking up
  to parent folders: a credential arriving from two levels above the folder you
  opened is a surprise, and surprises with secrets are bugs.
- No `.env.local` / `.env.production` / profile selection.
- Applies to every tab kind, not just Claude — a shell tab in the same folder
  gets the same variables, which is what you'd expect from a terminal.

## Files

- `src-tauri/src/dotenv.rs` — parsing, reserved-name filtering, the receipt
  string. Plain Rust, no Tauri types, unit-tested.
- `src-tauri/src/commands.rs` — `pty_spawn` applies the pairs and sends the
  receipt down the existing `on_data` channel before the process starts;
  `env_names(dir)` serves the sidebar the names alone.
- `src/components/Sidebar.tsx` — `ProjectCard` reads `envNames` for its folder
  and renders the glyph; `envTooltip` builds the hover text, shown via the
  shared `Tooltip` component (`src/components/ui/tooltip.tsx`) rather than a
  native `title`, so multi-line text gets real styling instead of the OS's
  plain hover box.

The receipt itself needs no frontend code — it arrives as ordinary terminal
output, and `terminalCache.writeToTerminal` buffers it until the xterm instance
mounts, so it always lands above the process's first line.

## Deliberately left out

- **No setting to turn it off.** Worth revisiting if opening untrusted
  repositories becomes a real workflow.
- **No live watching of `.env`.** The sidebar re-reads when the folder's tab
  count changes; editing a `.env` while the app is open won't move the glyph
  until then, and won't affect already-running sessions either way — a process
  gets its environment once, at spawn.
