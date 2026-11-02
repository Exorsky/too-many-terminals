# Path links

File and folder paths are links wherever Claude or a shell names them: the
terminal and the transcript. Hovering one shows a card with a preview. A click
pins the card, and ⌘-click opens the path. The same idea as [Jira links](jira-links.md), for the filesystem.

On by default. **Settings › Integrations › Path links** has the switch
(`pathLinksEnabled`). Off leaves terminals and transcripts plain. The terminal
reads the setting per line, so the switch applies to open terminals.

## Where

| Surface | How |
|---|---|
| Terminal (Claude and shell) | An xterm link provider beside the URL and Jira ones. Paths resolve from the session's `cwd` |
| Transcript (Markdown view, History reader) | An inline code span that is *only* a path (`` `src/app.ts:12` ``) gets the card on hover. A click pins it and ⌘-click opens. Prose and fenced blocks are left alone. Claude writes paths in code spans almost every time |

## One detector, checked against the disk

`findPaths` (`src/lib/path-links.ts`) matches the *shape* of a path:

1. it can start with a root: `/`, `~/`, `./`, `../` or `C:\`;
2. then come name segments joined by `/` or `\`;
3. it can end with `:line` or `:line:col`.

The suffix is underlined but isn't part of the path. A trailing full stop is
dropped. A token with no separator counts only if it has a letter-led extension:
`package.json` matches, `v0.29.0` doesn't.

**Paths with spaces** (`C:\Program Files\…`, `OneDrive - Company`) are found
when they're quoted with `"…"`, `'…'` or `` `…` `` — in plain output that's the
only thing marking where such a path ends. A transcript code span is its own
quoting. The plain scan still matches pieces of a quoted path (`Smith\a.txt`),
so after the existence check `outermost` keeps the longest of the overlapping
matches. An apostrophe that pairs with a later quote (`don't … it's`) is only a
candidate that doesn't exist, so it can't hide a real path inside it.

Shape alone also matches `and/or`, `example.com` and `w/o`, so **nothing links
until the backend says it exists**. `stat_paths` (`src-tauri/src/files.rs`)
resolves each candidate the way a shell in `cwd` would: absolute paths as they
are, `~` against home, everything else against `cwd`. `.` and `..` are folded
lexically, without canonicalizing, so `/tmp` stays `/tmp`. The answers are
cached for ten seconds per (cwd, path). The terminal asks again for every line
the pointer crosses, and a file Claude has just written starts linking soon after.

**A bare file name** that isn't in `cwd` itself (Claude often writes
`path-links.md` for `docs/features/path-links.md`) falls back to the shallowest
file of exactly that name under `cwd` (`resolvePath`). It uses `searchFiles`: a
capped breadth-first walk that skips `node_modules`, `.git` and similar. The
result is remembered for a minute. Only a hover or a click starts that walk.
The terminal's per-line scan never does, so in the terminal a bare name links
only when it's in `cwd`.

In a transcript, a code span looks like a link (dotted underline, pointer) only
after the first hover has found its path. A span shaped like a path that
doesn't exist stays plain.

The check is local and cheap, so unlike Jira there's no rate limit to respect.

## The card

`PathCard` is mounted once by App and driven by `showPathCard` / `hidePathCard`.
Its timing comes from the same `createHoverCard` store as the issue card
(`src/lib/hover-card.ts`): 300ms before it opens, then a 400ms grace so the
pointer can cross from a terminal line to the card. 150ms was too short for that.

**A plain click pins the card.** It opens at once, and further hovers and the
pointer leaving don't close it. **Esc**, a click outside it or any of its
actions closes it. Esc is swallowed while the card is pinned: in a Claude
terminal it would otherwise interrupt Claude. **⌘-click** (Ctrl-click on
Windows/Linux) opens the path straight away, like a link in VS Code's terminal.
Reading output should never open tabs by accident.

| Kind | Preview | Primary action |
|---|---|---|
| Text file | first 14 lines | **Open in tab** |
| Image (png, jpg, gif, webp, svg, bmp, ico, avif) | the image, from `read_file_bytes`: raw bytes, then a Blob URL | **Open** with the OS app |
| Folder | first 8 entries, "+N more" | **Open folder** in the file manager |

Every card also has **Show in Finder/Explorer** and **Copy path**. A text file's card also has **Open with app**: the OS default app for that file type, for when you'd rather edit it in your own editor than in a tab. ⌘-click on
the link itself does the primary action. Text opens as a tab rooted at the
session's `cwd`, so the editor's write boundary is that folder. A file outside
it opens, but saving it is refused.

Previews read at most 4 MB (`MAX_READ_BYTES`). Bigger files and binaries show
the backend's reason instead.

Anything the OS would *run* instead of show — `.app` bundles, `.command`,
`.exe`, `.bat` and so on (`launches` in `path-links.ts`) — is revealed in the
file manager and never opened, and it gets no **Open with app**. One click on a
path in someone's output must never launch it. Previews read regular files only,
capped at 4 MB while reading, and the file type is checked before opening, so `/dev/zero` or a FIFO can't hang a worker.

The bare-name walk is skipped when the session runs in your home folder. That
walk would cover all of `~`, and on macOS reaching into Documents or Library
raises privacy prompts.

## Not yet

- A shell tab resolves relative paths from the session folder even after a
  `cd`. Following the shell's cwd needs OSC 7.
- Lines with wide characters (CJK, some emoji) shift the underline to the right,
  the same way Jira links do. The fix is to map string offsets to cells.

- Jumping to `:line` when a file opens: the editor doesn't take a scroll target yet.
- Paths split across a wrapped terminal line, and paths Claude Code's UI
  shortened with `…`.
- Paths in prose and fenced code blocks in the transcript.

## Files

- `src/lib/path-links.ts` (+ test): the detector, the existence cache, the card store
- `src/lib/hover-card.ts`: the hover-card timing, shared with Jira
- `src/components/PathCard.tsx` (+ test)
- `src/components/Terminal.tsx`: the link provider
- `src/components/Markdown.tsx`: `InlineCode`, with `cwd` from a context
- `src-tauri/src/files.rs`: `stat_paths`, `read_bytes`
