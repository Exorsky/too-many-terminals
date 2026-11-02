import { useEffect, useRef, useState } from 'react';
import { FileImage, FileText, Folder } from 'lucide-react';
import * as ipc from '@/lib/ipc';
import type { PathInfo } from '@/lib/ipc';
import { closePathCard, dropPathCard, hidePathCard, holdPathCard, imageType, launches, resolvePath, setPathOpener, usePathCard } from '@/lib/path-links';

type Preview =
  | { kind: 'image'; url: string }
  | { kind: 'text'; lines: string[] }
  | { kind: 'dir'; names: string[]; total: number }
  | { kind: 'note'; text: string };

const TEXT_LINES = 14;
const DIR_NAMES = 8;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** `path` relative to `cwd` when it lives under it — how it was most likely
 *  written — otherwise in full. */
function shown(path: string, cwd: string): string {
  const base = cwd.replace(/[\\/]+$/, '');
  return path.startsWith(base) && /^[\\/]/.test(path.slice(base.length)) ? path.slice(base.length + 1) : path;
}

/** Text opens as a tab; a folder or an image goes to the OS, since the app
 *  has no viewer for either; anything that would run is revealed instead. */
function openInfo(info: PathInfo, cwd: string, onOpenFile: (dir: string, path: string) => void): void {
  if (launches(info.path)) ipc.revealInFileManager(info.path);
  else if (info.isDir || imageType(info.path)) ipc.openWithSystem(info.path);
  else onOpenFile(cwd, info.path);
}

// Explicit size + nowrap: four buttons share 400px, and a label that wraps
// doubles the row and reads as a different font.
const BTN_BASE = 'h-[26px] px-2 rounded-sm text-[11.5px] leading-none whitespace-nowrap cursor-pointer';
const BUTTON = `${BTN_BASE} border border-border-hover bg-transparent text-dim hover:text-foreground`;

/** The one hover card for every file path on screen — terminal output and
 *  transcript code spans. Mounted once by App; `showPathCard` drives it. */
export default function PathCard({ onOpenFile }: {
  /** Open a file as a tab; `dir` is the folder it was named from. */
  onOpenFile: (dir: string, path: string) => void;
}) {
  const card = usePathCard();
  const target = card?.value ?? null;
  const [info, setInfo] = useState<PathInfo | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  const live = useRef(onOpenFile);
  live.current = onOpenFile;
  useEffect(() => {
    setPathOpener((i, cwd) => openInfo(i, cwd, live.current));
    return () => setPathOpener(null);
  }, []);

  // A pinned card closes on Esc or a click outside it. Esc is swallowed in
  // the capture phase: in a Claude terminal it would otherwise interrupt Claude.
  const pinned = !!card?.pinned;
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pinned) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      closePathCard();
    };
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) closePathCard();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onDown, true);
    };
  }, [pinned]);

  useEffect(() => {
    setInfo(null);
    setPreview(null);
    if (!target) return;
    let alive = true;
    let url: string | null = null;
    const set = (p: Preview) => { if (alive) setPreview(p); };
    void (async () => {
      const i = await resolvePath(target.cwd, target.path).catch(() => null);
      if (!alive) return;
      // Nothing there: drop the card, or a pinned one would stay invisible
      // and keep swallowing Esc and hovers.
      if (!i) { dropPathCard(target); return; }
      setInfo(i);
      try {
        const type = imageType(i.path);
        if (i.isDir) {
          const entries = await ipc.listDir(i.path);
          set({ kind: 'dir', names: entries.slice(0, DIR_NAMES).map((e) => (e.isDir ? `${e.name}/` : e.name)), total: entries.length });
        } else if (type) {
          const bytes = await ipc.readFileBytes(i.path);
          url = URL.createObjectURL(new Blob([bytes], { type }));
          if (alive) set({ kind: 'image', url });
          else URL.revokeObjectURL(url);
        } else {
          const text = await ipc.readFile(i.path);
          set({ kind: 'text', lines: text.split(/\r?\n/, TEXT_LINES) });
        }
      } catch (e) {
        set({ kind: 'note', text: String(e) });
      }
    })();
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [target]);

  if (!card || !target || !info) return null;
  const name = info.path.split(/[\\/]/).filter(Boolean).pop() ?? info.path;
  const isImage = !!imageType(info.path);
  const Icon = info.isDir ? Folder : isImage ? FileImage : FileText;
  const left = Math.min(card.x, window.innerWidth - 420);
  const top = Math.min(card.y, window.innerHeight - 340);
  const done = (fn: () => void) => () => { fn(); closePathCard(); };
  const openHint = /Mac/.test(navigator.userAgent) ? '⌘-click opens' : 'Ctrl-click opens';

  return (
    <div
      ref={boxRef}
      role="dialog"
      aria-label={`${name} details`}
      className="fixed z-50 w-[400px] rounded-md border border-border-hover bg-popover p-3 shadow-lg text-[12px]"
      style={{ left, top }}
      onMouseEnter={holdPathCard}
      onMouseLeave={hidePathCard}
    >
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <Icon size={13} className="shrink-0 text-dim" />
        <span className="font-mono text-[12px] text-foreground truncate">{name}{info.isDir ? '/' : ''}</span>
        {!info.isDir && <span className="shrink-0 tabular-nums">{formatSize(info.size)}</span>}
        <span className="ml-auto shrink-0">{pinned ? 'Esc closes' : openHint}</span>
      </div>
      <div className="mt-0.5 mb-2 font-mono text-[11px] text-muted-foreground truncate" title={info.path}>
        {shown(info.path, target.cwd)}
      </div>

      {preview?.kind === 'image' && (
        <img src={preview.url} alt={name} className="block mx-auto max-h-[220px] max-w-full rounded-sm border border-border bg-raised" />
      )}
      {preview?.kind === 'text' && (
        <pre className="m-0 max-h-[210px] overflow-hidden rounded-sm border border-border bg-raised px-2 py-1.5 font-mono text-[11px] leading-[1.45] text-dim whitespace-pre">
          {preview.lines.join('\n')}
        </pre>
      )}
      {preview?.kind === 'dir' && (
        <div className="rounded-sm border border-border bg-raised px-2 py-1.5 font-mono text-[11px] leading-[1.5] text-dim">
          {preview.total === 0 ? <span className="text-muted-foreground">Empty folder</span> : preview.names.map((n) => (
            <div key={n} className="truncate">{n}</div>
          ))}
          {preview.total > preview.names.length && (
            <div className="text-muted-foreground">+{preview.total - preview.names.length} more</div>
          )}
        </div>
      )}
      {preview?.kind === 'note' && <div className="text-muted-foreground">{preview.text}</div>}

      <div className="flex flex-wrap gap-1.5 mt-3">
        <button
          type="button"
          className={`${BTN_BASE} border border-primary/50 bg-primary/12 text-foreground hover:bg-primary/20`}
          onClick={done(() => openInfo(info, target.cwd, onOpenFile))}
        >
          {info.isDir ? 'Open folder' : isImage ? 'Open' : 'Open in tab'}
        </button>
        {!info.isDir && !isImage && !launches(info.path) && (
          <button type="button" className={BUTTON} onClick={done(() => ipc.openWithSystem(info.path))}>
            Open with app
          </button>
        )}
        <button type="button" className={BUTTON} onClick={done(() => ipc.revealInFileManager(info.path))}>
          Show in {ipc.fileManagerName()}
        </button>
        <button type="button" className={BUTTON} onClick={done(() => { void navigator.clipboard.writeText(info.path); })}>
          Copy path
        </button>
      </div>
    </div>
  );
}
