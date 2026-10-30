# Git

When a session's folder is a git repo, the app shows where it stands — which
branch, whether anything is uncommitted, how far it is from its upstream —
without a `git status` typed into a split. **Read-only**: the app never
commits, checks out, fetches or pushes; that stays Claude's (or your shell's)
job.

## What shows where

| Surface | What |
|---|---|
| Session row (sidebar), second line | `⑂ branch ● ↑2 ↓1` after what Claude is doing / the project. Hidden in the compact list |
| Title-bar breadcrumb | `project › ⑂ branch › session` |
| File explorer | A letter per changed file — M modified, A added, U untracked, R renamed, C conflict — and a dot on every folder with a change below it |

`GitBranch` renders the label: the branch (or `detached abc1234`), a `●` when
the working tree has changes, ahead/behind only when non-zero, and a tooltip
spelling it all out. Detached HEAD and an empty repo say so instead of
showing nothing.

The mark colors are deliberately **not** the session status colors (those are
reserved, see [design.md](../design.md#status-vocabulary)): modified is the
link blue, new is cyan, a conflict magenta. Deleted files don't appear — the
tree lists what's on disk.

## Asking git as little as possible

- **One status per folder, not per session** (`src/lib/git.ts`): three
  sessions in one repo, the breadcrumb and the file tree all read one cached
  `git status`.
- It's asked for when a surface first shows a folder, when the window regains
  focus, when a Claude run in that folder ends (`working` → anything, in App's
  status handler), and while the file explorer is open and focused (riding
  its existing poll). Nothing else — no timer of its own.
- A status younger than 15s is reused; even a forced refresh waits 2s after
  the last one; one request in flight per folder.
- The backend (`src-tauri/src/git.rs`) runs `git rev-parse --show-toplevel`
  and `git status --porcelain=v2 --branch -z` with `GIT_OPTIONAL_LOCKS=0`: a
  status that refreshed the index would take `index.lock` and could make
  Claude's own `git commit` in the same folder fail. On Windows without a
  console window.
- Not a repo, or no git installed: `None`, and nothing renders.
- At most 2000 changed files are listed.

## Files

- `src-tauri/src/git.rs` (+ tests, incl. a real `git init`) — run and parse
- `src-tauri/src/commands.rs` — `git_status`
- `src/lib/git.ts` (+ tests) — per-folder cache, refresh rules, tree marks
- `src/components/GitBranch.tsx` (+ tests) — the label and mark colors
- Wiring: `SessionsSidebar.tsx` (row), `App.tsx` (breadcrumb, refresh when a
  run ends), `FileTree.tsx` (marks)
