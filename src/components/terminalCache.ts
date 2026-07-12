import type { Terminal as XTerm } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import type { WebglAddon } from '@xterm/addon-webgl';
import type { IDisposable } from '@xterm/xterm';

export interface CachedTerminal {
  term: XTerm;
  fitAddon: FitAddon;
  onDataDisposable: IDisposable;
  webglAddon?: WebglAddon;
}

/** xterm instances live here, keyed by tab id, so they survive React
 *  unmounts (hidden tabs keep buffering output). */
export const terminalCache = new Map<string, CachedTerminal>();

/** Output that arrived before the xterm instance was mounted. */
const pendingWrites = new Map<string, Uint8Array[]>();

/** Route pty output to the tab's terminal, buffering if it isn't mounted yet. */
export function writeToTerminal(tabId: string, data: Uint8Array): void {
  const cached = terminalCache.get(tabId);
  if (cached) {
    cached.term.write(data);
  } else {
    const pending = pendingWrites.get(tabId) ?? [];
    pending.push(data);
    pendingWrites.set(tabId, pending);
  }
}

/** Flush buffered output into a freshly created terminal. */
export function flushPendingWrites(tabId: string, term: XTerm): void {
  const buffered = pendingWrites.get(tabId);
  if (!buffered) return;
  for (const data of buffered) term.write(data);
  pendingWrites.delete(tabId);
}

/** Tear down a tab's terminal (on tab close). */
export function disposeTerminal(tabId: string): void {
  const cached = terminalCache.get(tabId);
  if (!cached) return;
  terminalCache.delete(tabId);
  pendingWrites.delete(tabId);
  cached.onDataDisposable.dispose();
  cached.webglAddon?.dispose();
  cached.term.dispose();
}
