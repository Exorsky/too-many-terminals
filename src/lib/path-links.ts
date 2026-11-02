/**
 * File and folder paths named in terminal output and transcripts: one
 * detector, a short-lived existence cache, and the hover card's store.
 * See docs/features/path-links.md.
 */
import { searchFiles } from './file-search';
import { createHoverCard } from './hover-card';
import * as ipc from './ipc';
import type { PathInfo } from './ipc';

export interface PathMatch {
  /** The path as written, without a `:line:col` suffix. */
  path: string;
  index: number;
  /** Characters to underline — the path plus its `:line:col`, if any. */
  length: number;
}

// A token that could be a path: an optional root (`C:\`, `~/`, `./`, `../`,
// `/`), then name segments joined by `/` or `\`, then an optional
// `:line(:col)`. The leading group is a boundary (no lookbehind — older
// WebKitGTK lacks it); it refuses `/` and `:` so the middle of a URL never
// starts a match.
const PATH_RE = /(^|[^\w./\\~:@+-])((?:[A-Za-z]:[\\/]|~[\\/]|\.{1,2}[\\/]|[\\/])?[\w@+.-]+(?:[\\/][\w@+.-]+)*[\\/]?)(:\d+(?::\d+)?)?/g;
const SEP_RE = /[\\/]/;
/** `name.ext` with a letter-led extension: `package.json` yes, `v0.29.0` no. */
const EXT_RE = /[^\\/.]\.[A-Za-z]\w{0,9}$/;
const MAX_PER_LINE = 20;
/** Quoted text — the one way a path with spaces (`C:\Program Files\…`,
 *  `OneDrive - Company`) survives in plain output. */
