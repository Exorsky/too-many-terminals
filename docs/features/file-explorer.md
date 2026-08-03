# File explorer

A read-only file browser docked to the right edge of the window, toggled from
the sidebar (the folder-tree icon, next to History/Settings). Browse every open
project's files and open one as a tab to read it — no editing yet (see
Scope / follow-ups).

## Behavior

- **Tree.** One lazily-loaded tree per open project folder. A directory fetches
  its own children (`list_dir`) only the first time it's expanded — opening a
  project with a large `node_modules` never walks it up front. The project root
  itself starts expanded; everything below it starts collapsed.
- **Find files.** Typing in the search box switches the panel to a flat,
  breadth-first filename search across every open project (`src/lib/file-search.ts`),
  skipping the usual noisy directories (`node_modules`, `.git`, `dist`, …) and
  capped at 4000 scanned entries / 200 matches so a huge or pathological tree
  can't hang the UI. This is a filename search, not a content search — there's
  no index, just bounded `list_dir` calls.
- **Opening a file.** Clicking a file (in the tree or in search results) opens
  it as a tab of `kind: 'file'` — the same `Tab`/`tabsReducer` every Claude and
  shell tab uses, just with a `path` field and no pty behind it. Clicking a file
  that's already open reuses that tab instead of duplicating it.
- **Viewing.** The active file tab renders through `FileViewer.tsx`: Markdown
  (`.md`/`.mdx`) goes through the same `Markdown.tsx` component the session
  reader uses, everything else is plain monospace text. Files over 4 MB or that
  aren't valid UTF-8 are refused with a message instead of being read.
- **Panel width** is drag-resizable from its left edge (200–480px), the same
  pattern as the terminal/markdown split seam in `App.tsx`.

## Files

- `src-tauri/src/files.rs` (+ tests) — `list_dir` (one level, folders first,
  case-insensitive) and `read_text` (size/UTF-8 guarded), plain Rust with no
  Tauri types.
- `src-tauri/src/commands.rs` — thin `list_dir` / `read_file` adapters.
- `src/lib/ipc.ts` — `DirEntry`, `listDir`, `readFile`.
- `src/lib/file-search.ts` (+ test) — the bounded breadth-first filename search.
- `src/components/FileTree.tsx` (+ test) — the recursive, lazily-loaded tree node.
- `src/components/FileExplorerPanel.tsx` (+ test) — the panel: header, search
  box, and per-project trees or search results.
- `src/components/FileViewer.tsx` (+ test) — renders the active file tab's content.
- `src/types.ts` — `TabKind` gained `'file'`; `Tab` gained an optional `path`.
- Wiring in `App.tsx`: `showFiles` state, the resize seam, `handleOpenFile`,
  and the render branch that swaps `Terminal`/`HomeScreen` for `FileViewer`
  when the active tab is a file.

## Scope / follow-ups

Deliberately left out of this pass — see the design notes for why each was cut:

- **Editing.** Read-only for now; adding `write_file`, a dirty indicator, and
  Ctrl+S is the natural phase 2, most likely swapping `<pre>` for CodeMirror.
- **Persistence.** File tabs don't survive an app restart — `SavedTab` has no
  `path` field yet. Nothing else needed it, so it wasn't added speculatively.
- **File watching.** No live reload while a file tab is open; re-open the tab
  (or add a refresh action) to see external changes.
- **Content search, git status letters, tabs-within-the-explorer, split
  editors.** All plausible Orca-style additions; none were needed to browse and
  read a project's files, so none were built.
