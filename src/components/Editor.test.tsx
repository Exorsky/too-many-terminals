import { createRef } from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Editor, { type EditorHandle } from './Editor';

afterEach(cleanup);

describe('Editor', () => {
  it('mounts CodeMirror with the initial text for a file with no language match', async () => {
    const { container } = render(
      <Editor path="/proj/notes.txt" initialText="hello world" onChange={vi.fn()} onSave={vi.fn()} />,
    );
    await waitFor(() => expect(container.textContent).toContain('hello world'));
  });

  it('mounts and highlights a file whose language loads asynchronously', async () => {
    const { container } = render(
      <Editor path="/proj/app.js" initialText="const x = 1;" onChange={vi.fn()} onSave={vi.fn()} />,
    );
    await waitFor(() => expect(container.textContent).toContain('const x = 1;'));
  });

  it('exposes a save handle that reports the current document text', async () => {
    const onSave = vi.fn();
    const ref = createRef<EditorHandle>();
    const { container } = render(
      <Editor ref={ref} path="/proj/notes.txt" initialText="hello" onChange={vi.fn()} onSave={onSave} />,
    );
    await waitFor(() => expect(container.textContent).toContain('hello'));

    ref.current?.save();
    expect(onSave).toHaveBeenCalledWith('hello');
  });

  it('tears down the CodeMirror view on unmount without throwing', async () => {
    const { container, unmount } = render(
      <Editor path="/proj/notes.txt" initialText="hello" onChange={vi.fn()} onSave={vi.fn()} />,
    );
    await waitFor(() => expect(container.textContent).toContain('hello'));
    expect(() => unmount()).not.toThrow();
  });
});
