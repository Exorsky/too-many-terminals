import { useSyncExternalStore } from 'react';

export interface HoverCardState<T> {
  value: T;
  x: number;
  y: number;
  /** Opened by a click: stays until `close` (Esc, a click outside, an action). */
  pinned?: boolean;
}

/** How long the card waits after the pointer leaves — long enough to cross
 *  the gap from a terminal line to the card at an unhurried pace. */
const GRACE_MS = 400;

/** One app-wide hover card (a Jira issue, a file path), mounted once and
 *  driven from anywhere. 300ms before it opens — also when a card is already
 *  open and the pointer moves to another target, so sweeping across a column
 *  of links only costs the one it stops on — and a grace on the way out so the
 *  pointer can travel onto the card. A click pins it instead: no wait, and
 *  hovers elsewhere leave it alone until it's closed. */
export function createHoverCard<T>(same: (a: T, b: T) => boolean = Object.is) {
  let card: HoverCardState<T> | null = null;
  let showTimer: ReturnType<typeof setTimeout> | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const emit = () => { for (const l of listeners) l(); };
  const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
  const snapshot = () => card;

  return {
    show(value: T, x: number, y: number): void {
      if (card?.pinned) return;
      clearTimeout(hideTimer);
      clearTimeout(showTimer);
      if (card && same(card.value, value)) return;
      showTimer = setTimeout(() => { card = { value, x, y }; emit(); }, 300);
    },
    hide(): void {
      if (card?.pinned) return;
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => { card = null; emit(); }, GRACE_MS);
    },
    pin(value: T, x: number, y: number): void {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      // Same target: keep the open card's value, so a click on the link
      // under it pins without remounting the preview.
      card = card && same(card.value, value) ? { ...card, pinned: true } : { value, x, y, pinned: true };
      emit();
    },
    close(): void {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      if (!card) return;
      card = null;
      emit();
    },
    /** The card's own hover keeps it open. */
    hold(): void {
      clearTimeout(hideTimer);
    },
    useCard(): HoverCardState<T> | null {
      return useSyncExternalStore(subscribe, snapshot, snapshot);
    },
  };
}