const QUOTED_RE = /(["'`])([^"'`\r\n]{3,260}?)\1/g;
const LINE_SUFFIX_RE = /:\d+(?::\d+)?$/;

/** A path with spaces in it, if `text` could be one: a separator, a letter,
 *  no URL, no padding. Shape only, like everything here. */
function spacedPath(text: string): string | null {
  const path = text.replace(LINE_SUFFIX_RE, '');
  if (!/\s/.test(path) || /^\s|\s$/.test(path) || /^[a-z][a-z0-9+.-]+:\/\//i.test(path)) return null;
  return SEP_RE.test(path) && /[A-Za-z]/.test(path) ? path : null;
}

/** Everything in `text` shaped like a path. Shape only — most of these won't
 *  exist (`and/or`, `example.com`), so callers ask `statPaths` before
 *  showing anything. Quoted paths with spaces come alongside the plain scan,
 *  which may also match pieces of them: after the existence check,
 *  `outermost` keeps the longest. */
export function findPaths(text: string): PathMatch[] {
  const out: PathMatch[] = [];
  for (const m of text.matchAll(QUOTED_RE)) {
    const path = spacedPath(m[2]);
    if (path) out.push({ path, index: m.index + 1, length: m[2].length });
  }
  for (const m of text.matchAll(PATH_RE)) {
    const raw = m[2];
    const path = raw.replace(/[.-]+$/, ''); // the full stop ending a sentence
    if (!/[A-Za-z]/.test(path) || !(SEP_RE.test(path) || EXT_RE.test(path))) continue;
    const suffix = path === raw ? (m[3] ?? '') : '';
    out.push({ path, index: m.index + m[1].length, length: path.length + suffix.length });
  }
  return out.sort((a, b) => a.index - b.index).slice(0, MAX_PER_LINE);
}

/** Drops a match that lies inside a longer one — `Smith/a.txt` inside
 *  `C:\Users\John Smith\a.txt`. Run on matches that exist, so an
 *  apostrophe pairing up with a later quote can't hide a real path. */
export function outermost(matches: PathMatch[]): PathMatch[] {
  return matches.filter((m) => !matches.some((n) => n !== m && n.length > m.length
    && n.index <= m.index && n.index + n.length >= m.index + m.length));
}

/** The path when `text` is nothing but one (a code span like `src/app.ts:12`,
 *  or `C:\Users\John Smith\notes.md` — a code span is its own quoting). */
export function wholePath(text: string): string | null {
  const t = text.trim();
  const [m] = findPaths(t);
  if (m && m.index === 0 && m.length === t.length) return m.path;
  return /[`"'\r\n]/.test(t) ? null : spacedPath(t);
}

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif',
};

/** The MIME type when `path` is an image the webview can draw. */
export function imageType(path: string): string | null {
  return IMAGE_TYPES[/\.(\w+)$/.exec(path)?.[1].toLowerCase() ?? ''] ?? null;
}

/** Things the OS runs rather than shows when "opened": an `.app` is a
 *  folder to `stat`, and a `.command` opens a shell. One click on a path in
 *  someone's output must never launch it — these are only ever revealed. */
const LAUNCHES_RE = /\.(app|command|tool|terminal|workflow|scpt|exe|bat|cmd|com|msi|scr|lnk|vbs|ps1|jar)$/i;

export function launches(path: string): boolean {
  return LAUNCHES_RE.test(path.replace(/[\\/]+$/, ''));
}

// --- existence ----------------------------------------------------------

const TTL_MS = 10_000;
const known = new Map<string, { info: PathInfo | null; at: number }>();

/** `ipc.statPaths`, remembered for ten seconds per (cwd, path): the terminal
 *  asks again for every line the pointer crosses, and a file Claude just
 *  wrote should start linking soon after. */
export async function statPaths(cwd: string, paths: string[]): Promise<(PathInfo | null)[]> {
  const now = Date.now();
  const key = (p: string) => `${cwd}\0${p}`;
  const stale = [...new Set(paths)].filter((p) => {
    const k = known.get(key(p));
    return !k || now - k.at > TTL_MS;
  });
  if (stale.length) {
    if (known.size > 5000) known.clear(); // ponytail: wholesale reset, an LRU if it ever matters
    const got = await ipc.statPaths(cwd, stale);
    stale.forEach((p, i) => known.set(key(p), { info: got[i] ?? null, at: now }));
  }
  return paths.map((p) => known.get(key(p))?.info ?? null);
}

const byName = new Map<string, { info: Promise<PathInfo | null>; at: number }>();
let home: Promise<string> | null = null;

/** One path, the way a card or a click needs it. A bare file name that isn't
 *  in `cwd` itself — Claude often writes `path-links.md` for
 *  `docs/features/path-links.md` — falls back to the shallowest file of
 *  exactly that name under `cwd`. That walk (`searchFiles`, capped) is
 *  remembered for a minute; only a hover or a click ever starts one, never
 *  the terminal's per-line scan. */
export async function resolvePath(cwd: string, path: string): Promise<PathInfo | null> {
  const [info] = await statPaths(cwd, [path]);
  if (info || SEP_RE.test(path) || !EXT_RE.test(path)) return info;
  const key = `${cwd}\0${path}`;
  const hit = byName.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.info;
  // The promise is cached, not the answer: the code span and the card both
  // ask on the same hover, and must share one walk.
  const found = (async () => {
    // Not from home: that walk is all of ~, and on macOS reaching into
    // Documents or Library raises privacy prompts.
    home ??= ipc.homeDir().catch(() => '');
    if (cwd.replace(/[\\/]+$/, '') === (await home).replace(/[\\/]+$/, '')) return null;
    const [match] = await searchFiles([cwd], path, 1, true);
    return match ? (await statPaths(cwd, [match.path]))[0] : null;
  })();
  byName.set(key, { info: found, at: Date.now() });
  return found;
}

// --- the hover card -----------------------------------------------------

/** A path as written, and the directory it was written relative to. */
export interface PathTarget {
  cwd: string;
  path: string;
}

const pathCard = createHoverCard<PathTarget>((a, b) => a.cwd === b.cwd && a.path === b.path);
export const showPathCard = pathCard.show;
export const hidePathCard = pathCard.hide;
export const holdPathCard = pathCard.hold;
export const pinPathCard = pathCard.pin;
export const closePathCard = pathCard.close;
export const usePathCard = pathCard.useCard;

type Opener = (info: PathInfo, cwd: string) => void;
let opener: Opener | null = null;

/** Set by the mounted `PathCard`, which knows how App opens a file. */
export function setPathOpener(fn: Opener | null): void {
  opener = fn;
}

/** A click on a path. ⌘-click (Ctrl-click off macOS) opens it, the way VS
 *  Code's terminal does; a plain click only pins its card, so reading output
 *  never opens tabs by accident. */
export function clickPathLink(target: PathTarget, e: MouseEvent, x: number, y: number): void {
  if (e.metaKey || e.ctrlKey) { closePathCard(); void openPathLink(target); }
  else pinPathCard(target, x, y);
}

/** Opens a path if it's there. */
export async function openPathLink({ cwd, path }: PathTarget): Promise<void> {
  const info = await resolvePath(cwd, path);
  if (info) opener?.(info, cwd);
}
