import { useCallback, useEffect, useRef, useState } from 'react';
import { AlignLeft, Braces, Check, TriangleAlert } from 'lucide-react';
import * as ipc from '@/lib/ipc';
import { resolveFrom, splitHref } from '@/lib/paths';
import { usePollWhileFocused } from '@/lib/use-poll';
import { cn } from '@/lib/utils';
import type { Tab } from '@/types';
import Editor, { type EditorHandle } from './Editor';
import FindBar from './FindBar';
import Markdown from './Markdown';

// How long to wait after a keystroke before refreshing the Markdown preview —
// parsing on every keystroke would work fine at these file sizes, but there's
// no reason to.
const PREVIEW_DEBOUNCE_MS = 300;

type MdView = 'source' | 'preview';

// Which half you were last on, remembered across tabs and restarts: docs are
// read far more often than they're edited, and re-clicking Preview for every
// file was the whole complaint.
const VIEW_KEY = 'md-view';
function rememberedView(): MdView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'preview' ? 'preview' : 'source';
  } catch {
    return 'source'; // storage disabled — the default is fine
  }
}

interface FileViewerProps {
  tab: Tab;
  isVisible: boolean;
  onDirtyChange: (tabId: string, dirty: boolean) => void;
  /** Opens a file the preview linked to, as a tab — same call the explorer makes. */
  onOpenFile?: (dir: string, path: string) => void;
}

/** One file tab's content: loads once, then edits live in an `Editor`
 *  (CodeMirror) that stays mounted while the tab is hidden — switching tabs
 *  never re-fetches from disk and drops in-progress edits. Markdown files get
 *  a Source/Preview toggle; everything else is just the editor. Mirrors
 *  Terminal.tsx's "always mounted, display:none when hidden" pattern so
 *  per-tab state (undo history, cursor, dirty text) survives a tab switch. */
