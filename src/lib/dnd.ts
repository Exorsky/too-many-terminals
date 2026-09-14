import type { Edge } from './panes';

/** Typed drag payloads. The tab strip's own reorder used bare `text/plain`,
 *  which is why it had to ignore every drag that didn't start inside it: there
 *  was no way to tell one apart from a text selection. A custom type makes a
 *  drop target able to decide from `dataTransfer.types` alone — readable during
 *  `dragover`, where `getData` is blocked — so a tab can be dropped into a pane
 *  it didn't come from. */
export const TAB_MIME = 'application/x-tmt-tab';
/** JSON `{ dir, path }` — a file dragged out of the explorer. */
export const FILE_MIME = 'application/x-tmt-file';

export interface FileDragPayload {
  dir: string;
  path: string;
}

/** True when a drag carries something a pane can accept. */
export function isPaneDrag(types: readonly string[] | DOMStringList): boolean {
  for (const t of Array.from(types)) {
    if (t === TAB_MIME || t === FILE_MIME) return true;
  }
  return false;
}

/** How close to an edge counts as "split that way" — the outer quarter. */
const EDGE = 0.25;

/** Which of a pane's five drop zones a pointer is in: one of the four edges, or
 *  the centre, which means "put it in this pane's strip" rather than split.
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
 *  `splitPane` will actually do with it — open it here as a tab. */
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
