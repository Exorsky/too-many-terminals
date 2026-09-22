import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Is there a live text selection inside `root`?
 *
 *  Used to hold off work that would rebuild the DOM under someone's cursor.
 *  WebKit collapses a selection as soon as the nodes it covers are replaced,
 *  which is far stricter than Blink — so a background refresh that Windows
 *  tolerates drops the selection outright on macOS. */
export function hasSelectionIn(root: HTMLElement | null | undefined): boolean {
  if (!root) return false;
  const selection = window.getSelection?.();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
  return root.contains(selection.getRangeAt(0).commonAncestorContainer);
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* The app's recurring button shapes, as class strings rather than a component.
 * Every call site already composes with `cn()` and supplies its own size, so a
 * wrapper would exist only to forward props straight through. What these are
 * for is agreement: one place that decides what a ghost button's hover looks
 * like, instead of fourteen call sites each guessing a white. */

/** Square, centered, icon-only. The call site sets the size (`w-5 h-5`). */
export const ICON_BUTTON =
  'flex items-center justify-center shrink-0 rounded-sm border-none cursor-pointer bg-transparent text-muted-foreground hover:text-foreground hover:bg-raised';

/** Full-width left-aligned action: an inspector's action list, a sidebar row.
 *  The call site sets height, padding and text size. */
export const ACTION_ROW =
  'flex items-center gap-2 w-full shrink-0 rounded-sm border-none cursor-pointer bg-transparent font-inherit text-left text-muted-foreground hover:text-foreground hover:bg-hover';

/** `ACTION_ROW` for something you can't undo. Muted until hovered, so a
 *  Delete sitting at the bottom of a list isn't the loudest thing in it. */
export const ACTION_ROW_DANGER =
  'flex items-center gap-2 w-full shrink-0 rounded-sm border-none cursor-pointer bg-transparent font-inherit text-left text-destructive/85 hover:text-destructive hover:bg-destructive/10';

/** Last path segment of a project directory — the name we show for a folder. */
export function folderName(dir: string): string {
  return dir.split(/[/\\]/).filter(Boolean).pop() ?? dir;
}

/** Up to `levels` ancestor segments immediately above a project folder, for a
 *  breadcrumb shown before its name (e.g. "Desktop / prog" for
 *  ".../Desktop/prog/too-many-terminals") — enough to tell apart folders that
 *  share a name without listing the whole path. Prefixes an ellipsis segment
 *  when there are more ancestors above what's shown; returns '' when there
 *  are none (a folder sitting right off a drive/volume root). */
export function parentPath(dir: string, levels = 2): string {
  const segments = dir.split(/[/\\]/).filter(Boolean);
  const ancestors = segments.slice(0, -1);
  if (ancestors.length === 0) return '';
  const shown = ancestors.slice(-levels);
  const truncated = ancestors.length > shown.length;
  return (truncated ? ['…', ...shown] : shown).join(' / ');
}

/** A bare Escape or Ctrl+C keystroke — Claude Code's own interrupt keys.
 *  Exact-match only: an escape *sequence* (arrow keys, etc.) arrives as
 *  multiple bytes starting with ESC (e.g. `\x1b[A`), not the single byte a
 *  real Escape keypress sends. Used to notice an interrupt Claude Code has no
 *  hook for (its Stop hook explicitly skips firing on user interrupt), since
 *  otherwise a tab's status is stuck at "working" until something else moves
 *  it — see docs/features/tab-status-and-naming.md. */
export function isInterruptKeystroke(data: string): boolean {
  return data === '\x1b' || data === '\x03';
}
