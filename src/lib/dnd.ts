import type { Edge } from './panes';

/** Typed drag payloads. A custom type lets a drop target decide from
 *  `dataTransfer.types` alone — readable during `dragover`, where `getData` is
 *  blocked — so a session dragged out of the sidebar can be told apart from a
 *  text selection without inspecting the payload. */
export const TAB_MIME = 'application/x-tmt-tab';
/** JSON `{ sessionId, tool }` — a session's Claude/Shell/Files view, dragged
 *  from the workspace's own tool strip so it can be dropped into a pane of its
 *  own. A bare `TAB_MIME` means the session's Claude view, which is what the
 *  sidebar's rows send. */
export const VIEW_MIME = 'application/x-tmt-view';

export interface ViewDragPayload {
  sessionId: string;
  tool: 'claude' | 'shell' | 'files';
}
/** JSON `{ dir, path }` — a file dragged out of the explorer. */
export const FILE_MIME = 'application/x-tmt-file';

export interface FileDragPayload {
  dir: string;
  path: string;
}

/** True when a drag carries something a pane can accept. */
export function isPaneDrag(types: readonly string[] | DOMStringList): boolean {
  for (const t of Array.from(types)) {
    if (t === TAB_MIME || t === VIEW_MIME || t === FILE_MIME) return true;
  }
  return false;
}

/** How close to an edge counts as "split that way" — the outer quarter. */
const EDGE = 0.25;

/** Which of a pane's five drop zones a pointer is in: one of the four edges, or
 *  the centre, which means "show it in this pane" rather than split it.
 *
 *  Nearest edge wins, so a corner resolves to whichever edge it's actually
 *  closer to instead of to whichever was tested first. A degenerate rect can't
 *  divide by zero, and reads as centre. */
export function dropZone(point: { clientX: number; clientY: number }, rect: DOMRect | { left: number; top: number; width: number; height: number }): Edge | 'center' {
  const x = (point.clientX - rect.left) / (rect.width || 1);
  const y = (point.clientY - rect.top) / (rect.height || 1);
  const distances: [Edge, number][] = [
    ['left', x],
    ['right', 1 - x],
    ['top', y],
    ['bottom', 1 - y],
  ];
  distances.sort((a, b) => a[1] - b[1]);
  const [edge, distance] = distances[0];
  return distance < EDGE ? edge : 'center';
}

/** Where the drop highlight should sit: the literal shape the pane becomes.
 *  A split with no room in that axis shows the whole pane, because that's what
 *  `splitPane` will actually do with it — show it here instead. */
export function zoneRect(
  zone: Edge | 'center',
  canSplit: { vertical: boolean; horizontal: boolean },
): { left?: number | string; right?: number | string; top?: number | string; bottom?: number | string; width?: string; height?: string } {
  const whole = { left: 0, right: 0, top: 0, bottom: 0 };
  if (zone === 'center') return whole;
  const vertical = zone === 'left' || zone === 'right';
  if (vertical ? !canSplit.vertical : !canSplit.horizontal) return whole;
  if (zone === 'left') return { left: 0, top: 0, bottom: 0, width: '50%' };
  if (zone === 'right') return { right: 0, top: 0, bottom: 0, width: '50%' };
  if (zone === 'top') return { top: 0, left: 0, right: 0, height: '50%' };
  return { bottom: 0, left: 0, right: 0, height: '50%' };
}
