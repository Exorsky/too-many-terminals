import { createContext, useContext, useEffect, useState, type DragEvent, type ReactNode } from 'react';
import { ChevronRight, File, Folder, FolderOpen } from 'lucide-react';
import { FILE_MIME } from '@/lib/dnd';
import { cn } from '@/lib/utils';
import * as ipc from '@/lib/ipc';
import type { DirEntry } from '@/lib/ipc';
import { usePollWhileFocused } from '@/lib/use-poll';
import { gitMarks, gitPathKey, refreshGit, useGitStatus, type GitMarks } from '@/lib/git';
import { gitCodeClass } from './GitBranch';

/** The tree's git marks, set once at the root so every node can look itself up. */
const MarksContext = createContext<GitMarks | null>(null);
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger,
} from '@/components/ui/context-menu';

/** Whether two listings of the same directory say the same thing. Compared by
 *  hand so an unchanged folder keeps its existing array: handing React a fresh
 *  one every couple of seconds would re-render the whole subtree for nothing. */
function sameListing(a: DirEntry[], b: DirEntry[]): boolean {
  return a.length === b.length
    && a.every((entry, i) => entry.path === b[i].path && entry.isDir === b[i].isDir);
}

/** Marks a file row as draggable onto the workspace. Directories aren't
 *  draggable — there is nothing to open. The payload carries the project
 *  folder as well as the path, because the pane that receives it has no way
 *  to work out which project a path belongs to. */
function fileDragProps(rootDir: string, path: string, isDir: boolean) {
  if (isDir) return {};
  return {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData(FILE_MIME, JSON.stringify({ dir: rootDir, path }));
    },
  };
}

/** Right-click → Show in Finder, for any row naming a file or folder on disk.
 *  Reveal, not open: the folder that holds it, with it selected — the same for
 *  a file and a folder, and what "where is this" means. */
export function RevealMenu({ path, children }: { path: string; children: ReactNode }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-44">
        <ContextMenuItem onSelect={() => ipc.revealInFileManager(path)}>
          <FolderOpen size={13} /><span>Show in {ipc.fileManagerName()}</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

interface NodeProps {
  entry: DirEntry;
  depth: number;
  /** The project folder this tree is rooted at, for the drag payload. */
  rootDir: string;
  defaultOpen?: boolean;
  activePath: string | null;
  onOpen: (path: string) => void;
}

function Node({ entry, depth, rootDir, defaultOpen, activePath, onOpen }: NodeProps) {
  const [open, setOpen] = useState(!!defaultOpen);
  const marks = useContext(MarksContext);
  const key = gitPathKey(entry.path);
  // A file's own letter; a folder gets a dot when something below it changed
  // (or the letter, when the whole folder is new and untracked).
  const code = marks?.files.get(key) ?? null;
  const changedBelow = entry.isDir && !code && !!marks?.dirs.has(key);
  const [children, setChildren] = useState<DirEntry[] | null>(null);

  // Loads its own children once, the first time it's expanded — a directory
  // that's never opened never pays for a listDir call.
  useEffect(() => {
    if (!open || children || !entry.isDir) return;
    ipc.listDir(entry.path).then(setChildren).catch(() => setChildren([]));
  }, [open, children, entry.isDir, entry.path]);

  // ...and keeps re-listing while it stays open, so a file written by a
  // session in the next pane shows up without collapsing the folder and
  // expanding it again. Only expanded directories poll: a tree you never
  // opened still costs nothing.
  usePollWhileFocused(() => {
    ipc.listDir(entry.path)
      .then((next) => setChildren((prev) => (prev && sameListing(prev, next) ? prev : next)))
      .catch(() => {});
  }, open && entry.isDir);

  return (
    <>
      <RevealMenu path={entry.path}>
      <button
        type="button"
        className={cn(
          'flex items-center gap-1.5 w-[calc(100%-8px)] mx-1 my-0.5 px-1.5 py-[3px] rounded-sm text-left',
          'text-[12px] text-muted-foreground hover:text-foreground hover:bg-hover border-none bg-transparent cursor-pointer font-inherit',
          entry.path === activePath && 'text-foreground bg-selected',
        )}
        style={{ paddingLeft: 6 + depth * 12 }}
        {...fileDragProps(rootDir, entry.path, entry.isDir)}
        onClick={() => {
          if (!entry.isDir) { onOpen(entry.path); return; }
          setOpen((v) => {
            // Drop the cached listing on collapse, so re-expanding re-fetches
            // instead of showing a stale snapshot from before files were
            // added/removed on disk.
            if (v) setChildren(null);
            return !v;
          });
        }}
        title={entry.name}
      >
        {entry.isDir ? (
          <ChevronRight size={10} className={cn('shrink-0 text-muted-foreground transition-transform duration-150', open && 'rotate-90')} />
        ) : (
          <span className="w-[10px] shrink-0" />
        )}
        {entry.isDir ? <Folder size={12} className="shrink-0" /> : <File size={12} className="shrink-0" />}
        <span className={cn('truncate', code && gitCodeClass(code))}>{entry.name}</span>
        {code && <span className={cn('ml-auto shrink-0 font-mono text-[10.5px] font-semibold', gitCodeClass(code))}>{code}</span>}
        {changedBelow && <span aria-label="changes inside" className="ml-auto shrink-0 w-1.5 h-1.5 rounded-full bg-link" />}
      </button>
      </RevealMenu>
      {open && children?.map((child) => (
        <Node key={child.path} entry={child} depth={depth + 1} rootDir={rootDir} activePath={activePath} onOpen={onOpen} />
      ))}
    </>
  );
}

export interface FileTreeProps {
  /** The project folder this tree is rooted at, rendered as its own row. */
  root: DirEntry;
  activePath: string | null;
  onOpen: (path: string) => void;
}

/** A lazily-loaded file tree for one project folder — each directory fetches
 *  its own children the first time it's expanded, so opening a project never
 *  walks the whole tree (node_modules included) up front. Starts fully
 *  collapsed, including the project root itself. */
export default function FileTree({ root, activePath, onOpen }: FileTreeProps) {
  const git = useGitStatus(root.path);
  // Rides the tree's own poll: while the explorer is open and the window
  // focused, the marks follow edits — refreshGit throttles to one status per
  // 15s per folder, however many trees ask.
  usePollWhileFocused(() => { void refreshGit(root.path); }, true);
  return (
    <MarksContext.Provider value={git ? gitMarks(git) : null}>
      <Node entry={root} depth={0} rootDir={root.path} activePath={activePath} onOpen={onOpen} />
    </MarksContext.Provider>
  );
}
