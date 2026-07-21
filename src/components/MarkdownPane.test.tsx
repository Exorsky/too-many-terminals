import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { TranscriptTurn } from '@/types';
import MarkdownPane from './MarkdownPane';

const TURNS: TranscriptTurn[] = [
  { role: 'user', timestamp: null, blocks: [{ kind: 'text', text: 'first' }] },
  { role: 'assistant', timestamp: null, blocks: [{ kind: 'text', text: 'last' }] },
];
const MORE: TranscriptTurn[] = [
  ...TURNS,
  { role: 'assistant', timestamp: null, blocks: [{ kind: 'text', text: 'newer' }] },
];

// jsdom has no layout, so scroll metrics are 0. Fake mutable scrollHeight and a
// fixed viewport so the stick-to-bottom math is exercisable.
function mockMetrics(scrollHeight: number, clientHeight = 300) {
  const shDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
  const chDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
  const state = { sh: scrollHeight };
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => state.sh });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => clientHeight });
  return {
    set scrollHeight(v: number) { state.sh = v; },
    restore() {
      if (shDesc) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', shDesc);
      if (chDesc) Object.defineProperty(HTMLElement.prototype, 'clientHeight', chDesc);
    },
  };
}

afterEach(cleanup);

describe('MarkdownPane', () => {
  it('opens scrolled to the bottom once turns load', () => {
    const m = mockMetrics(900);
    try {
      const { getByTestId } = render(<MarkdownPane turns={TURNS} error={null} view="rendered" />);
      expect(getByTestId('transcript-scroll').scrollTop).toBe(900);
    } finally { m.restore(); }
  });

  it('does not scroll while the transcript is still loading (turns null)', () => {
    const m = mockMetrics(900);
    try {
      const { getByTestId } = render(<MarkdownPane turns={null} error={null} view="rendered" />);
      expect(getByTestId('transcript-scroll').scrollTop).toBe(0);
    } finally { m.restore(); }
  });

  it('keeps tailing new turns while the reader is at the bottom', () => {
    const m = mockMetrics(900);
    try {
      const { getByTestId, rerender } = render(<MarkdownPane turns={TURNS} error={null} view="rendered" />);
      const el = getByTestId('transcript-scroll');
      el.scrollTop = 900;               // sitting at the end
      fireEvent.scroll(el);
      m.scrollHeight = 1300;            // a new turn grew the document
      rerender(<MarkdownPane turns={MORE} error={null} view="rendered" />);
      expect(el.scrollTop).toBe(1300);  // followed to the new bottom
    } finally { m.restore(); }
  });

  it('stays put when the reader has scrolled up', () => {
    const m = mockMetrics(900);
    try {
      const { getByTestId, rerender } = render(<MarkdownPane turns={TURNS} error={null} view="rendered" />);
      const el = getByTestId('transcript-scroll');
      el.scrollTop = 0;                 // scrolled up to read history
      fireEvent.scroll(el);
      m.scrollHeight = 1300;
      rerender(<MarkdownPane turns={MORE} error={null} view="rendered" />);
      expect(el.scrollTop).toBe(0);     // not yanked to the bottom
    } finally { m.restore(); }
  });

  it('shows a pane label header only when one is given (Split mode)', () => {
    const { queryByText, rerender } = render(<MarkdownPane turns={TURNS} error={null} view="rendered" />);
    expect(queryByText('Transcript')).toBeNull();
    rerender(<MarkdownPane turns={TURNS} error={null} view="rendered" label="Transcript" />);
    expect(queryByText('Transcript')).not.toBeNull();
  });
});
