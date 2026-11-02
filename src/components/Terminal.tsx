import React, { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import * as ipc from '@/lib/ipc';
import type { PathInfo } from '@/lib/ipc';
import { findIssueKeys, hideIssueCard, issueUrl, jiraOn, showIssueCard } from '@/lib/jira';
import { clickPathLink, findPaths, hidePathCard, knownPaths, outermost, showPathCard, statPaths } from '@/lib/path-links';
import { getSettings } from '@/lib/settings-store';
import { getActiveXtermTheme, terminalContrast } from '@/lib/themes';
import { isInterruptKeystroke } from '@/lib/utils';
import { seamDragging } from '@/lib/use-drag-value';
import { terminalCache, flushPendingWrites, type CachedTerminal } from './terminalCache';

interface TerminalProps {
  tabId: string;
  isVisible: boolean;
  /** True only for the visible tab of the *focused* pane. With up to four
   *  terminals on screen, an unconditional `term.focus()` on every attach turns
   *  into a focus fight where the last pane to render steals the keyboard. */
  focused?: boolean;
  /** Called on a bare Escape/Ctrl+C keystroke — Claude Code's own Stop hook
   *  doesn't fire on a user interrupt, so this is the only signal the app
   *  gets that a "working" tab may actually be sitting idle. The caller
   *  decides whether that's worth acting on (only meaningful for a claude
   *  tab currently marked working). */
  onInterrupt?: () => void;
  /** The session's directory — relative paths in the output resolve from it.
   *  Read when the terminal is first created. Claude's cwd never moves; a
   *  shell's does after `cd`, and its relative paths still resolve from here
   *  (see docs/features/path-links.md). */
  cwd?: string;
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

const Terminal = React.memo(function Terminal({ tabId, isVisible, focused = true, onInterrupt, cwd }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // The container this terminal's DOM currently lives in. Invalidated by a new
  // container (the component remounted somewhere else) *and* by a new `tabId`
  // on the same container — the workspace renders one <Terminal> and swaps its
  // tabId as you switch sessions, so the node under it stays put while the
  // terminal that belongs in it changes.
  const attachedRef = useRef<HTMLElement | null>(null);

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
        minimumContrastRatio: terminalContrast(),
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(new WebLinksAddon((_event, uri) => {
        ipc.openExternal(uri);
      }));
      // Jira keys, the same way URLs work: underline on hover, click opens.
      // Settings are read per line, so turning Jira on applies to terminals
      // that are already open.
      term.registerLinkProvider({
        provideLinks(y, callback) {
          const { jiraProjectKeys } = getSettings();
          const line = jiraOn(getSettings()) ? term.buffer.active.getLine(y - 1)?.translateToString(true) : undefined;
          if (!line) { callback(undefined); return; }
          const links = findIssueKeys(line, jiraProjectKeys).map(({ key, index }) => ({
            text: key,
            range: { start: { x: index + 1, y }, end: { x: index + key.length, y } },
            activate: () => ipc.openExternal(issueUrl(getSettings().jiraBaseUrl, key)),
            hover: (e: MouseEvent) => showIssueCard(key, e.clientX, e.clientY + 14),
            leave: hideIssueCard,
          }));
          callback(links.length ? links : undefined);
        },
      });

      // File and folder paths. Only ones that exist get a link — a path's
      // shape alone matches `and/or` and `example.com` too. Settings are read
      // per line, like Jira's, so the switch applies to open terminals.
      // Answered from the cache synchronously whenever possible: xterm
      // checks an async reply against the cell the pointer was on when it
      // asked, and a late reply for the previous line overwrites the current
      // one's. So visible lines are stat'ed ahead of the hover, and a reply
      // a newer request has superseded is dropped.
      if (cwd) {
        let asked = 0;
        term.registerLinkProvider({
          provideLinks(y, callback) {
            const gen = ++asked;
            const line = getSettings().pathLinksEnabled ? term.buffer.active.getLine(y - 1)?.translateToString(true) : undefined;
            const found = line ? findPaths(line) : [];
            if (!found.length) { callback(undefined); return; }
            const reply = (infos: (PathInfo | null)[]) => {
              const links = outermost(found.filter((_, i) => infos[i])).map(({ path, index, length }) => ({
                text: path,
                range: { start: { x: index + 1, y }, end: { x: index + length, y } },
                activate: (e: MouseEvent) => clickPathLink({ cwd, path }, e, e.clientX, e.clientY + 14),
                hover: (e: MouseEvent) => showPathCard({ cwd, path }, e.clientX, e.clientY + 14),
                leave: hidePathCard,
              }));
              callback(links.length ? links : undefined);
            };
            const paths = found.map((f) => f.path);
            const now = knownPaths(cwd, paths);
            if (now) { reply(now); return; }
            statPaths(cwd, paths).then(
              (infos) => { if (gen === asked) reply(infos); },
              () => { if (gen === asked) callback(undefined); },
            );
          },
        });
        let prefetch: ReturnType<typeof setTimeout> | undefined;
        term.onRender(() => {
          clearTimeout(prefetch);
          prefetch = setTimeout(() => {
            if (!getSettings().pathLinksEnabled || !term.element?.isConnected) return; // disposed or detached
            const buf = term.buffer.active;
            const paths = new Set<string>();
            for (let y = buf.viewportY; y < buf.viewportY + term.rows; y++) {
              for (const f of findPaths(buf.getLine(y)?.translateToString(true) ?? '')) paths.add(f.path);
            }
            if (paths.size) statPaths(cwd, [...paths]).catch(() => {});
          }, 200);
        });
      }

      // Ctrl+V: paste clipboard text into the terminal. With no text on the
      // clipboard (a screenshot), the keystroke goes to the PTY instead, as
      // Claude Code's own image paste reads the clipboard itself: Alt+V
      // (ESC v) on Windows, Ctrl+V (\x16) elsewhere.
      term.attachCustomKeyEventHandler((e) => {
        if (e.ctrlKey && e.key === 'v' && e.type === 'keydown') {
          e.preventDefault();
          const imageKey = navigator.userAgent.includes('Windows') ? '\x1bv' : '\x16';
          navigator.clipboard.readText().then(
            (text) => { if (text) term.paste(text); else ipc.writeToPty(tabId, imageKey); },
            () => ipc.writeToPty(tabId, imageKey),
          );
          return false;
        }
        return true;
      });

      // Forward keyboard input to PTY
      const onDataDisposable = term.onData((data) => {
        ipc.writeToPty(tabId, data);
        if (isInterruptKeystroke(data)) onInterrupt?.();
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

    // Attach, or re-attach after a move between panes.
    //
    // `term.open()` only builds and mounts the element the FIRST time: once
    // `term.element` exists it returns immediately without re-parenting. So a
    // tab dragged into another pane would leave its element on the old,
    // now-detached container and the new pane would render an empty box — and
    // only for sessions that had actually been shown, since a dormant one has
    // no element yet and takes the real open() path. Move the element by hand.
    //
    // The instance itself lives in `terminalCache`, outside React, so the
    // buffer, scrollback and pty survive the move untouched.
    // "Is *this* terminal in there", not "is there a terminal in there". The
    // looser check silently passed when the container held a *different*
    // session's element, so switching sessions left the previous one on screen
    // — the whole workspace appeared frozen.
    const alreadyAttached =
      attachedRef.current === container && !!term.element && container.contains(term.element);

    if (!alreadyAttached) {
      if (term.element) {
        if (term.element.parentElement !== container) {
          // Evict whoever is in there first: appending alone would stack every
          // session ever shown in this container on top of each other.
          container.replaceChildren(term.element);
        }
        // Moving the node doesn't repaint it, and the fit below is a no-op when
        // the pane happens to be the same size as the old one.
        term.refresh(0, term.rows - 1);
      } else {
        container.innerHTML = '';
        term.open(container);
      }
      attachedRef.current = container;
    }

    // Activate WebGL now the terminal is visible — on first attach and on every
    // re-show, since the context is released while the tab is hidden (below).
    ensureWebgl(cached);

    // Defer initial fit to next frame so the container has final layout dimensions
    const rafId = requestAnimationFrame(fitAndSync);

    // Handle resize — observe container and refit
    // Dragging a seam resizes every visible pane at pointer rate, and each fit
    // is a pty_resize plus a full xterm rewrap. Back the debounce off while a
    // drag is live — longer, not skipped, so the trailing call still lands and
    // nothing needs re-fitting on mouseup.
    let resizeTimeout: ReturnType<typeof setTimeout>;
    const resizeObserver = new ResizeObserver(() => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(fitAndSync, seamDragging ? 250 : 50);
    });
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(resizeTimeout);
      resizeObserver.disconnect();
    };
  }, [tabId, isVisible]);

  // Hand the terminal the keyboard when its pane takes focus. Its own effect,
  // not part of the attach above: clicking between panes changes `focused` on
  // two terminals at once, and re-running attach would tear down and rebuild
  // each ResizeObserver and bounce a pty_resize for a size that didn't change.
  useEffect(() => {
    if (!isVisible || !focused) return;
    terminalCache.get(tabId)?.term.focus();
  }, [tabId, isVisible, focused]);

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
