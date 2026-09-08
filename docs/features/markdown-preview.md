# Markdown preview

One renderer (`src/components/Markdown.tsx`) draws every piece of Markdown in
the app: a `.md`/`.mdx` file's **Preview** half in the
[file explorer](file-explorer.md), and every Claude reply in the
[session reader](session-reader.md).

## What it renders

CommonMark plus the GitHub extensions, through `react-markdown` + `remark-gfm`.
The library is handed a **components map**, not HTML — every element is a real
React element with the app's own classes, so nothing is ever injected as raw
markup (no `dangerouslySetInnerHTML`, with the one exception noted under
[Mermaid](#mermaid)).

Headings h1–h6 (each with a GitHub-style `id`), fenced code with a language
label and a hover copy button, inline code, bold/italic/strikethrough, links
and bare URLs, ordered lists that keep their start number, nested lists, task
lists (`- [x]`, ticked items greyed and struck), block quotes, pipe tables with
alignment, images, and horizontal rules.

This replaced a hand-rolled parser that was cheap for transcripts and wrong for
real documents: it truncated a URL at the first `)`, dropped a link whose text
contained `]`, put a `[a](x "title")` title inside the href, showed `####` as
literal text, and read `a * b … c * d` as italics. Those aren't a list of
oversights so much as the reason CommonMark is long — the parser is the wrong
thing to own here.

## Links

A link is dispatched by what it points at:

| target | what a click does |
|---|---|
| `https://…`, `mailto:…` | hands it to the OS (`ipc.openExternal`) |
| `#some-heading` | scrolls to that heading **inside this document** |
| `docs/architecture.md`, `../design.md`, `C:\proj\x.md` | opens that file as a tab |

The file case is the point of the whole thing: reading `CLAUDE.md` in Preview,
its links to `docs/` open, instead of sending you to the explorer to find the
file by hand.

Resolution lives in `src/lib/paths.ts` (+ tests), not in the renderer — the
renderer only reports "this href names a file", and `FileViewer` (which knows
*which* file the link was written in) resolves it:

- relative to the **linking file's** directory, the way GitHub resolves it;
- separator-agnostic — links are written with `/` inside docs that live at a
  `C:\…` path, and the result keeps the source file's separator;
- percent-decoded, so `a%20b.md` names `a b.md`;
- `..` never climbs above the root, and `write_file` still enforces the real
  boundary on the Rust side.

A `#anchor` on a *file* link (`x.md#section`) opens the file; the anchor is
dropped. Cross-file anchors would need the editor to accept a scroll target.

Anchor ids are computed the way GitHub computes them (lowercase, punctuation
dropped, spaces to hyphens), so a doc written for GitHub links correctly here.
A `#anchor` lookup is scoped to its own `Markdown` instance first: a transcript
mounts one per turn, so ids repeat down the page and the nearest one wins.

## Mermaid

A ` ```mermaid ` fence renders as a diagram (`src/components/Mermaid.tsx`).

`mermaid` is ~1 MB, so it is **dynamically imported the first time a diagram
actually appears** — never at startup — behind one module-level promise that
every later diagram reuses. It runs with `securityLevel: 'strict'` (mermaid
sanitizes the SVG it returns, which is then set as HTML — the one such spot in
the app) and `suppressErrorRendering: true`, so a broken diagram can't paint
itself into `<body>`.

**A diagram that doesn't parse falls back to its own source**, labelled
`mermaid — couldn't render`. While you're typing one, every keystroke is a
half-written diagram; blanking the pane on each of them would be worse than
showing the text.

## Reading ergonomics (file preview)

- **Preview stays mounted.** Flipping to Source and back returns you to where
  you were reading, rather than to the top.
- **Ctrl/Cmd+Shift+V** toggles Source/Preview. Bound only while a Markdown file
  tab is the visible one, so it never shadows the terminal's paste chord.
- **The half you were last on is remembered** (`localStorage`, key `md-view`)
  across tabs and restarts — docs are read far more often than they're edited.
- **Ctrl/Cmd+F** works in the preview: the same `FindBar` the session reader
  uses, mounted only while the preview is on screen.
- **A reading measure** (`max-w-[76ch]`), so prose doesn't run the full width of
  a wide panel.
- Editing an off-screen preview doesn't re-render it; the pending text is
  applied when you switch back.

## Files

- `src/components/Markdown.tsx` (+ tests) — the components map, link dispatch,
  anchor scrolling, heading slugs.
- `src/components/CodeBlock.tsx` — fenced code: language label, inner scroll,
  hover copy button.
- `src/components/Mermaid.tsx` — the lazily-imported diagram renderer.
- `src/lib/paths.ts` (+ tests) — `isExternalHref`, `splitHref`, `resolveFrom`.
- `src/components/FileViewer.tsx` (+ tests) — the Source/Preview half, the
  remembered view, the hotkey, and link → open-a-tab wiring (`onOpenFile`,
  which is `App`'s own `handleOpenFile`).

## Scope / follow-ups

- **Local images** (`![](./shot.png)`) don't load — that needs Tauri's asset
  protocol and a scope entry. Remote images work.
- **No sync-scroll** between Source and Preview.
- **No outline/table of contents** — Ctrl+F covers the common case.
- **Transcript links** stay external-only: a session reader turn has no file to
  resolve relative paths against, so `onOpenLink` isn't passed there.
- A link that leaves the project (`../../elsewhere/x.md`) **opens** — `read_file`
  only guards size and encoding — but the tab it opens carries the original
  project as its root, so `write_file` will refuse to save it. Reading someone
  else's file through a link is the common case; editing it isn't.
