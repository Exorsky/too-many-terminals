/**
 * Git status per folder, shared by every surface that shows it (session rows,
 * the breadcrumb, the file tree). One status per *folder*, not per session —
 * three sessions in one repo cost one `git status`. Refreshed when a surface
 * first asks, when the window regains focus, and when a session in that folder
 * goes quiet (App) — never on a timer of its own. See docs/features/git.md.
 */
import { useEffect, useSyncExternalStore } from 'react';
import * as ipc from './ipc';
import type { GitStatus } from './ipc';

interface Entry {
  status: GitStatus | null;
  at: number;
  inflight: Promise<void> | null;
}

/** A status younger than this is fresh enough to show without asking again. */
const STALE_MS = 15_000;
/** Even a forced refresh waits this long after the last one: a burst of
 *  triggers (focus + idle at once) is still one `git status`. */
const MIN_GAP_MS = 2_000;

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };

/** Ask git again for `dir`, unless it was asked moments ago or is being asked
 *  now. `force` skips the staleness check, not the gap. */
export function refreshGit(dir: string, force = false): Promise<void> {
  const e = entries.get(dir);
  if (e?.inflight) return e.inflight;
  const age = e ? Date.now() - e.at : Infinity;
  if (age < MIN_GAP_MS || (!force && age < STALE_MS)) return Promise.resolve();
  const entry: Entry = e ?? { status: null, at: 0, inflight: null };
  entries.set(dir, entry);
  entry.inflight = Promise.resolve()
    .then(() => ipc.gitStatus(dir))
    .then((status) => status ?? null, () => null)
    .then((status) => {
      entry.status = status;
      entry.at = Date.now();
      entry.inflight = null;
      emit();
    });
  return entry.inflight;
}

/** Every folder anything has asked about — the window came back into focus,
 *  and any of them may have changed meanwhile. */
export function refreshAllGit(): void {
  for (const dir of entries.keys()) void refreshGit(dir, true);
}

if (typeof window !== 'undefined') window.addEventListener('focus', refreshAllGit);

export function getGitStatus(dir: string | null): GitStatus | null {
  return dir ? entries.get(dir)?.status ?? null : null;
}

/** The git status of `dir`, asked for on first use; null outside a repo. */
export function useGitStatus(dir: string | null): GitStatus | null {
  const status = useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => getGitStatus(dir),
    () => getGitStatus(dir),
  );
  useEffect(() => { if (dir) void refreshGit(dir); }, [dir]);
  return status;
}

/** Test-only. */
export function resetGitForTest(): void {
  entries.clear();
}

export interface GitMarks {
  /** Absolute path → one-letter code. */
  files: Map<string, string>;
  /** Folders with a change somewhere below them. */
  dirs: Set<string>;
}

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
const marksCache = new WeakMap<GitStatus, GitMarks>();

/** The status as per-path marks for a file tree, keyed by absolute path with
 *  `/` separators (normalize the tree's paths the same way to look one up). */
export function gitMarks(status: GitStatus): GitMarks {
  const hit = marksCache.get(status);
  if (hit) return hit;
  const root = norm(status.root);
  const marks: GitMarks = { files: new Map(), dirs: new Set() };
  for (const f of status.files) {
    const abs = `${root}/${norm(f.path)}`;
    marks.files.set(abs, f.code);
    // Each parent up to the root gets the "something changed below" dot.
    for (let i = abs.lastIndexOf('/'); i > root.length; i = abs.lastIndexOf('/', i - 1)) {
      marks.dirs.add(abs.slice(0, i));
    }
  }
  marksCache.set(status, marks);
  return marks;
}

export const gitPathKey = norm;
