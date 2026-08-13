import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

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
