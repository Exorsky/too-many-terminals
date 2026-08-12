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
