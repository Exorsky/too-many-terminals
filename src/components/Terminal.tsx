import React, { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import * as ipc from '@/lib/ipc';
import { getActiveXtermTheme } from '@/lib/themes';
import { terminalCache, flushPendingWrites, type CachedTerminal } from './terminalCache';

interface TerminalProps {
  tabId: string;
  isVisible: boolean;
}

/** Activate the WebGL renderer on an already-open terminal (no-op if it's
 *  already on, or if WebGL2 is unavailable — the DOM renderer stays active).
 *  Called both on first attach and whenever a hidden tab is shown again, since
 *  the context is released while hidden. */
function ensureWebgl(cached: CachedTerminal): void {
  if (cached.webglAddon) return;
  try {
    const webglAddon = new WebglAddon();
    webglAddon.onContextLoss(() => {
      webglAddon.dispose();
      cached.webglAddon = undefined;
    });
    cached.term.loadAddon(webglAddon);
    cached.webglAddon = webglAddon;
  } catch {
    // WebGL unavailable — DOM renderer remains active
  }
}

const Terminal = React.memo(function Terminal({ tabId, isVisible }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const attachedRef = useRef<string | null>(null);

  useEffect(() => {
    // Create terminal and register in cache on mount, even for hidden tabs,
    // so PTY data is buffered by xterm (not dropped) while the tab is hidden.
    let cached = terminalCache.get(tabId);
    if (!cached) {
      const term = new XTerm({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: "'Cascadia Code', 'Consolas', monospace",
        scrollback: 5000,
        theme: getActiveXtermTheme(),
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(new WebLinksAddon((_event, uri) => {
        ipc.openExternal(uri);
      }));

      // Ctrl+V / Ctrl+Shift+V: paste from clipboard into terminal.
      // Without this, xterm sends \x16 (literal-next) to the PTY.
      term.attachCustomKeyEventHandler((e) => {
        if (e.ctrlKey && e.key === 'v' && e.type === 'keydown') {
          e.preventDefault();
          navigator.clipboard.readText().then((text) => {
            if (text) term.paste(text);
          });
          return false;
        }
        return true;
      });

      // Forward keyboard input to PTY
      const onDataDisposable = term.onData((data) => {
        ipc.writeToPty(tabId, data);
      });

      cached = { term, fitAddon, onDataDisposable };
      terminalCache.set(tabId, cached);

      flushPendingWrites(tabId, term);
    }

    if (!containerRef.current || !isVisible) return;

    const container = containerRef.current;
    const { term, fitAddon } = cached;

    // Helper: fit terminal and sync PTY dimensions
    const fitAndSync = () => {
      fitAddon.fit();
      if (term.cols > 0 && term.rows > 0) {
        ipc.resizePty(tabId, term.cols, term.rows);
      }
    };

    // If already attached to this container, just fit and observe resize
    const alreadyAttached =
      attachedRef.current === tabId && container.querySelector('.xterm');

    if (!alreadyAttached) {
      container.innerHTML = '';
      term.open(container);
      attachedRef.current = tabId;
    }

    // Activate WebGL now the terminal is visible — on first attach and on every
    // re-show, since the context is released while the tab is hidden (below).
    ensureWebgl(cached);

    // Defer initial fit to next frame so the container has final layout dimensions
    const rafId = requestAnimationFrame(() => {
      fitAndSync();
      term.focus();
    });

    // Handle resize — observe container and refit
    let resizeTimeout: ReturnType<typeof setTimeout>;
    const resizeObserver = new ResizeObserver(() => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(fitAndSync, 50);
    });
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(resizeTimeout);
      resizeObserver.disconnect();
    };
  }, [tabId, isVisible]);

  // Housekeeping for hidden terminals: stop idle cursor repaints, and release
  // the WebGL context. Webviews cap the number of live WebGL2 contexts, so many
  // open tabs each holding one would exhaust them and force the whole app onto
  // the slow DOM renderer. The attach effect re-activates WebGL on re-show.
  useEffect(() => {
    const cached = terminalCache.get(tabId);
    if (!cached) return;
    cached.term.options.cursorBlink = isVisible;
    if (!isVisible && cached.webglAddon) {
      cached.webglAddon.dispose();
      cached.webglAddon = undefined;
    }
  }, [tabId, isVisible]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{ display: isVisible ? 'block' : 'none' }}
    />
  );
});

export default Terminal;
