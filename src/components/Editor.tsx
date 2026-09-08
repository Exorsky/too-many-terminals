import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Prec } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { LanguageDescription, type LanguageSupport } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { oneDark } from '@codemirror/theme-one-dark';

export interface EditorHandle {
  /** Writes the file with the editor's current contents (Ctrl+S's own path). */
  save: () => void;
  /** Swaps in text that came from disk rather than from typing — used when the
   *  file is rewritten underneath an open tab. Keeps the view where it is
   *  (no `scrollIntoView`) and does not report the change back as an edit, so
   *  watching a session rewrite a file doesn't mark the tab dirty. */
  replaceText: (text: string) => void;
}

interface EditorProps {
  path: string;
  initialText: string;
  /** Fired on every edit with the full current text — cheap enough for a
   *  dirty flag; callers that need it for something heavier (a preview) should
   *  debounce on their end. */
  onChange: (text: string) => void;
  onSave: (text: string) => void;
}

/** A CodeMirror 6 instance for one file, created once per `path` and mounted
 *  imperatively — the same "create once, hold in a ref" pattern Terminal.tsx
 *  uses for xterm. Language support loads asynchronously by filename via
 *  @codemirror/language-data, so opening a .py or .go file highlights it
 *  without listing every language by hand. */
const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(
  { path, initialText, onChange, onSave },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  /** Set while a dispatch comes from disk, so the update listener can tell it
   *  apart from a keystroke. Dispatch is synchronous, so a plain flag is
   *  enough — no annotation plumbing needed. */
  const fromDisk = useRef(false);

  useImperativeHandle(ref, () => ({
    save: () => {
      const view = viewRef.current;
      if (view) onSaveRef.current(view.state.doc.toString());
    },
    replaceText: (text: string) => {
      const view = viewRef.current;
      if (!view || view.state.doc.toString() === text) return;
      // Clamp the caret rather than dropping it: the file usually grew or
      // shrank somewhere else entirely, and losing your place on every write
      // would make watching a file edited live unusable.
      const head = Math.min(view.state.selection.main.head, text.length);
      fromDisk.current = true;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: head },
      });
      fromDisk.current = false;
    },
  }), []);

  useEffect(() => {
    let cancelled = false;
    const filename = path.split(/[/\\]/).pop() ?? path;
    const desc = LanguageDescription.matchFilename(languages, filename);

    const build = (langExtension: LanguageSupport | null) => {
      if (cancelled || !hostRef.current) return;
      const view = new EditorView({
        parent: hostRef.current,
        state: EditorState.create({
          doc: initialText,
          extensions: [
            basicSetup,
            oneDark,
            ...(langExtension ? [langExtension] : []),
            Prec.highest(keymap.of([{
              key: 'Mod-s',
              run: (v) => { onSaveRef.current(v.state.doc.toString()); return true; },
            }])),
            EditorView.updateListener.of((update) => {
              if (update.docChanged && !fromDisk.current) onChangeRef.current(update.state.doc.toString());
            }),
          ],
        }),
      });
      viewRef.current = view;
    };

    if (desc) {
      desc.load().then((support) => build(support)).catch(() => build(null));
    } else {
      build(null);
    }

    return () => {
      cancelled = true;
      viewRef.current?.destroy();
      viewRef.current = null;
    };
    // A new CodeMirror instance per file, not per re-render — initialText is
    // only the seed, subsequent edits live in the view's own state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  return <div ref={hostRef} className="flex-1 min-h-0 overflow-auto text-[12.5px] [&_.cm-editor]:h-full [&_.cm-editor]:outline-none" />;
});

export default Editor;
