import { useCallback, useEffect, useRef, useState } from 'react';

/** True while any seam is mid-drag.
 *
 *  Read by `Terminal.tsx` to back off its resize debounce: every pane resize is a
 *  `fitAddon.fit()` + `pty_resize` + a full xterm rewrap of everything on screen,
 *  and a seam drag fires that at pointer rate, times the number of visible panes.
 *  A longer debounce rather than a hard skip, so the trailing call still lands and
 *  nothing needs re-fitting on mouseup.
 *
 *  ponytail: one global flag — two seams can't be dragged at once. */
export let seamDragging = false;

/** Drag-to-resize, generalised out of the split seam and the file-panel seam
 *  (which were the same twenty lines twice).
 *
 *  `compute` turns a pointer position into the value being dragged — a ratio, a
 *  width — and returns null to skip a move (the reference element is gone).
 *  Tracks on `window` rather than the handle, so a fast drag can't outrun the
 *  1px line and drop the gesture.
 *
 *  Returns `[dragging, start]`: spread `dragging` onto the seam for its active
 *  styling and the cursor-locking overlay, and call `start` from `onMouseDown`. */
export function useDragValue(
  compute: (e: MouseEvent) => number | null,
  onChange: (value: number) => void,
): [dragging: boolean, start: () => void] {
  const [dragging, setDragging] = useState(false);
  // Held in refs so the window listeners attach once per drag instead of being
  // torn down and rebuilt every time the parent re-renders mid-drag — which it
  // does on every pointer move, since that's what the drag is changing.
  const computeRef = useRef(compute);
  const changeRef = useRef(onChange);
  computeRef.current = compute;
  changeRef.current = onChange;

  useEffect(() => {
    if (!dragging) return;
    seamDragging = true;
    const onMove = (e: MouseEvent) => {
      const value = computeRef.current(e);
      if (value !== null) changeRef.current(value);
    };
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      seamDragging = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging]);

  return [dragging, useCallback(() => setDragging(true), [])];
}
