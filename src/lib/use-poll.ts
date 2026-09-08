import { useEffect, useRef } from 'react';

/** How often anything on screen re-checks the disk. Slow enough to be free,
 *  fast enough that a file being written next door looks live. */
export const FILE_POLL_MS = 2000;

/** Runs `fn` on an interval, but only while the window has focus. Polling for
 *  a change nobody is looking at is pure waste, and that gate is the one rule
 *  the open file and the expanded folders both have to agree on, so it lives
 *  here once instead of twice.
 *
 *  ponytail: this is polling, not a filesystem watcher, and deliberately so.
 *  A `notify` watcher means a recursive watch per project plus ignore rules for
 *  node_modules/.git/target (this repo's `target` alone is enormous) plus a
 *  debounce, all to learn about changes the UI mostly isn't showing. Re-reading
 *  what *is* on screen costs one directory listing per expanded folder and one
 *  read of one size-capped text file. Upgrade to a watcher the day Files has to
 *  react to something it isn't already displaying. */
export function usePollWhileFocused(fn: () => void, active: boolean, everyMs = FILE_POLL_MS): void {
  // Held in a ref so a caller re-creating the callback each render doesn't
  // restart the interval on every keystroke.
  const latest = useRef(fn);
  latest.current = fn;

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => { if (document.hasFocus()) latest.current(); }, everyMs);
    return () => clearInterval(timer);
  }, [active, everyMs]);
}
