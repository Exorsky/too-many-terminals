import { afterEach, describe, expect, it } from 'vitest';
import { hasSelectionIn, isInterruptKeystroke, parentPath } from './utils';

describe('parentPath', () => {
  it('shows the two nearest ancestors with an ellipsis when there are more above', () => {
    expect(parentPath('C:\\Users\\Exorsky\\Desktop\\prog\\too-many-terminals')).toBe('… / Desktop / prog');
  });

  it('omits the ellipsis when exactly the shown levels are all there is', () => {
    expect(parentPath('C:\\prog\\too-many-terminals')).toBe('C: / prog');
  });

  it('shows a single ancestor without an ellipsis when only one exists', () => {
    expect(parentPath('C:\\too-many-terminals')).toBe('C:');
  });

  it('returns empty for a root-level folder with no ancestors', () => {
    expect(parentPath('/too-many-terminals')).toBe('');
  });

  it('handles forward-slash paths the same way', () => {
    expect(parentPath('/home/user/prog/too-many-terminals')).toBe('… / user / prog');
  });

  it('respects a custom level count', () => {
    expect(parentPath('C:\\Users\\Exorsky\\Desktop\\prog\\too-many-terminals', 1)).toBe('… / prog');
  });
});

describe('isInterruptKeystroke', () => {
  it('matches a bare Escape or Ctrl+C byte', () => {
    expect(isInterruptKeystroke('\x1b')).toBe(true);
    expect(isInterruptKeystroke('\x03')).toBe(true);
  });

  it('does not match an escape sequence (arrow keys etc.)', () => {
    expect(isInterruptKeystroke('\x1b[A')).toBe(false);
  });

  it('does not match ordinary input', () => {
    expect(isInterruptKeystroke('a')).toBe(false);
    expect(isInterruptKeystroke('')).toBe(false);
  });
});

describe('hasSelectionIn', () => {
  function selectInside(node: Node) {
    const range = document.createRange();
    range.selectNodeContents(node);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  }

  afterEach(() => window.getSelection()?.removeAllRanges());

  it('is false with no selection at all', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    expect(hasSelectionIn(el)).toBe(false);
  });

  it('is false for a missing root', () => {
    expect(hasSelectionIn(null)).toBe(false);
    expect(hasSelectionIn(undefined)).toBe(false);
  });

  it('sees a selection inside the root', () => {
    const el = document.createElement('div');
    el.textContent = 'some transcript text';
    document.body.appendChild(el);
    selectInside(el);
    expect(hasSelectionIn(el)).toBe(true);
  });

  it('ignores a selection that lives somewhere else', () => {
    const mine = document.createElement('div');
    mine.textContent = 'my pane';
    const other = document.createElement('div');
    other.textContent = 'another pane';
    document.body.append(mine, other);
    selectInside(other);
    expect(hasSelectionIn(mine)).toBe(false);
  });

  it('ignores a collapsed selection — a caret is not a selection', () => {
    const el = document.createElement('div');
    el.textContent = 'text';
    document.body.appendChild(el);
    const range = document.createRange();
    range.setStart(el.firstChild!, 2);
    range.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    expect(hasSelectionIn(el)).toBe(false);
  });
});
