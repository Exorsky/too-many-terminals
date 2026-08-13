import { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import FindBar from './FindBar';

afterEach(cleanup);

// A scroll container with searchable text for the bar to scope to.
function harness() {
  const ref = createRef<HTMLDivElement>();
  const utils = render(
    <div>
      <div ref={ref}>the cat sat on the mat, the cat</div>
      <FindBar scrollRef={ref} />
    </div>,
  );
  return utils;
}

describe('FindBar', () => {
  it('is hidden until Ctrl+F, then shows the find input', () => {
    harness();
    expect(screen.queryByPlaceholderText('Find')).toBeNull();
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    expect(screen.getByPlaceholderText('Find')).toBeInTheDocument();
  });

  it('counts matches within the scoped container as n/total', () => {
    harness();
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    const input = screen.getByPlaceholderText('Find');
    fireEvent.change(input, { target: { value: 'cat' } });
    expect(screen.getByText('1/2')).toBeInTheDocument();
    // Enter advances to the next match; Shift+Enter wraps back.
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('2/2')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('1/2')).toBeInTheDocument();
  });

  it('shows 0/0 when nothing matches', () => {
    harness();
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    fireEvent.change(screen.getByPlaceholderText('Find'), { target: { value: 'zzz' } });
    expect(screen.getByText('0/0')).toBeInTheDocument();
  });

  it('closes on Escape', () => {
    harness();
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    fireEvent.keyDown(screen.getByPlaceholderText('Find'), { key: 'Escape' });
    expect(screen.queryByPlaceholderText('Find')).toBeNull();
  });
});