export default function FileViewer({ tab, isVisible, onDirtyChange, onOpenFile }: FileViewerProps) {
  const path = tab.path!;
  const [content, setContent] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** The file changed on disk while this tab had unsaved edits, so it was left
   *  alone. Never overwrite typing to win a race with another writer. */
  const [staleOnDisk, setStaleOnDisk] = useState(false);
  /** Last text known to be on disk, so a poll can tell a real change from the
   *  same bytes read again — including the ones this tab just saved. */
  const onDisk = useRef<string | null>(null);
  const [view, setViewState] = useState<MdView>(rememberedView);
  const [previewText, setPreviewText] = useState('');
  const editorRef = useRef<EditorHandle>(null);
  const previewScrollRef = useRef<HTMLDivElement>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** Latest text typed into the editor, kept even while the preview is off
   *  screen so switching to it doesn't show a stale document. */
  const typed = useRef<string | null>(null);
  const isMd = /\.mdx?$/i.test(path);

  const setView = useCallback((v: MdView) => {
    setViewState(v);
    // Edits made while the preview was off screen weren't rendered; catch up.
    if (v === 'preview' && typed.current !== null) setPreviewText(typed.current);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* storage disabled — this session only */ }
  }, []);

  // Ctrl/Cmd+Shift+V flips the two halves. Only bound while this file tab is
  // the one on screen, so it never shadows the terminal's own paste chord.
  useEffect(() => {
    if (!isMd || !isVisible) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'V' || e.key === 'v')) {
        e.preventDefault();
        setView(view === 'preview' ? 'source' : 'preview');
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [isMd, isVisible, view, setView]);

  /** A link in the preview that names a file opens it as a tab, resolved
   *  against the file the link was written in — the point being never to go
   *  hunting for it in the explorer. */
  const openLink = useCallback((href: string) => {
    const { path: target } = splitHref(href);
    if (target) onOpenFile?.(tab.cwd, resolveFrom(path, target));
  }, [onOpenFile, tab.cwd, path]);

  useEffect(() => {
    let cancelled = false;
    ipc.readFile(path)
      .then((text) => {
        if (cancelled) return;
        onDisk.current = text;
        setContent(text);
        setPreviewText(text);
      })
      .catch((e) => { if (!cancelled) setLoadError(typeof e === 'string' ? e : 'Could not read this file'); });
    return () => { cancelled = true; clearTimeout(previewTimer.current); };
    // Loads exactly once per tab (path never changes under an existing tab).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  /** Takes whatever is on disk now. Called by the poll when there is nothing
   *  to lose, and by the Reload button when there is and you said so. */
  const adoptFromDisk = useCallback((text: string) => {
    onDisk.current = text;
    setContent(text);
    setPreviewText(text);
    typed.current = text;
    setStaleOnDisk(false);
    editorRef.current?.replaceText(text);
    onDirtyChange(tab.id, false);
  }, [tab.id, onDirtyChange]);

  // A file open in a tab is usually a file some session in the next pane is
  // busy rewriting. Re-read it while it is on screen so it updates in place,
  // instead of having to close the tab and open it again.
  usePollWhileFocused(() => {
    ipc.readFile(path)
      .then((text) => {
        if (text === onDisk.current) return;
        onDisk.current = text;
        // Unsaved edits outrank the disk: say so and let the choice be made.
        if (tab.dirty) { setStaleOnDisk(true); return; }
        setContent(text);
        setPreviewText(text);
        typed.current = text;
        editorRef.current?.replaceText(text);
      })
      .catch(() => {});
  }, isVisible && content !== null);

  const handleChange = useCallback((text: string) => {
    onDirtyChange(tab.id, true);
    if (!isMd) return;
    typed.current = text;
    if (view === 'source') return; // nothing is looking at the preview — don't re-render it
    clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => setPreviewText(text), PREVIEW_DEBOUNCE_MS);
  }, [tab.id, isMd, view, onDirtyChange]);

  const handleSave = useCallback((text: string) => {
    ipc.writeFile(path, tab.cwd, text)
      .then(() => {
        onDisk.current = text;
        setStaleOnDisk(false);
        setSaveError(null);
        onDirtyChange(tab.id, false);
      })
      .catch((e) => setSaveError(typeof e === 'string' ? e : 'Could not save this file'));
  }, [path, tab.cwd, tab.id, onDirtyChange]);

  return (
    <div className="absolute inset-0 flex flex-col bg-background" style={{ display: isVisible ? 'flex' : 'none' }}>
      {content !== null && (
        <div className="flex items-center gap-2 h-7 px-3 shrink-0 border-b border-border text-[10.5px]">
          {saveError ? (
            <span className="flex items-center gap-1 text-destructive"><TriangleAlert size={11} />{saveError}</span>
          ) : staleOnDisk ? (
            <span className="flex items-center gap-1.5 text-warning">
              <TriangleAlert size={11} />
              Changed on disk, and you have unsaved edits
              <button
                type="button"
                className="px-1.5 py-px rounded-sm border border-warning/50 bg-transparent text-warning hover:bg-warning/10 cursor-pointer font-inherit text-[10.5px]"
                onClick={() => { ipc.readFile(path).then(adoptFromDisk).catch(() => {}); }}
              >
                Load the file
              </button>
              <span className="text-muted-foreground">or Ctrl+S to keep yours</span>
            </span>
          ) : tab.dirty ? (
            <span className="text-muted-foreground">Unsaved changes · Ctrl+S to save</span>
          ) : (
            <span className="flex items-center gap-1 text-muted-foreground"><Check size={11} className="text-success" />Saved</span>
          )}
          {isMd && (
            <div className="ml-auto flex items-center gap-0.5 p-0.5 rounded-md border border-border bg-card">
              {(['source', 'preview'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={cn(
                    'inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-[5px] cursor-pointer font-inherit transition-colors',
                    view === v ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {v === 'source' ? <Braces size={12} /> : <AlignLeft size={12} />}
                  {v === 'source' ? 'Source' : 'Preview'}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {loadError && (
        <div className="flex-1 min-h-0 flex items-center justify-center px-6 text-center text-[12px] text-muted-foreground">
          {loadError}
        </div>
      )}
      {content === null && !loadError && (
        <div className="flex-1 min-h-0 flex items-center justify-center text-[12px] text-muted-foreground">
          Loading…
        </div>
      )}
      {content !== null && (
        <>
          <div className={cn('flex flex-col flex-1 min-h-0', isMd && view === 'preview' && 'hidden')}>
            <Editor ref={editorRef} path={path} initialText={content} onChange={handleChange} onSave={handleSave} />
          </div>
          {/* Stays mounted once shown, so flipping back to Source and returning
              lands where you were reading instead of at the top. */}
          {isMd && (
            <div className={cn('relative flex flex-col flex-1 min-h-0', view === 'source' && 'hidden')}>
              {isVisible && view === 'preview' && <FindBar scrollRef={previewScrollRef} />}
              <div ref={previewScrollRef} className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-6 py-5">
                <div className="mx-auto max-w-[76ch]">
                  <Markdown source={previewText} onOpenLink={openLink} />
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
