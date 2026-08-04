# Session reader

Reads a Claude Code session as a rendered document instead of resuming it in a
terminal. Two surfaces, one shared body (`TranscriptDocument`):

1. **In-place, via the session bar** (primary). The [session bar](#session-bar)
   above the active terminal carries a `Terminal | Split | Markdown` toggle.
   **Markdown** replaces the terminal in the same pane with the rendered
   conversation; **Split** puts the live terminal (left) and the markdown reader
   (right) side by side, so you can watch the session run and read it at once.
   In Split each half wears a mono label strip (`Terminal` / `Transcript`), the
   transcript sits on a lifted `card` surface (so it stops blending into the
   black terminal), and a **draggable seam** between them resizes the split
   (`splitRatio` in `App`, clamped 25–75%); the reading controls stay in the bar.
   Rendered/Raw, Copy all, and Refresh live in the bar. Available for a Claude tab
   once its session id is known (`tab.resumeSessionId`, set for resumed tabs and
   learned via `claude-session-resolved` for fresh ones), and gated by the General
   settings switches.

   The markdown pane (`MarkdownPane`) **opens scrolled to the bottom** and
   **live-follows** the session: while it's on screen it re-reads the transcript
   every `LIVE_FOLLOW_MS`, so new turns appear as Claude answers — including
   plain-text replies, which never flip the tab to `working`. A re-read that
   returns identical content is skipped (`useTranscript` fingerprints it), so a
   quiet session doesn't re-render or flash; and re-reads keep the current turns
   visible instead of blanking to a loading state. It only tails the bottom while
   you're already there — scroll up to read history and it stays put until you
   return to the end. In Split, the terminal half stays a real live process
   (unlike full Markdown, which needs none): it keeps a dormant tab awake and
   still counts as "on screen" for notifications and auto-sleep.
2. **Full-pane overlay, via Session History** (`SessionReader`). A
   [history](session-history.md) row's `▤` action, or `Space`, opens a past
   session as an overlay with its own toolbar.

Read-only and offline; both parse the same `~/.claude/projects/<enc>/<id>.jsonl`
transcript the CLI writes. For a live session the read is a snapshot — **Refresh**
re-reads the still-growing file.

## Session bar

A slim strip above the terminal (`SessionBar`), shown for the active tab when
`showSessionBar` is on. Left: session status dot + name + folder. Right, for a
readable Claude tab: the markdown controls (shown in both Markdown and Split, since
the pane is on screen) and the `Terminal | Split | Markdown` toggle. Both the bar
and the toggle are user preferences (see [settings.md](settings.md)); reading modes
require both on, so there is always a bar toggle to leave by. Per-tab mode is
remembered in `App` (`mdTabs`, a `Map<tabId, 'markdown' | 'split'>`; absent =
terminal).

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
- In-place, these controls live in the session bar; the overlay adds **Resume**
  (opens a live Claude tab) and **Esc** / ✕ to close.

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
  (Markdown/Split); owns the open-at-bottom behaviour.
- `src/components/TranscriptStates.tsx` — shared loading/error/empty placeholders.
- `src/components/Markdown.tsx` — Markdown → React elements.
- `src/components/CopyButton.tsx` — copy-with-feedback button.
- `src/components/SessionBar.tsx` (+ tests) — the in-place bar (`▤` toggle).
- `src/components/SessionReader.tsx` (+ tests) — the History overlay reader.
- Triggers in `SessionHistoryPanel.tsx` (history rows) and the session bar's
  own `Terminal | Split | Markdown` toggle. Wired in `App.tsx`:
  `mdTabs`/`mdView`/`mdReload` state, `setTabMode`, `handleReadSession` (overlay).

## Follow-ups

- Export to a `.md` file (currently copy-only).
- Optional expandable tool results / thinking, off by default.
- Promote the reader to a real non-terminal tab so it survives tab switches and
  workspace restore.
