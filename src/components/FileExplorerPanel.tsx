import { useEffect, useRef, useState } from 'react';
import { File, FolderTree, Pin, PinOff, Search } from 'lucide-react';
import { cn, folderName } from '@/lib/utils';
import { searchFiles, type FileMatch } from '@/lib/file-search';
import FileTree from './FileTree';
import { FILE_MIME } from '@/lib/dnd';

interface FileExplorerPanelProps {
  projects: string[];
  activePath: string | null;
  onOpenFile: (dir: string, path: string) => void;
  /** Docked and staying, rather than laid over the terminal for one look. */
  pinned?: boolean;
  /** Given only when the panel can change modes — the pin appears with it. */
  onTogglePin?: () => void;
}

/** The strip along the window's right edge that brings the file explorer back.
 *
 *  Visible, not a bare hot zone. An invisible edge doesn't announce itself, and
 *  when the window isn't flush against the screen the pointer misses it and the
 *  whole feature reads as broken — the complaint Arc's auto-hidden sidebar
 *  collects. Eight pixels with a notch that grows under the cursor says "there
 *  is something here" without costing the terminal a column.
 *
 *  Hover waits 300ms, click doesn't: the right edge is somewhere the pointer
 *  passes through on its way to a scrollbar or a window button, so crossing it
 *  isn't a request. Same floor as the sidebar rail's name panel. */
export function FilesEdge({ onPeek }: { onPeek: () => void }) {
  const timer = useRef<number | null>(null);
  const cancel = () => {
    if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; }
  };
  useEffect(() => cancel, []);

  return (
    <button
      type="button"
      data-files-edge
      aria-label="Show files"
      title="Show files"
      className="group flex items-center justify-center w-2 shrink-0 border-l border-border bg-card cursor-pointer p-0"
      onMouseEnter={() => { cancel(); timer.current = window.setTimeout(onPeek, 300); }}
      onMouseLeave={cancel}
      onClick={() => { cancel(); onPeek(); }}
      onFocus={onPeek}
    >
      <span className={cn(
        'w-0.5 h-6 rounded-full bg-border transition-[height,background-color] duration-100',
        'group-hover:h-11 group-hover:bg-muted-foreground',
      )} />
    </button>
  );
}

/** The right-hand file explorer: one lazily-loaded tree per open project
 *  folder, plus a bounded filename search across all of them. */
export default function FileExplorerPanel({
  projects, activePath, onOpenFile, pinned, onTogglePin,
}: FileExplorerPanelProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FileMatch[] | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults(null); return; }
    let cancelled = false;
    searchFiles(projects, q).then((matches) => { if (!cancelled) setResults(matches); });
    return () => { cancelled = true; };
  }, [query, projects]);

  const searching = query.trim().length > 0;

  return (
    <div className="flex flex-col w-full h-full bg-card">
      <div className="flex items-center gap-1.5 h-8 px-2.5 border-b border-border shrink-0">
        <FolderTree size={12} className="text-muted-foreground shrink-0" />
        <span className="text-[11px] font-semibold text-foreground/90">Files</span>
        {onTogglePin && (
          <button
            type="button"
            aria-pressed={!!pinned}
            aria-label={pinned ? 'Unpin files' : 'Pin files'}
            title={pinned ? 'Unpin files' : 'Pin files'}
            className={cn(
              'flex items-center justify-center w-5 h-5 ml-auto shrink-0 rounded-sm border-none cursor-pointer',
              pinned ? 'text-primary bg-primary/15' : 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-white/8',
            )}
            onClick={onTogglePin}
          >
            {pinned ? <PinOff size={11} /> : <Pin size={11} />}
          </button>
        )}
      </div>
      <div className="flex items-center gap-1.5 mx-2 mt-1.5 mb-1 px-2 py-1 rounded-md border border-border bg-background shrink-0">
        <Search size={11} className="text-muted-foreground shrink-0" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find files"
          className="flex-1 min-w-0 bg-transparent border-none outline-none text-[11px] text-foreground placeholder:text-muted-foreground/70 font-inherit"
        />
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin py-1">
        {searching ? (
          results === null ? (
            <div className="px-3 py-2 text-[11px] text-muted-foreground">Searching…</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-muted-foreground">No files match &ldquo;{query.trim()}&rdquo;.</div>
          ) : (
            results.map((m) => (
              <button
                key={m.path}
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'copy';
                  e.dataTransfer.setData(FILE_MIME, JSON.stringify({ dir: m.root, path: m.path }));
                }}
                className={cn(
                  'flex items-center gap-1.5 w-[calc(100%-8px)] mx-1 my-0.5 px-2 py-1 rounded-sm text-left',
                  'text-[11px] text-muted-foreground hover:text-foreground hover:bg-white/4 border-none bg-transparent cursor-pointer font-inherit',
                  m.path === activePath && 'text-foreground bg-white/8',
                )}
                onClick={() => onOpenFile(m.root, m.path)}
                title={m.path}
              >
                <File size={12} className="shrink-0" />
                <span className="truncate">{m.name}</span>
              </button>
            ))
          )
        ) : projects.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">No folders open</div>
        ) : (
          projects.map((dir) => (
            <FileTree
              key={dir}
              root={{ name: folderName(dir), path: dir, isDir: true }}
              activePath={activePath}
              onOpen={(path) => onOpenFile(dir, path)}
            />
          ))
        )}
      </div>
    </div>
  );
}
