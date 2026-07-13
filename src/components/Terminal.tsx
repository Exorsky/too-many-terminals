import React, { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import * as ipc from '@/lib/ipc';
import { terminalCache, flushPendingWrites } from './terminalCache';

interface TerminalProps {
  tabId: string;
  isVisible: boolean;
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
        theme: {
          background: '#0c0d10',
          foreground: '#e7e8ec',
          cursor: '#7c9eff',
          selectionBackground: '#2a2f45',
          black: '#0c0d10',
          red: '#ff6b6b',
          green: '#8bd17c',
          yellow: '#f0b357',
          blue: '#7c9eff',
          magenta: '#c792ea',
          cyan: '#6fd4c9',
          white: '#e7e8ec',
          brightBlack: '#666b78',
          brightRed: '#ff6b6b',
          brightGreen: '#8bd17c',
          brightYellow: '#f0b357',
          brightBlue: '#7c9eff',
          brightMagenta: '#c792ea',
          brightCyan: '#6fd4c9',
          brightWhite: '#ffffff',
        },
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

      // Activate WebGL renderer (replaces default DOM renderer). On webviews
      // without solid WebGL2 (WebKitGTK, some WKWebView), the DOM renderer
      // stays active — slower but correct.
      if (!cached.webglAddon) {
        try {
          const webglAddon = new WebglAddon();
          webglAddon.onContextLoss(() => {
            webglAddon.dispose();
            if (cached) cached.webglAddon = undefined;
          });
          term.loadAddon(webglAddon);
          cached.webglAddon = webglAddon;
        } catch {
          // WebGL unavailable — DOM renderer remains active
        }
      }

      attachedRef.current = tabId;
    }

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

  // Toggle cursor blink off for hidden terminals to stop idle GPU repaints
  useEffect(() => {
    const cached = terminalCache.get(tabId);
    if (!cached) return;
    cached.term.options.cursorBlink = isVisible;
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
