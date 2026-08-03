import { useCallback, useEffect, useRef, useState } from 'react';
import { AlignLeft, Braces, Check, TriangleAlert } from 'lucide-react';
import * as ipc from '@/lib/ipc';
import { cn } from '@/lib/utils';
import type { Tab } from '@/types';
import Editor, { type EditorHandle } from './Editor';
import Markdown from './Markdown';

// How long to wait after a keystroke before refreshing the Markdown preview —
// parsing on every keystroke would work fine at these file sizes, but there's
// no reason to.
const PREVIEW_DEBOUNCE_MS = 300;

interface FileViewerProps {
  tab: Tab;
  isVisible: boolean;
  onDirtyChange: (tabId: string, dirty: boolean) => void;
}

/** One file tab's content: loads once, then edits live in an `Editor`
 *  (CodeMirror) that stays mounted while the tab is hidden — switching tabs
 *  never re-fetches from disk and drops in-progress edits. Markdown files get
 *  a Source/Preview toggle; everything else is just the editor. Mirrors
 *  Terminal.tsx's "always mounted, display:none when hidden" pattern so
 *  per-tab state (undo history, cursor, dirty text) survives a tab switch. */
export default function FileViewer({ tab, isVisible, onDirtyChange }: FileViewerProps) {
  const path = tab.path!;
  const [content, setContent] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [view, setView] = useState<'source' | 'preview'>('source');
  const [previewText, setPreviewText] = useState('');
  const editorRef = useRef<EditorHandle>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const isMd = /\.mdx?$/i.test(path);

  useEffect(() => {
    let cancelled = false;
    ipc.readFile(path)
      .then((text) => {
        if (cancelled) return;
        setContent(text);
        setPreviewText(text);
      })
      .catch((e) => { if (!cancelled) setLoadError(typeof e === 'string' ? e : 'Could not read this file'); });
    return () => { cancelled = true; clearTimeout(previewTimer.current); };
    // Loads exactly once per tab (path never changes under an existing tab).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const handleChange = useCallback((text: string) => {
    onDirtyChange(tab.id, true);
    if (!isMd) return;
    clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => setPreviewText(text), PREVIEW_DEBOUNCE_MS);
  }, [tab.id, isMd, onDirtyChange]);

  const handleSave = useCallback((text: string) => {
    ipc.writeFile(path, tab.cwd, text)
      .then(() => { setSaveError(null); onDirtyChange(tab.id, false); })
      .catch((e) => setSaveError(typeof e === 'string' ? e : 'Could not save this file'));
  }, [path, tab.cwd, tab.id, onDirtyChange]);

  return (
    <div className="absolute inset-0 flex flex-col bg-background" style={{ display: isVisible ? 'flex' : 'none' }}>
      {content !== null && (
        <div className="flex items-center gap-2 h-7 px-3 shrink-0 border-b border-border text-[10.5px]">
          {saveError ? (
            <span className="flex items-center gap-1 text-destructive"><TriangleAlert size={11} />{saveError}</span>
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
          {isMd && view === 'preview' && (
            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-6 py-5">
              <Markdown source={previewText} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
