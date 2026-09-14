import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ipc', () => ({
  writeToPty: vi.fn(), resizePty: vi.fn(),
}));
vi.mock('@/lib/themes', () => ({ getActiveXtermTheme: () => ({}) }));
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

/** A stand-in for xterm that reproduces the one behaviour that matters here:
 *  `open()` builds and mounts the element the first time and then refuses to do
 *  anything on later calls — it does NOT re-parent. That is the real
 *  implementation (see the early return in xterm's open()), and it is why a
 *  running session went blank when its tab was dragged into another pane. */
class FakeTerm {
  element: HTMLElement | undefined;
  cols = 80;
  rows = 24;
  options: Record<string, unknown> = {};
  refresh = vi.fn();
  focus = vi.fn();
  write = vi.fn();
  dispose = vi.fn();
  loadAddon = vi.fn();
  onData = vi.fn(() => ({ dispose: vi.fn() }));
  attachCustomKeyEventHandler = vi.fn();
  attachCustomWheelEventHandler = vi.fn();
  registerLinkProvider = vi.fn();
  resize = vi.fn();
  clear = vi.fn();
  scrollToBottom = vi.fn();
  open(parent: HTMLElement) {
    if (this.element) return; // already opened — no re-parent, exactly like xterm
    this.element = document.createElement('div');
    this.element.className = 'xterm';
    this.element.textContent = 'session output';
    parent.appendChild(this.element);
  }
}

// jsdom has neither.
globalThis.ResizeObserver = class {
  observe() {} unobserve() {} disconnect() {}
} as never;

const made: FakeTerm[] = [];
vi.mock('@xterm/xterm', () => ({
  Terminal: class { constructor() { const t = new FakeTerm(); made.push(t); return t as never; } },
}));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = vi.fn(); } }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));
vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class { onContextLoss = vi.fn(); dispose = vi.fn(); },
}));

import Terminal from './Terminal';
import { terminalCache } from './terminalCache';

beforeEach(() => { made.length = 0; terminalCache.clear(); });
afterEach(cleanup);

/** Two panes side by side; the tab lives in whichever one `inSecond` says. */
function Panes({ inSecond }: { inSecond: boolean }) {
  return (
    <>
      <div data-testid="pane-a">{!inSecond && <Terminal tabId="t1" isVisible />}</div>
      <div data-testid="pane-b">{inSecond && <Terminal tabId="t1" isVisible />}</div>
    </>
  );
}

describe('Terminal', () => {
  it('mounts the terminal into its pane', () => {
    const { getByTestId } = render(<Panes inSecond={false} />);
    expect(getByTestId('pane-a').querySelector('.xterm')).not.toBeNull();
  });

  it('carries a running session into the pane it was moved to', () => {
    const { getByTestId, rerender } = render(<Panes inSecond={false} />);
    const first = made[0];
    expect(getByTestId('pane-a').querySelector('.xterm')).not.toBeNull();

    // the drag: same tab, different pane
    rerender(<Panes inSecond />);

    const a = getByTestId('pane-a');
    const b = getByTestId('pane-b');
    expect(a.querySelector('.xterm'), 'left pane still holds the terminal').toBeNull();
    expect(b.querySelector('.xterm'), 'right pane renders an empty box').not.toBeNull();
    // Same instance — the buffer and pty are not rebuilt by a move.
    expect(made).toHaveLength(1);
    expect(b.querySelector('.xterm')).toBe(first.element);
    expect(b.textContent).toContain('session output');
    // Moving a node doesn't repaint it.
    expect(first.refresh).toHaveBeenCalled();
  });

  it('reuses the cached instance rather than building a second one', () => {
    const { rerender } = render(<Panes inSecond={false} />);
    rerender(<Panes inSecond />);
    rerender(<Panes inSecond={false} />);
    expect(made).toHaveLength(1);
  });
});
