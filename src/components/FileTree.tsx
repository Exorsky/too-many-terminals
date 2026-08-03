import { useEffect, useState } from 'react';
import { ChevronRight, File, Folder } from 'lucide-react';
import { cn } from '@/lib/utils';
import * as ipc from '@/lib/ipc';
import type { DirEntry } from '@/lib/ipc';

interface NodeProps {
  entry: DirEntry;
  depth: number;
  defaultOpen?: boolean;
  activePath: string | null;
  onOpen: (path: string) => void;
}

function Node({ entry, depth, defaultOpen, activePath, onOpen }: NodeProps) {
  const [open, setOpen] = useState(!!defaultOpen);
  const [children, setChildren] = useState<DirEntry[] | null>(null);

  // Loads its own children once, the first time it's expanded — a directory
  // that's never opened never pays for a listDir call.
  useEffect(() => {
    if (!open || children || !entry.isDir) return;
    ipc.listDir(entry.path).then(setChildren).catch(() => setChildren([]));
  }, [open, children, entry.isDir, entry.path]);

  return (
    <>
      <button
        type="button"
        className={cn(
          'flex items-center gap-1.5 w-[calc(100%-8px)] mx-1 my-0.5 px-1.5 py-[3px] rounded-sm text-left',
          'text-[11px] text-muted-foreground hover:text-foreground hover:bg-white/4 border-none bg-transparent cursor-pointer font-inherit',
          entry.path === activePath && 'text-foreground bg-white/8',
        )}
        style={{ paddingLeft: 6 + depth * 12 }}
        onClick={() => (entry.isDir ? setOpen((v) => !v) : onOpen(entry.path))}
        title={entry.name}
      >
        {entry.isDir ? (
          <ChevronRight size={10} className={cn('shrink-0 text-muted-foreground/60 transition-transform duration-150', open && 'rotate-90')} />
        ) : (
          <span className="w-[10px] shrink-0" />
        )}
        {entry.isDir ? <Folder size={12} className="shrink-0" /> : <File size={12} className="shrink-0" />}
        <span className="truncate">{entry.name}</span>
      </button>
      {open && children?.map((child) => (
        <Node key={child.path} entry={child} depth={depth + 1} activePath={activePath} onOpen={onOpen} />
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
 *  walks the whole tree (node_modules included) up front. */
export default function FileTree({ root, activePath, onOpen }: FileTreeProps) {
  return <Node entry={root} depth={0} defaultOpen activePath={activePath} onOpen={onOpen} />;
}
