import * as ipc from './ipc';

/** Directory names never worth descending into for a filename search — the
 *  usual dependency/build/vcs folders that would otherwise dominate the scan. */
const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'target', 'dist', 'build', 'out',
  '.next', '.venv', '__pycache__', '.cache',
]);

// ponytail: breadth-first over listDir with a hard cap, no index. Good enough
// for "find a file I remember the name of" in a normal project; upgrade to a
// real index (or a Rust-side walk) if this ever feels slow.
const SCAN_CAP = 4000;

export interface FileMatch {
  name: string;
  path: string;
  /** Which open project folder this match was found under. */
  root: string;
}

/** Finds files whose name contains `query`, breadth-first from each project
 *  root, skipping the usual noisy directories. Bounded by SCAN_CAP entries and
 *  `limit` matches so a huge or pathological tree can't hang the UI. */
export async function searchFiles(roots: string[], query: string, limit = 200): Promise<FileMatch[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const matches: FileMatch[] = [];
  let scanned = 0;
  const queue: Array<{ dir: string; root: string }> = roots.map((root) => ({ dir: root, root }));

  while (queue.length && matches.length < limit && scanned < SCAN_CAP) {
    const { dir, root } = queue.shift()!;
    let entries;
    try {
      entries = await ipc.listDir(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (scanned++ >= SCAN_CAP) break;
      if (entry.isDir) {
        if (!IGNORED_DIRS.has(entry.name)) queue.push({ dir: entry.path, root });
        continue;
      }
      if (entry.name.toLowerCase().includes(q)) {
        matches.push({ name: entry.name, path: entry.path, root });
        if (matches.length >= limit) break;
      }
    }
  }

  return matches;
}
