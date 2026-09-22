# To-Do

> **A To-Do is what you need to do. A session is what you're doing.**
> They are related, and the relationship runs in both directions — but neither
> one implies the other.

To-Do is the second of the app's two top-level modes. It is a plain developer
to-do list that happens to know about Claude, **not** a queue of work for Claude.
That ordering decides most of the design below.

## Layout

```
To-Do                          7 open              [+ New task]

[All 7] [Today 3] [Upcoming 2] [No project 4] [Completed 18]

OVERDUE  1
 ☐ Rotate the staging cert                      Yesterday 09:00  ⋯
   high · infra

TODAY  3
 ☐ Investigate 429 errors in API logs           Today 14:00      ⋯
   high · innm-claude · api  ↗2
 ☐ Add rate limiting to nginx                   Today 16:00      ⋯

LATER  2
 ☐ Research OpenTelemetry integration           No date          ⋯
```

Rows are one line plus an optional meta line, not cards. The task inspector opens
on the right when you select a row and is otherwise absent — same rule, same
visual language as the [session inspector](session-workspace.md#inspector).

## The model

`Task` in `src/types.ts`. Everything optional is genuinely optional:

| Field | Notes |
|---|---|
| `title`, `description` | the only text |
| `done` | set **only** by you — see below |
| `dueAt` | epoch ms, or `null` for "no date" (the Later group) |
| `projectDir` | `null` is "No project" |
| `tags`, `priority` | `low` / `medium` / `high` |
| `inProgress` | set when a session is started from the task |
| `sessionIds` | linked sessions, by stable session id |
| `createdAt`, `updatedAt` | `updatedAt` is stamped by `updateTask`, never by a caller |

Deliberately absent: assignee, status workflow, estimate, subtasks, recurrence.
This is a list, not an issue tracker.

### Grouping

`groupOf` buckets by the **day** something is due, in local time:
`overdue` → `today` → `upcoming` → `later` → `done`. Local, not UTC — "today" is a
fact about your calendar, and a UTC boundary moves a 2am task into yesterday for
anyone west of Greenwich.

The **Today** filter includes overdue tasks. Something you missed is still today's
problem, and a separate trip to find it is the reason it stayed missed.

**Completed** is the only filter that admits finished work, and the only way to
see it: `groupOf` sends a done task to the `done` group, and every other filter
is a view of what's still on the plate. Inside it the order flips to
`byCompletionOrder` — most recently finished first, off `updatedAt`. Due date
stops being interesting once the thing is done, and "what did I get through"
reads newest-first. There's no separate `completedAt` in the stored shape:
`updatedAt` is stamped when `done` is set, and it only drifts if you edit a task
*after* finishing it, which isn't worth a second timestamp on every row.

### When a filter comes back empty

Each filter has its own empty state (`EMPTY_COPY` in `TodoView.tsx`): "Nothing
due today" under Today, "Nothing upcoming" under Upcoming, "No unassigned tasks"
under No project. The earlier version composed one out of the filter's own name
— "Nothing under Today" — which reads back the word you just clicked and answers
nothing. An empty list is one of the most-seen screens in a to-do app and it is
worth four strings.

The state sits centred in the list area rather than pinned under the header, and
carries exactly one action (**Create task**, which opens the same inline
composer as the header button). No illustration: at this size one would be the
largest thing in the window.

### Persistence

`tasks.json`, next to `workspace.json` in the config dir. The Rust side
(`src-tauri/src/tasks.rs`) stores it as `Vec<serde_json::Value>` and never looks
inside — the same pattern `AppSettings::custom_themes` already uses. The shape is
owned by `src/lib/tasks.ts`, which validates every row on load (`sanitizeTask`):
a half-written or hand-edited row loads with defaults rather than taking the view
down, and a row missing an id or title is dropped.

## The session bridge

This exists, and it stays out of the way.

**There is no "Start session" button on a task row.** Claude actions live in the
⋯ menu, below the ordinary ones:

```
⋯
  Edit
  Move to project…
  ─────────────────────
  Start Claude session
  Add to existing session…
  ─────────────────────
  Duplicate
  Delete
```

A button on every row would say "these are all things for Claude to do", which is
false for most of a real list.

### Start Claude session

- The task has a project → the session starts in that project's directory, filed
  under it.
- The task has no project → a scratch session, exactly like ⌘N. See
  [scratch-sessions.md](scratch-sessions.md).

The task's own text is handed over as the prompt:

```
Task: Investigate 429 errors in API logs

We keep getting 429 errors from the API.
Need to: analyze logs, find the root cause, propose a fix.
```

Nothing is invented around it. No "please help me with", no role preamble — the
task is the context.

**It is pasted, not submitted.** The text goes in through the terminal's
bracketed-paste markers (`\x1b[200~ … \x1b[201~`), so a multi-line task arrives as
one paste in Claude's prompt instead of one submitted line per newline, and it sits
there until *you* press Enter. A To-Do is intent; whether Claude acts on it is
still your call, made after you've read what it's about to receive.

Timing: a freshly spawned session isn't listening yet, so the prompt is queued and
flushed when Claude Code's own `SessionStart` hook reports in — the same event
stream that drives live status. See
[tab-status-and-naming.md](tab-status-and-naming.md).

### Add to existing session…

Picks an open session and hands it the same text. A dormant session is woken first
and gets the prompt once its hooks report in. Nothing is duplicated — the task
gains a link, the session gains a paste.

### The inverse: Create To-Do from a session

A session's ⋯ menu and its inspector both offer **Create To-Do…**. It captures a
task pre-filed under the session's project and linked back to it, then opens the
To-Do view with it selected, so noticing "we should migrate this endpoint later"
mid-session costs one menu item and doesn't interrupt what you were doing.

### What the bridge never does

**Completing a task is always an explicit decision.** Claude finishing a run does
not tick anything; nothing in the app ever writes `done`. The closest it comes is
setting `inProgress` when you start a session from a task.

**Completing a task never touches its session.** No process is killed, nothing is
closed. The session outlives the task, which is normally what you want — the
work that produced the answer is still there to read.

Linked sessions show as a subtle `↗ 2` on the task row and as a `↗ 2 tasks` button
in the session header. Both are counts, not controls, until you click them.
