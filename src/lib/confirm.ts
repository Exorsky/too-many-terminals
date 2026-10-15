/**
 * One confirmation dialog for every action that destroys something — closing
 * a session, deleting a transcript, a task or a theme, removing a project.
 *
 * `confirmAction` is a promise so a call site reads as the sentence it is
 * ("if the user confirms, delete it") instead of threading open/confirm state
 * through every component that has a Delete. `ConfirmDialog` renders whatever
 * is pending; App mounts it once.
 */
import { useSyncExternalStore } from 'react';

export interface ConfirmRequest {
  /** The question, naming the thing: `Close "API refactor"?` */
  title: string;
  /** What happens, and what survives — the reason to read before clicking. */
  body?: string;
  /** The verb on the button, same as the menu item that asked: "Delete". */
  confirmLabel: string;
}

type Pending = ConfirmRequest & { resolve: (ok: boolean) => void };

let pending: Pending | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function confirmAction(request: ConfirmRequest): Promise<boolean> {
  // A second request while one is open answers the first with "no" — the
  // newer question is the one on screen.
  pending?.resolve(false);
  return new Promise((resolve) => {
    pending = { ...request, resolve };
    emit();
  });
}

export function settleConfirm(ok: boolean): void {
  const current = pending;
  pending = null;
  emit();
  current?.resolve(ok);
}

export function usePendingConfirm(): ConfirmRequest | null {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => pending,
  );
}
