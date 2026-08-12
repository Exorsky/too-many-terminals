# Session reader

Reads a Claude Code session as a rendered document instead of resuming it in a
terminal. Two surfaces, one shared body (`TranscriptDocument`):

1. **In-place, via the tab strip** (primary). [`SessionControls`](#session-controls)
   docks two independent controls to the trailing edge of the tab strip for a
   readable Claude tab: **Preview** and **Split**. Preview toggles the active tab
   between its live terminal and a full-pane rendered read of the same session —
   it's an on/off switch, not a three-way mode. Split is its own layout choice
   (a menu, not a toggle state): **Split right** or **Split down** puts the live
   terminal and the markdown reader side by side or stacked, so you can watch the
   session run and read it at once, and it runs independently of Preview — Preview
   disables itself while Split is on, since the pane split already answers "what's
   showing." A **draggable seam** between the two halves resizes the split
   (`splitRatio` in `App`, clamped 25–75%; `splitDirection` picks which axis the
   drag reads). Each half wears a mono label strip (`Terminal` / `Transcript`) and
   the transcript sits on a lifted `card` surface so it stops blending into the
   black terminal. Available for a Claude tab once its session id is known
   (`tab.resumeSessionId`, set for resumed tabs and learned via
   `claude-session-resolved` for fresh ones), and gated by the General settings
   switch.

   The markdown pane (`MarkdownPane`) owns its own header — turn count,
   Rendered/Raw, Copy all, Refresh — since those controls only ever act on it;
   there's no separate bar carrying them. It **opens scrolled to the bottom** and
   **live-follows** the session: while it's on screen it re-reads the transcript
   every `LIVE_FOLLOW_MS`, so new turns appear as Claude answers — including
   plain-text replies, which never flip the tab to `working`. A re-read that
   returns identical content is skipped (`useTranscript` fingerprints it), so a
   quiet session doesn't re-render or flash; and re-reads keep the current turns
   visible instead of blanking to a loading state. It only tails the bottom while
   you're already there — scroll up to read history and it stays put until you
   return to the end. In Split, the terminal half stays a real live process
   (unlike full Preview, which needs none): it keeps a dormant tab awake and
   still counts as "on screen" for notifications and auto-sleep.
2. **Full-pane overlay, via Session History** (`SessionReader`). A
   [history](session-history.md) row's `▤` action, or `Space`, opens a past
   session as an overlay with its own toolbar.

Read-only and offline; both parse the same `~/.claude/projects/<enc>/<id>.jsonl`
transcript the CLI writes. For a live session the read is a snapshot — **Refresh**
re-reads the still-growing file.

## Session controls

`SessionControls` sits in `TabBar`'s `trailing` slot (not a second row — the tab
strip is the only place a tab's identity needs to show; see
[docs/design.md](../design.md)), visible whenever `showMarkdownToggle` is on and
the active tab is a readable Claude session:

- **Preview** (`FileText` icon button) — toggles `terminal ⇄ markdown` for the
  active tab. Disabled while Split is active.
- **Split** (icon button + dropdown menu) — **Split right** / **Split down** set
  the mode to `split` and pick `splitDirection`; **Unsplit** (shown only while
  split) returns to `terminal`.

Per-tab mode is remembered in `App` (`mdTabs`, a `Map<tabId, 'markdown' |
'split'>`; absent = terminal). `splitDirection` is a single window-level
preference, not per-tab — like `splitRatio` always was, it's "how I like to look
at things" rather than session state.

## What it shows

- **Turns** in order down a left thread gutter (round node = Claude, square =
  you), with the role header shown only when the speaker changes.
- **Claude replies** rendered as Markdown — headings, fenced code (monospace,
  language-labelled), nested/checkbox lists, bold, italic, inline code, links
  (incl. bare URLs), pipe tables, horizontal rules — in a proportional reading
  face, deliberately unlike the monospace terminal.
- **Your messages** kept as quiet monospace blocks (they were typed input).
- **Tool calls** render as a labelled chip: tool name + its key argument (the
  file read, command run, pattern searched). A multi-line command keeps its line
  breaks and wraps instead of being clipped to one line, so it reads like code.
  Tool *results*, thinking, and images are dropped by the parser to keep the read
  clean.

## Controls

- **Rendered ⇄ Raw** segmented toggle — Raw shows the whole conversation as
  Markdown source (`## You` / `## Claude`, tool chips as `>` blockquotes),
  selectable and copyable as-is.
- **Copy on hover** — each Claude reply shows a Copy button on hover that copies
  just that turn as Markdown. **Copy all** copies the whole document. **Refresh**
  re-reads the transcript (useful for a live session).
- In-place, these controls live in `MarkdownPane`'s own header; the overlay adds
  **Resume** (opens a live Claude tab) and **Esc** / ✕ to close.

## Parsing rules (`read_transcript`)

Per JSONL line: only `type: "user" | "assistant"` are turns. `message.content`
is normalized (string, or an array of `text` / `tool_use` blocks) into
`TranscriptBlock::{Text, Tool}`. Synthetic user text (slash-command echoes, hook
caveats — same `looks_synthetic` rule as the preview) is skipped, as are
tool-result-only user lines. Empty turns are dropped; malformed lines are
skipped rather than failing the whole read. A tool block's `detail` is its key
argument with intra-line whitespace collapsed but **line breaks kept** (blank
lines dropped), capped at `TOOL_DETAIL_MAX_CHARS`, so multi-line commands stay
readable. Session ids are validated (`[A-Za-z0-9_-]+`) before touching the
filesystem, and turns are capped at `TRANSCRIPT_MAX_TURNS` as a guard.

## Files

- `src-tauri/src/session_history.rs` — `read_transcript`, `message_blocks`,
  `summarize_tool_input`, `TranscriptTurn`/`TranscriptBlock` (+ unit tests).
  Command adapter in `commands.rs` (`read_transcript`), registered in `lib.rs`.
- `src/lib/markdown.ts` (+ tests) — the small Markdown parser (data model only).
- `src/lib/transcript.ts` (+ tests) — turns → Markdown for Raw view and copy.
- `src/lib/use-transcript.ts` — the fetch/reload hook, shared by both surfaces.
- `src/components/TranscriptDocument.tsx` — the shared rendered/raw reading body.
- `src/components/MarkdownPane.tsx` (+ tests) — the in-place scrolling pane
  (Preview/Split); owns the open-at-bottom behaviour and its own header
  (turn count, Rendered/Raw, Copy all, Refresh).
- `src/components/TranscriptStates.tsx` — shared loading/error/empty placeholders.
- `src/components/Markdown.tsx` — Markdown → React elements.
- `src/components/CopyButton.tsx` — copy-with-feedback button.
- `src/components/SessionControls.tsx` (+ tests) — the Preview toggle and Split
  menu docked to `TabBar`.
- `src/components/SessionReader.tsx` (+ tests) — the History overlay reader.
- Triggers in `SessionHistoryPanel.tsx` (history rows) and `SessionControls`.
  Wired in `App.tsx`: `mdTabs`/`mdView`/`mdReload`/`splitDirection` state,
  `setTabMode`, `handleReadSession` (overlay).

## Follow-ups

- Export to a `.md` file (currently copy-only).
- Optional expandable tool results / thinking, off by default.
- Promote the reader to a real non-terminal tab so it survives tab switches and
  workspace restore.
