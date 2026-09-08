/**
 * Resolving a Markdown link's target against the file it was written in, so
 * `[architecture](docs/architecture.md)` in a preview can open that file
 * instead of being handed to the OS as a URL.
 *
 * Deliberately separator-agnostic: links are written with `/` even in docs
 * that live at a `C:\…` path, and both halves meet here.
 */

/** A URL scheme (`https:`, `mailto:`) — two letters minimum, so a Windows
 *  drive letter (`C:\…`) reads as a path, not as a scheme. */
const SCHEME_RE = /^[a-z][a-z0-9+.-]+:/i;
const DRIVE_RE = /^[a-z]:[\\/]/i;
const SEP_RE = /[\\/]/;

export function isExternalHref(href: string): boolean {
  return SCHEME_RE.test(href) || href.startsWith('//');
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s; // a stray `%` isn't an escape — leave the text as written
  }
}

/** Splits `docs/a.md#anchor` into its path and its anchor, percent-decoding
 *  both so `a%20b.md` still names `a b.md`. */
export function splitHref(href: string): { path: string; anchor: string } {
  const hash = href.indexOf('#');
  return {
    path: decode(hash === -1 ? href : href.slice(0, hash)),
    anchor: hash === -1 ? '' : decode(href.slice(hash + 1)),
  };
}

/** Joins a relative target to the directory of the file it appears in,
 *  collapsing `.` and `..`. An absolute target (POSIX root or drive letter) is
 *  normalized but otherwise taken as-is. Never climbs above the root. */
export function resolveFrom(fromFile: string, target: string): string {
  const sep = fromFile.includes('\\') ? '\\' : '/';
  let parts: string[];
  let rest = target;
  if (DRIVE_RE.test(target)) {
    parts = [target.slice(0, 2)];
    rest = target.slice(2);
  } else if (SEP_RE.test(target[0] ?? '')) {
    parts = ['']; // POSIX root: join() puts the leading sep back
  } else {
    parts = fromFile.split(SEP_RE).slice(0, -1);
  }

  for (const seg of rest.split(SEP_RE)) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length > 1) parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.join(sep);
}
