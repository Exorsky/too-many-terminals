import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { TranscriptTurn } from '@/types';
import MarkdownPane from './MarkdownPane';

const TURNS: TranscriptTurn[] = [
  { role: 'user', timestamp: null, blocks: [{ kind: 'text', text: 'first' }] },
  { role: 'assistant', timestamp: null, blocks: [{ kind: 'text', text: 'last' }] },
];

// jsdom has no layout, so scrollHeight is 0; fake a tall document so the
// scroll-to-bottom assignment is observable.
function withScrollHeight(px: number, run: () => void) {
  const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => px });
  try {
    run();
  } finally {
    if (desc) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', desc);
  }
}

afterEach(cleanup);

describe('MarkdownPane', () => {
  it('opens scrolled to the bottom once turns load', () => {
    withScrollHeight(900, () => {
      const { getByTestId } = render(<MarkdownPane turns={TURNS} error={null} view="rendered" />);
      expect(getByTestId('transcript-scroll').scrollTop).toBe(900);
    });
  });

  it('does not scroll while the transcript is still loading (turns null)', () => {
    withScrollHeight(900, () => {
      const { getByTestId } = render(<MarkdownPane turns={null} error={null} view="rendered" />);
      expect(getByTestId('transcript-scroll').scrollTop).toBe(0);
    });
  });

  it('shows a pane label header only when one is given (Split mode)', () => {
    const { queryByText, rerender } = render(<MarkdownPane turns={TURNS} error={null} view="rendered" />);
    expect(queryByText('Transcript')).toBeNull();
    rerender(<MarkdownPane turns={TURNS} error={null} view="rendered" label="Transcript" />);
    expect(queryByText('Transcript')).not.toBeNull();
  });
});
